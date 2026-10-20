from mfa_helper import enroll
"""Public catalog privacy and atomic account + athlete + enrollment creation."""
import http.cookiejar, json, os, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request

class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def call(self,path,body=None,status=200,headers=None):
  req=urllib.request.Request('http://127.0.0.1:3126'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
  try:
   with self.http.open(req) as response:
    data=json.load(response);assert response.status==status,(path,response.status,data);return data
  except urllib.error.HTTPError as error:
   data=json.load(error);assert error.code==status,(path,error.code,data);return data

with tempfile.TemporaryDirectory() as d:
 process=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env={**os.environ,'EA_TEST_NOW':'2099-08-31T22:00:00Z','PORT':'3126','DB_PATH':d+'/test.sqlite','LOGO_PATH':d+'/logo'},stdout=subprocess.DEVNULL)
 try:
  guest=Client();admin=Client()
  for _ in range(50):
   try:guest.call('/api/auth/status');break
   except urllib.error.URLError:time.sleep(.1)
  else:raise AssertionError('Server did not start')
  admin.call('/api/auth/setup',{'name':'Admin','email':'admin@example.org','password':'development-password'},status=201)
  enroll(admin.call, '2099-08-31T22:00:00Z', '/api/')
  location=admin.call('/api/locations',{'name':'Przedszkole'},status=201)['id']
  trainer=admin.call('/api/trainers',{'name':'Anna Trener','email':'private-trainer@example.org','phone':'555777999'},status=201)['id']
  base={'location_id':location,'name':'Liski','capacity':1,'price':5000,'trial_price':0,'trials':True,'dates':['2099-09-03T13:00','2099-09-10T13:00'],'trainer_ids':[trainer]}
  group=admin.call('/api/groups',base,status=201)['id']
  later_group=admin.call('/api/groups',{**base,'name':'Grupa od października','dates':['2099-10-01T13:00']},status=201)['id']
  parent=admin.call('/api/parents',{'name':'Private Parent','email':'private-parent@example.org'},status=201)['id']
  admin.call('/api/athletes',{'name':'Private Child','parent_id':parent,'notes':'Internal note'},status=201)
  catalog=guest.call('/api/public/catalog')
  serialized=json.dumps(catalog)
  for secret in ['private-parent@example.org','private-trainer@example.org','Private Child','Internal note','555777999','password_hash','parents','athletes']:
   assert secret not in serialized,secret
  assert catalog['groups'][0]['member_count']==0
  assert catalog['now'].startswith('2099-09-01') # Warsaw time is already September despite the UTC fixture being in August.
  guest.call('/api/public/quote',{'group_id':group,'month':'2099-10'},status=400)
  guest.call('/api/public/quote',{'group_id':later_group},status=400)
  guest.call('/api/state',status=401)
  with guest.http.open('http://127.0.0.1:3126/zapisy') as response:assert 'Dane dziecka' in response.read().decode()
  assert guest.call('/api/public/quote',{'group_id':group,'month':'2099-09'})=={'amount':10000,'count':2}
  signup={'group_id':group,'month':'2099-09','child_first_name':'Jan','child_last_name':'Dziecko','birth_date':'2020-01-01','parent_first_name':'Anna','parent_last_name':'Rodzic','email':'new-parent@example.org','phone':'+48 123 456 789','password':'new-parent-test-password','amount':1,'role':'admin'}
  def totals():
   state=admin.call('/api/state');return len(state['parents']),len(state['athletes']),len(state['enrollments'])
  before=totals()
  for invalid in [{'phone':''},{'password':'short'},{'birth_date':'2100-01-01'},{'group_id':999999},{'month':'2099-10'},{'month':'2099-08'},{'group_id':later_group,'month':'2099-10'}]:
   guest.call('/api/public/enroll',{**signup,**invalid},status=400);assert totals()==before
  result=guest.call('/api/public/enroll',{key:value for key,value in signup.items() if key!='month'},status=201)
  assert result['amount']==10000
  session=guest.call('/api/auth/status')['user'];assert session['role']=='parent' and session['phone']=='+48 123 456 789'
  own=guest.call('/api/state')
  assert len(own['athletes'])==1 and own['athletes'][0]['name']=='Jan Dziecko'
  assert len(own['enrollments'])==1 and own['enrollments'][0]['balance']==10000
  assert own['athletes'][0]['parent_id']==session['id']
  assert all(a['name']!='Private Child' for a in own['athletes'])
  before=totals();another=Client()
  another.call('/api/public/enroll',{**signup,'email':'second-parent@example.org'},status=400)
  assert totals()==before # A full group leaves no account and no athlete behind.
  another.call('/api/public/enroll',signup,status=409);assert totals()==before
  assert guest.call('/api/public/catalog')['groups'][0]['member_count']==1
  # Excluded trials cannot create accounts; free valid trials do not create a charge.
  trials=admin.call('/api/groups',{**base,'name':'Próby','capacity':3},status=201)['id']
  admin.call('/api/exclusions',{'scope':'group','targets':[trials],'start_date':'2099-09-03','end_date':'2099-09-03','reason':'Przerwa'})
  terms=[s for s in another.call('/api/public/catalog')['sessions'] if s['group_id']==trials]
  excluded=next(s for s in terms if s['excluded']);available=next(s for s in terms if not s['excluded'])
  before=totals()
  another.call('/api/public/enroll',{**signup,'group_id':trials,'email':'trial-parent@example.org','trial_id':excluded['id']},status=400);assert totals()==before
  assert another.call('/api/public/enroll',{**signup,'group_id':trials,'email':'trial-parent@example.org','trial_id':available['id']},status=201)['amount']==0
  another.call('/api/public/enroll',{**signup,'email':'cross-origin@example.org'},status=403,headers={'Origin':'https://untrusted.example'})
  # Two simultaneous signups must not reserve the same final seat.
  from concurrent.futures import ThreadPoolExecutor
  last_seat=admin.call('/api/groups',{**base,'name':'Ostatnie miejsce'},status=201)['id']
  before=totals()
  def compete(email):
   client=Client()
   req=urllib.request.Request('http://127.0.0.1:3126/api/public/enroll',data=json.dumps({**signup,'group_id':last_seat,'email':email}).encode(),headers={'Content-Type':'application/json'})
   try:
    with client.http.open(req) as response:return email,response.status
   except urllib.error.HTTPError as response:return email,response.code
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(compete,['race-one@example.org','race-two@example.org']))
  assert sorted(status for _,status in results)==[201,400]
  assert totals()==tuple(count+1 for count in before)
  loser=next(email for email,status in results if status==400)
  with sqlite3.connect(d+'/test.sqlite') as db:
   assert db.execute("SELECT id FROM users WHERE email='second-parent@example.org'").fetchone() is None
   assert db.execute('SELECT id FROM users WHERE email=?',(loser,)).fetchone() is None
   assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  print('PASS: katalog bez logowania, prywatność, wymagane dane, konto+dziecko+zapis, wycena, pełna grupa bez osieroconych danych i bezpłatna próba')
 finally:process.terminate();process.wait()

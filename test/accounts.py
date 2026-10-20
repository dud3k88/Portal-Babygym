from mfa_helper import enroll
"""End-to-end account isolation, athlete records and editing booked groups."""
import http.cookiejar, json, os, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request

class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def request(self,path,body=None,status=200,headers=None):
  req=urllib.request.Request('http://127.0.0.1:3118/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
  try:
   with self.http.open(req) as response:
    data=json.load(response)
    assert response.status==status,(path,response.status,data)
    return data
  except urllib.error.HTTPError as error:
   data=json.load(error)
   assert error.code==status,(path,error.code,data)
   return data

with tempfile.TemporaryDirectory() as directory:
 env={**os.environ,'EA_TEST_NOW':'2099-08-31T22:00:00Z','PORT':'3118','DB_PATH':directory+'/accounts.sqlite','LOGO_PATH':directory+'/logo'}
 p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
 try:
  guest=Client()
  for _ in range(50):
   try:guest.request('auth/status');break
   except urllib.error.URLError:time.sleep(.1)
  else:raise AssertionError('server did not start')
  guest.request('state',status=401)
  guest.request('auth/register',{'name':'Parent','email':'first@example.org','password':'test-password-123'},status=403)
  admin=Client()
  admin.request('auth/setup',{'name':'Administrator','email':'admin@example.org','password':'test-admin-password'},status=201)
  enroll(admin.request, '2099-08-31T22:00:00Z')
  guest.request('auth/setup',{'name':'Attacker','email':'other@example.org','password':'test-password-123'},status=403)
  location=admin.request('locations',{'name':'Przedszkole'},status=201)['id']
  group_body={'location_id':location,'name':'Liski','capacity':1,'price':5000,'trial_price':3000,'trials':True,'start_date':'2099-09-01','end_date':'2099-09-30','start_time':'13:00','end_time':'13:30','weekday':2}
  group=admin.request('groups',group_body,status=201)['id']
  parent=Client()
  registration=parent.request('auth/register',{'name':'Anna Rodzic','email':'anna@example.org','password':'parent-test-password','role':'admin'},status=201)
  assert registration['user']['role']=='parent'
  parent.request('groups/update',{'id':group},status=403)
  parent.request('locations',{'name':'Niedozwolona'},status=403)
  child=parent.request('athletes',{'name':'Jan Dziecko','birth_date':'2020-01-01','parent_id':99999,'notes':'Cannot set admin note'},status=201)['id']
  own=parent.request('state')
  assert own['athletes'][0]['parent_id']==registration['user']['id']
  assert 'notes' not in own['athletes'][0]
  invoice=parent.request('enrollments',{'group_id':group,'athlete_id':child,'month':'2099-09'},status=201)['id']
  # A future-month signup is rejected and cannot create a second roster entry.
  extra=admin.request('groups/update',{**group_body,'id':group,'end_date':'2099-10-31'})
  parent.request('enrollments',{'group_id':group,'athlete_id':child,'month':'2099-10'},status=400)
  assert next(g for g in admin.request('state')['groups'] if g['id']==group)['member_count']==1
  other=Client()
  other.request('auth/register',{'name':'Inny Rodzic','email':'other@example.org','password':'another-test-password'},status=201)
  other_child=other.request('athletes',{'name':'Inne Dziecko'},status=201)['id']
  other.request('athletes/update',{'id':child,'name':'Stolen'},status=404)
  other.request('enrollments',{'group_id':group,'athlete_id':child,'month':'2099-09'},status=404)
  other.request('enrollments',{'group_id':group,'athlete_id':other_child,'month':'2099-09'},status=400)
  private=other.request('state')
  assert all(a['id']!=child for a in private['athletes'])
  assert private['enrollments']==[] and private['adjustments']==[] and private['memberships']==[]
  assert len(private['parents'])==1
  # Add an admin-only note and ensure it cannot be fetched or overwritten by the parent.
  admin.request('athletes/update',{'id':child,'parent_id':registration['user']['id'],'name':'Jan Dziecko','notes':'Internal-only secret note'})
  parent.request('athletes/update',{'id':child,'name':'Jan Dziecko','notes':'Overwrite attempt'})
  assert next(a for a in admin.request('state')['athletes'] if a['id']==child)['notes']=='Internal-only secret note'
  assert 'Internal-only secret note' not in json.dumps(parent.request('state'))
  # Editing settings preserves the agreed price on existing terms.
  admin.request('adjustments',{'enrollment_id':invoice,'amount':-1000,'reason':'Rabat ręczny'},status=201)
  changed={**group_body,'id':group,'end_date':'2099-10-31','price':6000,'name':'Liski nowe','start_time':'14:00','end_time':'14:30'}
  admin.request('groups/update',changed)
  state=parent.request('state')
  assert next(e for e in state['enrollments'] if e['id']==invoice)['balance']==24000
  assert next(g for g in state['groups'] if g['id']==group)['member_count']==1
  assert all(s['starts_at'][11:16]=='14:00' for s in state['sessions'] if s['group_id']==group and not s['cancelled'])
  # Removing a future date credits its original price; restoring it bills that price once.
  shortened={**changed,'start_date':'2099-09-02'}
  admin.request('groups/update',shortened)
  assert next(e for e in parent.request('state')['enrollments'] if e['id']==invoice)['balance']==19000
  admin.request('groups/update',changed)
  assert next(e for e in parent.request('state')['enrollments'] if e['id']==invoice)['balance']==24000
  # The edit must be atomic if a limit would hide an existing athlete.
  second_group=admin.request('groups',{**group_body,'name':'Sówki','capacity':2},status=201)['id']
  parent.request('enrollments',{'group_id':second_group,'athlete_id':child,'month':'2099-09'},status=201)
  other.request('enrollments',{'group_id':second_group,'athlete_id':other_child,'month':'2099-09'},status=201)
  admin.request('groups/update',{**group_body,'id':second_group,'name':'Should not change','capacity':1},status=400)
  assert next(g for g in admin.request('state')['groups'] if g['id']==second_group)['name']=='Sówki'
  # Pending legacy/manual accounts cannot be claimed by re-registering an email.
  pending=admin.request('parents',{'name':'Rodzic z kartoteki','email':'pending@example.org'},status=201)['id']
  dormant_child=admin.request('athletes',{'name':'Dziecko z kartoteki','parent_id':pending},status=201)['id']
  guest.request('auth/register',{'name':'Impostor','email':'pending@example.org','password':'attack-test-password'},status=400)
  token=admin.request('parents/invite',{'parent_id':pending})['token']
  invited=Client()
  invited.request('auth/activate',{'token':token,'password':'activated-test-password'})
  assert invited.request('state')['athletes'][0]['id']==dormant_child
  guest.request('auth/activate',{'token':token,'password':'another-test-password'},status=400)
  # Cross-origin writes, logged-out reads and wrong passwords fail.
  parent.request('athletes',{'name':'Cross origin'},status=403,headers={'Origin':'https://untrusted.example'})
  parent.request('auth/logout',{})
  parent.request('state',status=401)
  parent.request('auth/login',{'email':'anna@example.org','password':'incorrect-password'},status=401)
  parent.request('auth/login',{'email':'ANNA@example.org','password':'parent-test-password'})
  assert parent.request('state')['athletes'][0]['id']==child
  with sqlite3.connect(env['DB_PATH']) as db:
   assert all('test-password' not in row[0] for row in db.execute('SELECT password_hash FROM users WHERE password_hash IS NOT NULL'))
   assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  print('PASS: logowanie, izolacja rodzin, kartoteki, liczebność, edycja zapisanej grupy, korekty, aktywacja i wylogowanie')
 finally:p.terminate();p.wait()

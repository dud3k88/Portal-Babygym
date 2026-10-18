import json, os, subprocess, tempfile, time, urllib.request, urllib.error
with tempfile.TemporaryDirectory() as directory:
 env={**os.environ,'PORT':'3107','DB_PATH':directory+'/test.sqlite'}
 def start():
  p=subprocess.Popen(['node','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(50):
   try:
    urllib.request.urlopen('http://127.0.0.1:3107/api/state');return p
   except urllib.error.URLError:time.sleep(.1)
  p.terminate();raise RuntimeError('server did not start')
 def request(path,body=None):
  r=urllib.request.Request('http://127.0.0.1:3107'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(r) as response:return json.load(response)
 # Simulate an installation created by the previous version, with real persisted records.
 import sqlite3
 with sqlite3.connect(env['DB_PATH']) as legacy:
  legacy.executescript("""
   CREATE TABLE groups(id INTEGER PRIMARY KEY, location TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, price INTEGER NOT NULL, trial_price INTEGER NOT NULL, trials INTEGER NOT NULL);
   CREATE TABLE sessions(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), starts_at TEXT NOT NULL, price INTEGER NOT NULL);
   CREATE TABLE enrollments(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), parent TEXT NOT NULL, email TEXT NOT NULL, child TEXT NOT NULL, month TEXT NOT NULL, trial_id INTEGER REFERENCES sessions(id), amount INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE adjustments(id INTEGER PRIMARY KEY, enrollment_id INTEGER REFERENCES enrollments(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
   INSERT INTO groups VALUES(1,'Legacy','Stara grupa',15,5000,0,0);
   INSERT INTO sessions VALUES(1,1,'2099-09-03T13:00:00',5000),(2,1,'2099-09-10T13:00:00',5000);
   INSERT INTO enrollments VALUES(1,1,'Rodzic','old@example.org','Starszy zapis','2099-09',NULL,10000,'2099-09-01T12:00:00');
   INSERT INTO adjustments VALUES(1,1,-1000,'Stary rabat','2099-09-01T12:00:00');
  """)
 p=start()
 try:
  assert request('/api/state')['enrollments'][0]['balance']==9000
  request('/api/exclusions',{'scope':'group','group_id':1,'start_date':'2099-09-03','end_date':'2099-09-03','reason':'Migracja'})
  assert request('/api/state')['enrollments'][0]['balance']==4000
  old_exclusion=request('/api/state')['exclusions'][0]['id']
  request('/api/exclusions/remove',{'id':old_exclusion})
  assert request('/api/state')['enrollments'][0]['balance']==9000
  with urllib.request.urlopen('http://127.0.0.1:3107/') as response:assert 'Evolution Academy' in response.read().decode()
  group=request('/api/groups',{'location':'Przedszkole testowe','name':'Liski','capacity':1,'price':5000,'trial_price':0,'trials':True,'dates':['2099-09-03T13:00','2099-09-10T13:00']})
  body={'group_id':group['id'],'month':'2099-09','parent':'Rodzic testowy','email':'test@example.org','child':'Dziecko testowe'}
  assert request('/api/quote',body)=={'amount':10000,'count':2}
  enrollment=request('/api/enrollments',body)
  assert enrollment['amount']==10000
  request('/api/adjustments',{'enrollment_id':enrollment['id'],'amount':-5000,'reason':'Obniżka testowa'})
  assert request('/api/state')['enrollments'][0]['balance']==5000
  try:request('/api/enrollments',{**body,'child':'Drugie dziecko'})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('capacity not enforced')

  # Weekly groups, all three exclusion scopes, overlaps and invoice corrections.
  import datetime
  weekday=(datetime.date(2099,9,1).weekday()+1)%7
  def create(location,name):
   return request('/api/groups',{'location':location,'name':name,'capacity':10,'price':5000,'trial_price':3000,'trials':True,'start_date':'2099-09-01','end_date':'2099-10-31','start_time':'13:00','end_time':'13:30','weekday':weekday})['id']
  a=create('A','Liski');a2=create('A','Sówki');b=create('B','Liski');c=create('C','Liski')
  initial=request('/api/quote',{'group_id':a,'month':'2099-09'})
  assert initial['count']==5 and initial['amount']==25000
  invoice=request('/api/enrollments',{**body,'group_id':a,'child':'Kalendarz'})['id']
  request('/api/adjustments',{'enrollment_id':invoice,'amount':-1000,'reason':'Rabat ręczny'})
  def balance():return next(e for e in request('/api/state')['enrollments'] if e['id']==invoice)['balance']
  assert balance()==24000
  def exclude(scope,day,targets=None):
   return request('/api/exclusions',{'start_date':day,'end_date':day,'scope':scope,'targets':targets or [],'reason':'Przerwa testowa'})
  exclude('location','2099-09-01',['A','B'])
  assert balance()==19000
  for group_id,count in [(a,4),(a2,4),(b,4),(c,5)]:assert request('/api/quote',{'group_id':group_id,'month':'2099-09'})['count']==count
  exclude('group','2099-09-08',[a])
  assert balance()==14000
  assert request('/api/quote',{'group_id':a2,'month':'2099-09'})['count']==4
  exclude('all','2099-09-01')
  assert balance()==14000 # overlapping exclusions never double-credit
  state=request('/api/state')
  local=next(e for e in state['exclusions'] if e['scope']=='location' and e['location']=='A')
  request('/api/exclusions/remove',{'id':local['id']})
  assert balance()==14000 # global exclusion still applies
  global_ex=next(e for e in state['exclusions'] if e['scope']=='all')
  request('/api/exclusions/remove',{'id':global_ex['id']})
  assert balance()==19000
  # Batch validation must not partially save exclusions.
  before=len(request('/api/state')['exclusions'])
  try:exclude('location','2099-09-15',['A','does-not-exist'])
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('invalid location accepted')
  assert len(request('/api/state')['exclusions'])==before
  # Rules apply to groups created afterwards and to trial choices.
  exclude('all','2099-09-15')
  d=create('D','Nowa grupa')
  assert request('/api/quote',{'group_id':d,'month':'2099-09'})['count']==4
  excluded_term=next(s for s in request('/api/state')['sessions'] if s['group_id']==d and s['starts_at'].startswith('2099-09-15'))
  try:request('/api/quote',{'group_id':d,'month':'2099-09','trial_id':excluded_term['id']})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('excluded trial accepted')
  # Existing exclusions are not billed; removal restores their charge once.
  new_invoice=request('/api/enrollments',{**body,'group_id':d,'child':'Nowy zapis'})['id']
  ex=next(e for e in request('/api/state')['exclusions'] if e['scope']=='all' and e['start_date']=='2099-09-15')
  request('/api/exclusions/remove',{'id':ex['id']})
  assert next(e for e in request('/api/state')['enrollments'] if e['id']==new_invoice)['balance']==25000
 finally:p.terminate();p.wait()
 p=start()
 try:
  assert next(e for e in request('/api/state')['enrollments'] if e['id']==enrollment['id'])['balance']==5000
  assert balance()==19000
 finally:p.terminate();p.wait()
 print('PASS: zapis, grafik tygodniowy, wszystkie zakresy wykluczeń, nakładanie, cofanie, korekty, próby, walidacja atomowa i restart')

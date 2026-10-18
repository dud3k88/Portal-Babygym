import json, os, subprocess, tempfile, time, urllib.request, urllib.error, http.cookiejar
with tempfile.TemporaryDirectory() as directory:
 opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 env={**os.environ,'EA_TEST_NOW':'2099-08-31T22:00:00Z','PORT':'3107','DB_PATH':directory+'/test.sqlite','LOGO_PATH':directory+'/logo'}
 def start():
  p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(50):
   try:
    opener.open('http://127.0.0.1:3107/api/auth/status');return p
   except urllib.error.URLError:time.sleep(.1)
  p.terminate();raise RuntimeError('server did not start')
 def request(path,body=None):
  if path=='/api/enrollments' and body and 'athlete_id' not in body:
   state=request('/api/state')
   parent=next((p for p in state['parents'] if p['email']==body['email']),None)
   if not parent:parent=request('/api/parents',{'name':body['parent'],'email':body['email']})
   athlete=next((a for a in state['athletes'] if a['parent_id']==parent['id'] and a['name']==body['child']),None)
   if not athlete:athlete=request('/api/athletes',{'parent_id':parent['id'],'name':body['child']})
   body={**body,'athlete_id':athlete['id']}
  r=urllib.request.Request('http://127.0.0.1:3107'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  with opener.open(r) as response:return json.load(response)
 def registered_location(name):
  match=next((location for location in request('/api/state')['locations'] if location['name']==name),None)
  return match['id'] if match else request('/api/locations',{'name':name})['id']
 # Simulate an installation created by the previous version, with real persisted records.
 import sqlite3
 with sqlite3.connect(env['DB_PATH']) as legacy:
  legacy.executescript("""
   CREATE TABLE groups(id INTEGER PRIMARY KEY, location TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, price INTEGER NOT NULL, trial_price INTEGER NOT NULL, trials INTEGER NOT NULL);
   CREATE TABLE sessions(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), starts_at TEXT NOT NULL, price INTEGER NOT NULL);
   CREATE TABLE enrollments(id INTEGER PRIMARY KEY, group_id INTEGER REFERENCES groups(id), parent TEXT NOT NULL, email TEXT NOT NULL, child TEXT NOT NULL, month TEXT NOT NULL, trial_id INTEGER REFERENCES sessions(id), amount INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE adjustments(id INTEGER PRIMARY KEY, enrollment_id INTEGER REFERENCES enrollments(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE exclusions(id INTEGER PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, scope TEXT NOT NULL, location TEXT, group_id INTEGER REFERENCES groups(id), reason TEXT NOT NULL);
   INSERT INTO exclusions VALUES(1,'2099-10-01','2099-10-01','location','  Legacy  ',NULL,'Stara przerwa');
   INSERT INTO groups VALUES(1,'Legacy','Stara grupa',15,5000,0,0);
   INSERT INTO groups VALUES(2,'  LEGACY  ','Druga stara grupa',15,5000,0,0);
   INSERT INTO sessions VALUES(1,1,'2099-09-03T13:00:00',5000),(2,1,'2099-09-10T13:00:00',5000);
   INSERT INTO enrollments VALUES(1,1,'Rodzic','old@example.org','Starszy zapis','2099-09',NULL,10000,'2099-09-01T12:00:00');
   INSERT INTO adjustments VALUES(1,1,-1000,'Stary rabat','2099-09-01T12:00:00');
  """)
 p=start()
 try:
  request('/api/auth/setup',{'name':'Administrator testowy','email':'admin@example.org','password':'development-test-password'})
  assert request('/api/state')['enrollments'][0]['balance']==9000
  migrated=request('/api/state')
  legacy_id=migrated['locations'][0]['id']
  assert len(migrated['locations'])==1
  assert all(g['location_id']==legacy_id for g in migrated['groups'])
  assert migrated['exclusions'][0]['location_id']==legacy_id
  assert migrated['exclusions'][0]['location']=='Legacy'
  request('/api/exclusions',{'scope':'group','group_id':1,'start_date':'2099-09-03','end_date':'2099-09-03','reason':'Migracja'})
  assert request('/api/state')['enrollments'][0]['balance']==4000
  old_exclusion=next(e for e in request('/api/state')['exclusions'] if e['scope']=='group')['id']
  request('/api/exclusions/remove',{'id':old_exclusion})
  assert request('/api/state')['enrollments'][0]['balance']==9000
  with opener.open('http://127.0.0.1:3107/') as response:assert 'Evolution Academy' in response.read().decode()
  group=request('/api/groups',{'location_id':registered_location('Przedszkole testowe'),'name':'Liski','capacity':1,'price':5000,'trial_price':0,'trials':True,'dates':['2099-09-03T13:00','2099-09-10T13:00']})
  body={'group_id':group['id'],'month':'2099-09','parent':'Rodzic testowy','email':'test@example.org','child':'Dziecko testowe'}
  assert request('/api/quote',body)=={'amount':10000,'count':2}
  enrollment=request('/api/enrollments',body)
  assert enrollment['amount']==10000
  request('/api/adjustments',{'enrollment_id':enrollment['id'],'amount':-5000,'reason':'Obniżka testowa'})
  assert request('/api/state')['enrollments'][0]['balance']==5000
  try:request('/api/enrollments',{**body,'child':'Drugie dziecko'})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('capacity not enforced')

  # Registered locations prevent free-text mistakes and duplicate entries.
  location_id=registered_location('Przedszkole testowe')
  for name in ['  PRZEDSZKOLE   TESTOWE  ','przedszkole testowe','   ']:
   try:request('/api/locations',{'name':name})
   except urllib.error.HTTPError as error:assert error.code==400
   else:raise AssertionError('duplicate or blank location accepted')
  for invalid in [{'location':'Nieznane miejsce'},{'location_id':999999},{'location_id':None}]:
   try:request('/api/groups',{**invalid,'name':'Niepoprawna grupa','capacity':5,'price':5000,'trial_price':0,'dates':['2099-09-01T13:00']})
   except urllib.error.HTTPError as error:assert error.code==400
   else:raise AssertionError('unregistered location accepted')
  # Days off can be planned before a location has any groups.
  standalone=registered_location('Nowa lokalizacja')
  request('/api/exclusions',{'scope':'location','targets':[standalone],'start_date':'2099-09-01','end_date':'2099-09-01','reason':'Przerwa przed utworzeniem grup'})
  new_group=request('/api/groups',{'location_id':standalone,'name':'Nowa grupa','capacity':5,'price':5000,'trial_price':0,'dates':['2099-09-01T13:00','2099-09-08T13:00']})['id']
  assert request('/api/quote',{'group_id':new_group,'month':'2099-09'})['count']==1

  # Trainer profiles and many-to-many assignments, with atomic validation.
  coach=request('/api/trainers',{'name':'Anna Kowalska','email':'anna@example.org','phone':'123456789'})['id']
  coach2=request('/api/trainers',{'name':'Jan Testowy'})['id']
  request('/api/groups/trainers',{'group_id':group['id'],'trainer_ids':[coach,coach2,coach]})
  assignments=request('/api/state')['group_trainers']
  assert len(assignments)==2
  try:request('/api/groups/trainers',{'group_id':group['id'],'trainer_ids':[coach,999999]})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('nonexistent trainer accepted')
  assert request('/api/state')['group_trainers']==assignments
  request('/api/groups/trainers',{'group_id':group['id'],'trainer_ids':[]})
  assert request('/api/state')['group_trainers']==[]
  try:request('/api/trainers',{'name':'Błędny email','email':'invalid'})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('invalid email accepted')
  coached=request('/api/groups',{'location_id':registered_location('Trenerzy'),'name':'Grupa z trenerem','capacity':5,'price':5000,'trial_price':0,'trials':False,'dates':['2099-10-01T13:00'],'trainer_ids':[coach]})['id']
  assert {'group_id':coached,'trainer_id':coach} in request('/api/state')['group_trainers']
  # Logo rejects script/HTML uploads and preserves an original PNG as bytes.
  bad=urllib.request.Request('http://127.0.0.1:3107/api/logo',data=b'<svg onload="alert(1)"></svg>',method='POST')
  try:opener.open(bad)
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('SVG was accepted')
  import base64
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
  upload=urllib.request.Request('http://127.0.0.1:3107/api/logo',data=png,method='POST')
  with opener.open(upload) as r:assert r.status==201
  with opener.open('http://127.0.0.1:3107/logo') as r:assert r.read()==png
  # Weekly groups, all three exclusion scopes, overlaps and invoice corrections.
  import datetime
  weekday=(datetime.date(2099,9,1).weekday()+1)%7
  def create(location,name):
   return request('/api/groups',{'location_id':registered_location(location),'name':name,'capacity':10,'price':5000,'trial_price':3000,'trials':True,'start_date':'2099-09-01','end_date':'2099-10-31','start_time':'13:00','end_time':'13:30','weekday':weekday})['id']
  a=create('A','Liski');a2=create('A','Sówki');b=create('B','Liski');c=create('C','Liski')
  initial=request('/api/quote',{'group_id':a,'month':'2099-09'})
  assert initial['count']==5 and initial['amount']==25000
  invoice=request('/api/enrollments',{**body,'group_id':a,'child':'Kalendarz'})['id']
  request('/api/adjustments',{'enrollment_id':invoice,'amount':-1000,'reason':'Rabat ręczny'})
  def balance():return next(e for e in request('/api/state')['enrollments'] if e['id']==invoice)['balance']
  assert balance()==24000
  def exclude(scope,day,targets=None):
   if scope=='location':
    locations=request('/api/state')['locations']
    targets=[next((entry['id'] for entry in locations if entry['name']==target),999999) if isinstance(target,str) else target for target in targets]
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
  # Renaming propagates without breaking IDs, holiday rules or invoice balances.
  a_location=registered_location('A')
  exclude('location','2099-09-22',[a_location])
  before_rename=balance()
  request('/api/locations/update',{'id':a_location,'name':'Nowe A'})
  renamed=request('/api/state')
  assert all(g['location']=='Nowe A' for g in renamed['groups'] if g['location_id']==a_location)
  assert all(e['location']=='Nowe A' for e in renamed['exclusions'] if e['location_id']==a_location)
  assert balance()==before_rename
  assert next(g for g in renamed['groups'] if g['id']==a)['location_id']==a_location
  try:request('/api/locations/update',{'id':a_location,'name':' b '})
  except urllib.error.HTTPError as error:assert error.code==400
  else:raise AssertionError('duplicate rename accepted')
  assert next(l for l in request('/api/state')['locations'] if l['id']==a_location)['name']=='Nowe A'
  renamed_ex=next(e for e in renamed['exclusions'] if e['location_id']==a_location)
  request('/api/exclusions/remove',{'id':renamed_ex['id']})
  assert balance()==19000
 finally:p.terminate();p.wait()
 p=start()
 try:
  assert next(e for e in request('/api/state')['enrollments'] if e['id']==enrollment['id'])['balance']==5000
  assert balance()==19000
  assert next(l for l in request('/api/state')['locations'] if l['id']==a_location)['name']=='Nowe A'
  assert len([l for l in request('/api/state')['locations'] if l['name']=='Legacy'])==1
  assert {'group_id':coached,'trainer_id':coach} in request('/api/state')['group_trainers']
  with opener.open('http://127.0.0.1:3107/logo') as r:assert r.read()==png
 finally:p.terminate();p.wait()
 print('PASS: lokalizacje, blokada duplikatów, zmiana nazwy, migracja, zapisy, wykluczenia, rozliczenia, trenerzy, logo i restart')

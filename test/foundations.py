from mfa_helper import enroll
"""Foundations: location lifecycle, privacy, access revocation, audit, backup/restore."""
import http.cookiejar, json, os, pathlib, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request

PORT = 3137
class Client:
 def __init__(self): self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def call(self,path,body=None,status=200):
  req=urllib.request.Request(f'http://127.0.0.1:{PORT}/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  try:
   with self.http.open(req) as response: data=json.load(response); assert response.status==status,(path,data);return data
  except urllib.error.HTTPError as error:
   data=json.load(error);assert error.code==status,(path,error.code,data);return data

def command(*args,success=True):
 result=subprocess.run(['python3','scripts/backup.py',*args],capture_output=True,text=True)
 assert (result.returncode==0)==success,result.stderr

with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp); dbpath=root/'db.sqlite'; logo=root/'logo';logo.write_bytes(b'test-logo')
 env={**os.environ,'PORT':str(PORT),'DB_PATH':str(dbpath),'LOGO_PATH':str(logo),'EA_TEST_NOW':'2099-09-01T10:00:00Z'}
 def start():
  process=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(60):
   try:Client().call('auth/status');return process
   except urllib.error.URLError:time.sleep(.05)
  process.terminate();process.wait();raise AssertionError('server did not start')
 p=start()
 try:
  admin=Client();guest=Client();parent=Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'test-admin-password'},201)
  enroll(admin.call, '2099-09-01T10:00:00Z')
  admin_id=admin.call('auth/status')['user']['id']
  parent_id=parent.call('auth/register',{'name':'Rodzic','email':'parent@example.org','password':'test-parent-password'},201)['user']['id']
  location=admin.call('locations',{'name':'Przedszkole','city':'Poznań','address':'Testowa 1','phone':'123456789','email':'office@example.org','contact_name':'Kontakt','notes':'PRIVATE-LOCATION-NOTE'},201)['id']
  other=admin.call('locations',{'name':'Drugie'},201)['id']
  body={'location_id':location,'name':'Liski','capacity':3,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-10T13:00','2099-09-17T13:00']}
  group=admin.call('groups',body,201)['id']
  other_group=admin.call('groups',{**body,'location_id':other,'name':'Inna grupa'},201)['id']
  child=parent.call('athletes',{'name':'Dziecko'},201)['id']
  charge=parent.call('enrollments',{'athlete_id':child,'group_id':group},201)['id']
  admin.call('adjustments',{'enrollment_id':charge,'amount':-500,'reason':'Rabat'},201)
  admin.call('exclusions',{'start_date':'2099-09-10','end_date':'2099-09-10','scope':'group','group_id':other_group,'reason':'PRIVATE-EXCLUSION'})
  state=parent.call('state');serialized=json.dumps(state)
  assert 'PRIVATE-LOCATION-NOTE' not in serialized and 'PRIVATE-EXCLUSION' not in serialized
  assert 'office@example.org' not in serialized and state['exclusions']==[]
  parent.call('audit',status=403);guest.call('audit',status=401)
  parent.call('parents/access',{'parent_id':parent_id,'access_status':'blocked'},403)
  parent.call('locations/update',{'id':location,'name':'Stolen'},403)
  # Partial legacy name updates retain new fields. Invalid edit changes neither state nor audit.
  admin.call('locations/update',{'id':location,'name':'Nowa nazwa'})
  loc=next(l for l in admin.call('state')['locations'] if l['id']==location)
  assert loc['city']=='Poznań' and loc['notes']=='PRIVATE-LOCATION-NOTE'
  top=admin.call('audit')['items'][0]['id']
  admin.call('locations/update',{'id':location,'name':'Wrong','status':'invalid'},400)
  assert admin.call('audit')['items'][0]['id']==top
  admin.call('groups/update',{**body,'id':group,'location_id':other},400)
  assert next(g for g in admin.call('state')['groups'] if g['id']==group)['location_id']==location
  # A late DB failure rolls back both the location and its audit entry.
  top=admin.call('audit')['items'][0]['id']
  with sqlite3.connect(dbpath) as db:
   db.execute("CREATE TRIGGER test_failure BEFORE UPDATE ON groups WHEN NEW.location='Fail transactional' BEGIN SELECT RAISE(ABORT,'Test rollback'); END")
  admin.call('locations/update',{'id':location,'name':'Fail transactional'},400)
  assert admin.call('audit')['items'][0]['id']==top
  assert next(l for l in admin.call('state')['locations'] if l['id']==location)['name']=='Nowa nazwa'
  with sqlite3.connect(dbpath) as db:db.execute('DROP TRIGGER test_failure')
  baseline=admin.call('state');before_balance=baseline['enrollments'][0]['balance']
  for status in ['paused','archived']:
   admin.call('locations/update',{'id':location,'name':'Nowa nazwa','status':status})
   catalog=guest.call('public/catalog')
   assert all(l['id']!=location for l in catalog['locations']) and all(g['id']!=group for g in catalog['groups'])
   assert all(s['group_id']!=group for s in catalog['sessions'])
   guest.call('public/quote',{'group_id':group},400)
   parent.call('quote',{'group_id':group},400)
   parent.call('enrollments',{'group_id':group,'athlete_id':child},400)
   guest.call('public/enroll',{'group_id':group,'child_first_name':'Jan','child_last_name':'Nowy','parent_first_name':'Anna','parent_last_name':'Nowa','email':'new@example.org','phone':'123456789','password':'public-parent-password'},400)
   admin.call('groups',{**body,'name':'Blocked creation'},400)
   own=parent.call('state');assert own['enrollments'][0]['balance']==before_balance and any(g['id']==group for g in own['groups'])
  admin.call('locations/update',{'id':location,'name':'Nowa nazwa','status':'active'})
  assert guest.call('public/quote',{'group_id':group})['amount']==7000
  # Real session revocation and blocked login; no user/data deletion.
  admin.call('parents/access',{'parent_id':parent_id,'access_status':'blocked'})
  parent.call('state',status=401)
  parent.call('auth/login',{'email':'parent@example.org','password':'test-parent-password'},403)
  admin.call('parents/access',{'parent_id':admin_id,'access_status':'blocked'},400)
  admin.call('parents/access',{'parent_id':parent_id,'access_status':'active'})
  parent.call('state',status=401)  # Unblocking does not resurrect the old token.
  parent.call('auth/login',{'email':'parent@example.org','password':'test-parent-password'})
  assert parent.call('state')['athletes'][0]['id']==child
  # Failure of access auditing cannot issue an unlogged session.
  with sqlite3.connect(dbpath) as db:
   session_count=db.execute('SELECT COUNT(*) FROM auth_sessions').fetchone()[0]
   db.execute("CREATE TRIGGER test_access_failure BEFORE INSERT ON audit_logs WHEN NEW.action='session.started' BEGIN SELECT RAISE(ABORT,'Audit unavailable'); END")
  guest.call('auth/login',{'email':'parent@example.org','password':'test-parent-password'},400)
  with sqlite3.connect(dbpath) as db:
   assert db.execute('SELECT COUNT(*) FROM auth_sessions').fetchone()[0]==session_count
   db.execute('DROP TRIGGER test_access_failure')
  # Pending invitation is invalidated by a block.
  pending=admin.call('parents',{'name':'Oczekujący','email':'pending@example.org'},201)['id']
  token=admin.call('parents/invite',{'parent_id':pending})['token']
  admin.call('parents/access',{'parent_id':pending,'access_status':'blocked'})
  guest.call('auth/activate',{'token':token,'password':'pending-parent-password'},400)
  admin.call('parents/invite',{'parent_id':pending},400)
  # Force audit cursor pagination and check each event appears once.
  for i in range(55):admin.call('locations/update',{'id':other,'name':'Drugie','city':f'Miasto {i}'})
  entries=[];cursor=None
  while True:
   page=admin.call('audit'+(f'?before={cursor}' if cursor else ''));entries.extend(page['items']);cursor=page['next_cursor']
   assert len(page['items'])<=50
   if not cursor:break
  assert len({e['id'] for e in entries})==len(entries)>50
  blocked=next(e for e in entries if e['entity_type']=='users' and e['action']=='update' and json.loads(e['after_json'])['access_status']=='blocked')
  assert blocked['actor_id']==admin_id and blocked['request_id']
  assert any(e['entity_type']=='athletes' and e['actor_id']==parent_id for e in entries)
  dump=json.dumps(entries)
  for secret in ['password_hash','token_hash','test-parent-password',token]:assert secret not in dump
  with sqlite3.connect(dbpath) as db:
   assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
   assert [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]==list(range(1,15))
   for query in ['UPDATE audit_logs SET action="tamper"','DELETE FROM audit_logs']:
    try:db.execute(query);raise AssertionError('audit writable')
    except sqlite3.IntegrityError:db.rollback()
   counts={table:db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ['users','athletes','groups','memberships','enrollments','adjustments','audit_logs']}
  p.terminate();p.wait();p=start()
  with sqlite3.connect(dbpath) as db:
   assert all(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==n for table,n in counts.items())
  assert parent.call('state')['enrollments'][0]['balance']==before_balance
  p.terminate();p.wait()
  snapshot=root/'snapshot';restored=root/'restored'
  command('create','--db',str(dbpath),'--logo',str(logo),'--output',str(snapshot))
  command('verify','--source',str(snapshot))
  command('restore','--source',str(snapshot),'--target',str(restored))
  command('restore','--source',str(snapshot),'--target',str(restored),success=False)
  command('create','--db',str(dbpath),'--output',str(snapshot),success=False)
  assert (restored/'logo').read_bytes()==logo.read_bytes()
  with sqlite3.connect(restored/'evolution.sqlite') as db:
   assert all(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==n for table,n in counts.items())
  # Restored app retains access and balances; no writes to the source.
  env['DB_PATH']=str(restored/'evolution.sqlite');env['LOGO_PATH']=str(restored/'logo');p=start()
  assert parent.call('state')['enrollments'][0]['balance']==before_balance
  (snapshot/'logo').write_bytes(b'tampered');command('verify','--source',str(snapshot),success=False)
  print('PASS: statusy i dane placówek, prywatność, blokada kont/sesji/zaproszeń, historia bez sekretów, paginacja audytu, restart, kopia/odtworzenie i wykrycie uszkodzenia')
 finally:
  if p.poll() is None:p.terminate();p.wait()

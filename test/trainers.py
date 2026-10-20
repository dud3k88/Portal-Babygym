"""Trainer role boundaries, account activation/revocation and private notes."""
import http.cookiejar,json,os,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def call(self,path,body=None,status=200):
  req=urllib.request.Request('http://127.0.0.1:3144/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  try:
   with self.http.open(req) as r:data=json.load(r);assert r.status==status,(path,data);return data
  except urllib.error.HTTPError as e:
   data=json.load(e);assert e.code==status,(path,e.code,data);return data
with tempfile.TemporaryDirectory() as folder:
 env={**os.environ,'PORT':'3144','DB_PATH':folder+'/db.sqlite','LOGO_PATH':folder+'/logo','EA_TEST_NOW':'2099-09-01T10:00:00Z'}
 def start():
  p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(60):
   try:Client().call('auth/status');return p
   except urllib.error.URLError:time.sleep(.05)
  p.terminate();p.wait();raise AssertionError('server did not start')
 p=start()
 try:
  admin=Client();parent=Client();trainer=Client();other=Client();guest=Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201)
  parent_id=parent.call('auth/register',{'name':'Rodzic A','email':'parent@example.org','password':'parent-test-password','phone':'123456789'},201)['user']['id']
  other_parent=admin.call('parents',{'name':'Private Family','email':'private-family@example.org'},201)['id']
  child=parent.call('athletes',{'name':'Dziecko A'},201)['id']
  private_child=admin.call('athletes',{'name':'Private Child','parent_id':other_parent},201)['id']
  admin.call('athletes/update',{'id':child,'parent_id':parent_id,'name':'Dziecko A','notes':'ADMIN-SECRET'})
  locations=[admin.call('locations',{'name':'Placówka '+str(i),'notes':'PRIVATE-LOCATION'},201)['id'] for i in range(2)]
  t1=admin.call('trainers',{'name':'Trener A','email':'trainer@example.org','phone':'111222333'},201)['id']
  t2=admin.call('trainers',{'name':'Private Coach','email':'private-coach@example.org'},201)['id']
  base={'name':'Liski','capacity':10,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-10T13:00']}
  g1=admin.call('groups',{**base,'location_id':locations[0],'trainer_ids':[t1]},201)['id']
  g2=admin.call('groups',{**base,'name':'PRIVATE-GROUP','location_id':locations[1],'trainer_ids':[t2]},201)['id']
  parent.call('enrollments',{'group_id':g1,'athlete_id':child},201)
  parent.call('enrollments',{'group_id':g2,'athlete_id':child},201) # Shared child must not leak their other group.
  admin.call('enrollments',{'group_id':g2,'athlete_id':private_child},201)
  token=admin.call('trainers/account',{'trainer_id':t1})['token']
  token2=admin.call('trainers/account',{'trainer_id':t1})['token']
  trainer.call('auth/activate',{'token':token,'password':'trainer-test-password'},400)
  trainer.call('auth/activate',{'token':token2,'password':'trainer-test-password'})
  trainer_user=trainer.call('auth/status')['user'];assert trainer_user['role']=='trainer'
  admin.call('trainers/account',{'trainer_id':t1},400) # no password reset disguised as activation
  token=admin.call('trainers/account',{'trainer_id':t2})['token']
  other.call('auth/activate',{'token':token,'password':'other-trainer-password'})
  state=trainer.call('state');dump=json.dumps(state)
  assert [g['id'] for g in state['groups']]==[g1] and [a['id'] for a in state['athletes']]==[child]
  assert state['parents'][0]['email']=='parent@example.org' and state['parents'][0]['phone']=='123456789'
  assert len(state['memberships'])==1 and state['memberships'][0]['group_id']==g1
  for secret in ['ADMIN-SECRET','PRIVATE-GROUP','Private Child','private-family@example.org','private-coach@example.org','PRIVATE-LOCATION','password_hash','enrollments','adjustments','price']:
   assert secret not in dump,secret
  for path in ['audit','payments','messages','wages','locations','trainers']:
   trainer.call(path,status=403)
  for path in ['groups','groups/update','groups/trainers','athletes','athletes/update','parents','parents/access','parents/invite','quote','enrollments','adjustments','trainers/account','trainers/update','exclusions','messages']:
   trainer.call(path,{'id':g2,'athlete_id':child},403)
  parent.call('trainer-notes',{'athlete_id':child,'body':'Hacked'},403)
  trainer.call('trainer-notes',{'athlete_id':private_child,'body':'Hacked'},404)
  trainer.call('trainer-notes',{'athlete_id':child,'body':'A'*2001},400)
  trainer.call('trainer-notes',{'athlete_id':child,'trainer_id':t2,'body':'TRAINER-A-NOTE'})
  other.call('trainer-notes',{'athlete_id':child,'body':'TRAINER-B-NOTE'})
  assert trainer.call('state')['trainer_notes'][0]['body']=='TRAINER-A-NOTE'
  assert other.call('state')['trainer_notes'][0]['body']=='TRAINER-B-NOTE'
  assert 'TRAINER-A-NOTE' not in json.dumps(parent.call('state'))
  assert len(admin.call('state')['trainer_notes'])==2
  log=next(entry for entry in admin.call('audit')['items'] if entry['entity_type']=='trainer_notes' and 'TRAINER-A-NOTE' in entry['after_json'])
  assert log['actor_id']==trainer_user['id']
  admin.call('groups/trainers',{'group_id':g1,'trainer_ids':[]})
  assert trainer.call('state')['athletes']==[] and trainer.call('state')['trainer_notes']==[]
  trainer.call('trainer-notes',{'athlete_id':child,'body':'Lost access'},404)
  admin.call('groups/trainers',{'group_id':g1,'trainer_ids':[t1]})
  assert trainer.call('state')['trainer_notes'][0]['body']=='TRAINER-A-NOTE'
  for status in ['inactive','archived']:
   admin.call('trainers/update',{'id':t1,'status':status})
   trainer.call('state',status=401)
   trainer.call('auth/login',{'email':'trainer@example.org','password':'trainer-test-password'},403)
   admin.call('trainers/account',{'trainer_id':t1},400)
   admin.call('trainers/update',{'id':t1,'status':'active'})
   trainer.call('state',status=401)
   trainer.call('auth/login',{'email':'trainer@example.org','password':'trainer-test-password'})
  # Changing the login email revokes sessions and retains the same profile and notes.
  admin.call('trainers/update',{'id':t1,'email':'trainer-new@example.org'})
  trainer.call('state',status=401)
  trainer.call('auth/login',{'email':'trainer@example.org','password':'trainer-test-password'},401)
  trainer.call('auth/login',{'email':'trainer-new@example.org','password':'trainer-test-password'})
  assert trainer.call('state')['user']['id']==trainer_user['id']
  # An existing parent account cannot be silently converted to trainer.
  collision=admin.call('trainers',{'name':'Collision','email':'parent@example.org'},201)['id']
  admin.call('trainers/account',{'trainer_id':collision},400)
  admin.call('trainers/update',{'id':t1,'email':'parent@example.org'},400)
  assert trainer.call('state')['user']['email']=='trainer-new@example.org'
  pending=admin.call('trainers',{'name':'Pending','email':'pending@example.org'},201)['id']
  token=admin.call('trainers/account',{'trainer_id':pending})['token']
  admin.call('trainers/update',{'id':pending,'status':'inactive'})
  guest.call('auth/activate',{'token':token,'password':'pending-test-password'},400)
  # Cross-role registration still always creates a parent, never an admin/trainer.
  forged=guest.call('auth/register',{'name':'New parent','email':'new@example.org','password':'new-parent-password','role':'trainer'},201)
  assert forged['user']['role']=='parent'
  with sqlite3.connect(env['DB_PATH']) as db:
   assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
   assert db.execute("SELECT COUNT(*) FROM users WHERE email='trainer-new@example.org'").fetchone()[0]==1
   assert db.execute('SELECT COUNT(*) FROM trainer_notes').fetchone()[0]==2
  p.terminate();p.wait();p=start()
  assert trainer.call('state')['trainer_notes'][0]['body']=='TRAINER-A-NOTE'
  assert len([name for name in os.listdir(folder) if 'before-v2' in name])==1
  print('PASS: trzy role, konto/aktywacja trenera, zakres grup i dzieci, dane opiekuna, izolacja finansów/notatek, odmowa operacji, odebranie przypisania, blokada, kolizje email i restart')
 finally:
  if p.poll() is None:p.terminate();p.wait()

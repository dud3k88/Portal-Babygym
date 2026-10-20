"""MFA, recovery, verified guardian access and immutable payer history."""
import http.cookiejar, json, os, pathlib, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
from mfa_helper import code

NOW='2099-09-01T10:00:00Z'
PORT=3152
class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def call(self,path,body=None,status=200):
  req=urllib.request.Request(f'http://127.0.0.1:{PORT}/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  try:
   with self.http.open(req) as response:
    result=json.load(response);assert response.status==status,(path,response.status,result);return result
  except urllib.error.HTTPError as error:
   result=json.load(error);assert error.code==status,(path,error.code,result);return result

with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp);outbox=root/'outbox'
 env={**os.environ,'PORT':str(PORT),'DB_PATH':str(root/'db.sqlite'),'LOGO_PATH':str(root/'logo'),'EA_TEST_NOW':NOW,'SECURITY_OUTBOX_DIR':str(outbox)}
 def start():
  p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(60):
   try:Client().call('auth/status');return p
   except urllib.error.URLError:time.sleep(.05)
  p.terminate();p.wait();raise AssertionError('server did not start')
 def latest(kind,email):
  entries=[json.loads(file.read_text()) for file in sorted(outbox.glob('*.json'),key=lambda file:file.stat().st_mtime_ns)]
  return [entry for entry in entries if entry['kind']==kind and entry['to']==email][-1]['path'].split('/')[-1]
 def restart(p):
  p.terminate();p.wait();return start()
 def register(client,email):
  return client.call('auth/register',{'name':email.split('@')[0],'email':email,'phone':'123456789','password':'parent-test-password'},201)['user']['id']
 p=start()
 try:
  admin=Client();guest=Client()
  result=admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201)
  assert result['user'] is None and result['mfa_required']
  admin.call('state',status=401)
  seed=admin.call('auth/mfa/setup',{})['secret']
  assert admin.call('auth/mfa/setup',{})['secret']==seed
  guest.call('auth/mfa/setup',{},403)
  admin.call('auth/mfa/verify',{'code':'invalid'},400)
  codes=admin.call('auth/mfa/verify',{'code':code(seed,NOW)})['recovery_codes']
  assert len(codes)==10 and len(set(codes))==10
  admin_id=admin.call('state')['user']['id']
  with sqlite3.connect(env['DB_PATH']) as db:
   assert seed not in db.execute('SELECT secret FROM admin_mfa').fetchone()[0]
   assert codes[0] not in json.dumps(db.execute('SELECT * FROM mfa_recovery').fetchall())
  assert pathlib.Path(env['DB_PATH']+'.mfa-key').stat().st_mode&0o077==0
  admin.call('auth/logout',{})
  admin.call('auth/login',{'email':'admin@example.org','password':'admin-test-password'})
  assert admin.call('auth/status')['user'] is None
  admin.call('state',status=401)
  admin.call('auth/mfa/verify',{'code':code(seed,NOW)},400) # Replay in same time step.
  admin.call('auth/mfa/verify',{'code':codes[0]})
  admin.call('auth/logout',{})
  admin.call('auth/login',{'email':'admin@example.org','password':'admin-test-password'})
  admin.call('auth/mfa/verify',{'code':codes[0]},400)
  admin.call('auth/mfa/verify',{'code':codes[1]})
  # Password reset never authenticates or bypasses MFA; all old sessions end.
  assert guest.call('auth/forgot',{'email':'admin@example.org'})==guest.call('auth/forgot',{'email':'unknown@example.org'})
  old=latest('reset','admin@example.org')
  guest.call('auth/forgot',{'email':'admin@example.org'})
  token=latest('reset','admin@example.org')
  guest.call('auth/reset',{'token':old,'password':'new-admin-password'},400)
  guest.call('auth/reset',{'token':token,'password':'new-admin-password'})
  admin.call('state',status=401)
  guest.call('auth/reset',{'token':token,'password':'stolen-password'},400)
  admin.call('auth/login',{'email':'admin@example.org','password':'new-admin-password'})
  admin.call('state',status=401)
  admin.call('auth/mfa/verify',{'code':codes[2]})
  assert admin.call('state')['user']['id']==admin_id
  p=restart(p) # Also checks persistent encrypted MFA and session survival.
  assert admin.call('state')['user']['id']==admin_id
  a,b,stranger=Client(),Client(),Client()
  aid=register(a,'a@example.org');bid=register(b,'b@example.org');sid=register(stranger,'stranger@example.org')
  child=a.call('athletes',{'name':'Wspólne dziecko'},201)['id']
  private_child=a.call('athletes',{'name':'PRYWATNE RODZEŃSTWO'},201)['id']
  location=admin.call('locations',{'name':'Placówka'},201)['id']
  base={'location_id':location,'name':'Grupa A','capacity':10,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-10T13:00']}
  group=admin.call('groups',base,201)['id'];group2=admin.call('groups',{**base,'name':'Grupa B'},201)['id']
  charge=a.call('enrollments',{'group_id':group,'athlete_id':child},201)['id']
  b.call('athletes/update',{'id':child,'name':'Stolen'},404)
  result=a.call('guardians/invite',{'athlete_id':child,'email':'b@example.org'})
  assert 'token' not in result
  old=latest('guardian','b@example.org')
  a.call('guardians/invite',{'athlete_id':child,'email':'b@example.org'})
  token=latest('guardian','b@example.org')
  b.call('guardians/accept',{'token':old},400)
  stranger.call('guardians/accept',{'token':token},400)
  guest.call('guardians/accept',{'token':token},401)
  assert b.call('state')['athletes']==[]
  assert b.call('guardians/preview',{'token':token})['child']=='Wspólne dziecko'
  b.call('guardians/accept',{'token':token})
  b.call('guardians/accept',{'token':token},400)
  view=b.call('state')
  assert [athlete['id'] for athlete in view['athletes']]==[child]
  assert 'PRYWATNE RODZEŃSTWO' not in json.dumps(view)
  assert len(view['enrollments'])==1 and view['enrollments'][0]['payer_id']==aid
  assert len(view['parents'])==2 and len(view['guardian_links'])==2
  b.call('athletes/update',{'id':child,'name':'Wspólne dziecko nowe','parent_id':bid})
  assert b.call('state')['athletes'][0]['parent_id']==aid
  new_charge=b.call('enrollments',{'group_id':group2,'athlete_id':child},201)['id']
  ledger={entry['id']:entry for entry in a.call('state')['enrollments']}
  assert ledger[charge]['payer_id']==aid and ledger[new_charge]['payer_id']==bid
  # Scope of trainer contact list includes both guardians, never sibling records.
  trainer_id=admin.call('trainers',{'name':'Trener','email':'coach@example.org'},201)['id']
  admin.call('groups/trainers',{'group_id':group,'trainer_ids':[trainer_id]})
  activation=admin.call('trainers/account',{'trainer_id':trainer_id})['token']
  coach=Client();coach.call('auth/activate',{'token':activation,'password':'coach-test-password'})
  contacts=coach.call('state')
  assert {parent['id'] for parent in contacts['parents']}=={aid,bid}
  assert 'PRYWATNE RODZEŃSTWO' not in json.dumps(contacts) and 'enrollments' not in contacts
  coach.call('guardians/invite',{'athlete_id':child,'email':'stranger@example.org'},403)
  b.call('guardians/revoke',{'athlete_id':child,'user_id':aid},403)
  # Revocation also cancels invitations issued by the removed guardian.
  b.call('guardians/invite',{'athlete_id':child,'email':'stranger@example.org'})
  downstream=latest('guardian','stranger@example.org')
  a.call('guardians/revoke',{'athlete_id':child,'user_id':bid})
  b.call('athletes/update',{'id':child,'name':'No access'},404)
  assert b.call('state')['athletes']==[] and b.call('state')['enrollments']==[]
  stranger.call('guardians/accept',{'token':downstream},400)
  assert {parent['id'] for parent in coach.call('state')['parents']}=={aid}
  # Cancel and expiry never grant access.
  a.call('guardians/invite',{'athlete_id':child,'email':'b@example.org'})
  invitation=a.call('state')['guardian_invitations'][0];cancelled=latest('guardian','b@example.org')
  a.call('guardians/cancel',{'athlete_id':child,'id':invitation['id']})
  b.call('guardians/accept',{'token':cancelled},400)
  a.call('guardians/invite',{'athlete_id':child,'email':'b@example.org'})
  expired_guardian=latest('guardian','b@example.org')
  with sqlite3.connect(env['DB_PATH']) as db:
   db.create_function('audit_actor_id',0,lambda:None);db.create_function('audit_request_id',0,lambda:None);db.create_function('audit_timestamp',0,lambda:NOW)
   db.execute('UPDATE guardian_invitations SET expires_at=0')
  b.call('guardians/accept',{'token':expired_guardian},400)
  # Changing primary parent must preserve historical payer snapshots.
  admin.call('athletes/update',{'id':child,'name':'Wspólne dziecko nowe','parent_id':sid})
  history={entry['id']:entry for entry in admin.call('state')['enrollments']}
  assert history[charge]['email']=='a@example.org' and history[charge]['parent']=='a'
  assert history[new_charge]['email']=='b@example.org'
  assert a.call('state')['athletes'][0]['id']==private_child
  # Block/reset invalidation and expired reset.
  guest.call('auth/forgot',{'email':'b@example.org'});blocked_token=latest('reset','b@example.org')
  admin.call('parents/access',{'parent_id':bid,'access_status':'blocked'})
  guest.call('auth/reset',{'token':blocked_token,'password':'cannot-reset-password'},400)
  guest.call('auth/forgot',{'email':'a@example.org'});expired=latest('reset','a@example.org')
  with sqlite3.connect(env['DB_PATH']) as db:db.execute('UPDATE password_resets SET expires_at=0')
  guest.call('auth/reset',{'token':expired,'password':'cannot-reset-password'},400)
  # Secret values never appear in audit, state or public catalog.
  serialized=json.dumps(admin.call('audit'))+json.dumps(admin.call('state'))+json.dumps(guest.call('public/catalog'))
  for secret in [seed,*codes,token,downstream,blocked_token,expired]:assert secret not in serialized
  p=restart(p)
  # Lost phone: password + unused recovery code can replace the device, but the
  # admin remains restricted until confirming TOTP from the NEW secret.
  device=Client();device.call('auth/login',{'email':'admin@example.org','password':'new-admin-password'})
  device.call('auth/mfa/verify',{'code':codes[3],'replace_device':True})
  admin.call('state',status=401);device.call('state',status=401)
  fresh_seed=device.call('auth/mfa/setup',{})['secret'];assert fresh_seed!=seed
  device.call('auth/mfa/verify',{'code':codes[4]},400)
  codes=device.call('auth/mfa/verify',{'code':code(fresh_seed,NOW)})['recovery_codes']
  admin=device
  # Persistent per-account MFA limit remains across restart; recovery cannot bypass it.
  locked=Client();locked.call('auth/login',{'email':'admin@example.org','password':'new-admin-password'})
  for _ in range(5):locked.call('auth/mfa/verify',{'code':'invalid'},400)
  p=restart(p)
  locked.call('auth/mfa/verify',{'code':codes[3]},429)
  admin.call('state') # Already verified separate session is not accidentally disabled.
  assert all(file.stat().st_mode&0o077==0 for file in outbox.glob('*.json'))
  with sqlite3.connect(env['DB_PATH']) as db:assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  p.terminate();p.wait()
  def backup(*args):
   result=subprocess.run(['python3','scripts/backup.py',*args],capture_output=True,text=True)
   assert result.returncode==0,result.stderr
  backup('create','--db',env['DB_PATH'],'--output',str(root/'backup'))
  assert (root/'backup/evolution.sqlite.mfa-key').is_file()
  backup('restore','--source',str(root/'backup'),'--target',str(root/'restored'))
  env['DB_PATH']=str(root/'restored/evolution.sqlite')
  p=start();assert admin.call('state')['user']['id']==admin_id
  p.terminate();p.wait()
  key=pathlib.Path(env['DB_PATH']+'.mfa-key');saved_key=key.read_bytes();key.unlink()
  failed=subprocess.run(['node','server.js'],env=env,capture_output=True,text=True,timeout=5)
  assert failed.returncode!=0 and 'MFA_KEY_PATH' in failed.stderr and not key.exists()
  key.write_bytes(saved_key);key.chmod(0o600)
  failed=subprocess.run(['node','server.js'],env={**env,'MFA_ENCRYPTION_KEY':'00'*32},capture_output=True,text=True,timeout=5)
  assert failed.returncode!=0 and 'MFA_KEY_PATH' in failed.stderr
  p=start()
  print('PASS: MFA/replay/recovery, reset, szyfrowanie, limity po restarcie, opiekunowie i cofanie dostępu, izolacja rodzeństwa/trenera, płatnik, kopia z kluczem i odmowa startu bez właściwego klucza')
 finally:p.terminate();p.wait()

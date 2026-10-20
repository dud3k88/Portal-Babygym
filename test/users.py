"""User directory, administrator activation, roles, access and pagination."""
import http.cookiejar,json,os,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
from mfa_helper import enroll
PORT=3172
class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def call(self,path,body=None,status=200):
  req=urllib.request.Request(f'http://127.0.0.1:{PORT}/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  try:
   with self.http.open(req) as response:
    result=json.load(response);assert response.status==status,(path,response.status,result);return result
  except urllib.error.HTTPError as error:
   result=json.load(error);assert error.code==status,(path,error.code,result);return result

with tempfile.TemporaryDirectory() as folder:
 env={**os.environ,'PORT':str(PORT),'DB_PATH':folder+'/db.sqlite','LOGO_PATH':folder+'/logo','EA_TEST_NOW':'2099-09-01T10:00:00Z'}
 p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
 try:
  for _ in range(80):
   try:Client().call('auth/status');break
   except urllib.error.URLError:time.sleep(.05)
  admin,second,parent,trainer,guest=Client(),Client(),Client(),Client(),Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201)
  admin.call('users',status=401)
  enroll(admin.call,env['EA_TEST_NOW'])
  first=admin.call('auth/status')['user']['id']
  admin.call('users/access',{'id':first,'access_status':'blocked'},400)
  new={'name':'Drugi Admin','email':'second@example.org','phone':'123456789','role':'admin'}
  added=admin.call('users',new,201)
  admin.call('users',new,400)
  admin.call('users',{**new,'email':'bad@example.org','role':'owner'},400)
  assert admin.call('users?role=admin&activation=pending')['total']==1
  token=admin.call('users/invite',{'id':added['id']})['token']
  second.call('auth/activate',{'token':added['token'],'password':'second-test-password'},400)
  second.call('auth/activate',{'token':token,'password':'second-test-password'})
  assert second.call('auth/status')['mfa_required']
  second.call('users',status=401)
  enroll(second.call,env['EA_TEST_NOW'])
  assert second.call('users')['total']==2
  admin.call('users/invite',{'id':added['id']},400)
  second.call('users/update',{'id':first,'name':'Admin poprawiony','phone':'987'})
  assert admin.call('auth/status')['user']['name']=='Admin poprawiony'
  admin.call('users/update',{'id':added['id'],'name':'Nowy','role':'parent'},400)
  admin.call('users/update',{'id':added['id'],'name':'Nowy','email':'replacement@example.org'},400)
  second.call('users/access',{'id':first,'access_status':'blocked'})
  admin.call('users',status=401)
  second.call('users/access',{'id':added['id'],'access_status':'blocked'},400)
  admin.call('auth/login',{'email':'admin@example.org','password':'admin-test-password'},403)
  second.call('users/access',{'id':first,'access_status':'active'})
  admin.call('users',status=401) # unblocking does not restore revoked sessions
  for role,client in [('parent',parent),('trainer',trainer)]:
   result=second.call('users',{'name':role,'email':role+'@example.org','role':role},201)
   client.call('auth/activate',{'token':result['token'],'password':'test-password-123'})
   for path in ['users','users?role=admin']:
    client.call(path,status=403)
   for path in ['users','users/update','users/access','users/invite']:
    client.call(path,{'id':added['id'],'name':'Hacked','role':'admin','access_status':'blocked'},403)
   second.call('users/update',{'id':result['id'],'name':role+' Edited','phone':'456'})
   if role=='trainer':
    profile=[x for x in second.call('state')['trainers'] if x['user_id']==result['id']][0]
    assert profile['name']=='trainer Edited' and profile['phone']=='456'
    second.call('trainers/update',{'id':profile['id'],'status':'inactive'})
    second.call('users/access',{'id':result['id'],'access_status':'active'},400)
    second.call('trainers/update',{'id':profile['id'],'status':'active'})
   second.call('users/access',{'id':result['id'],'access_status':'blocked'})
   client.call('state',status=401)
  guest.call('users',status=401)
  assert second.call('users?status=blocked')['total']==2
  assert second.call('users?search=second%40example.org')['total']==1
  assert second.call('users?search=%25')['total']==0
  second.call('users?page=0',status=400);second.call('users?role=owner',status=400)
  # Pagination with real account creation; no password/session data in list or audit.
  for i in range(51):second.call('users',{'name':f'Rodzic {i:02}','email':f'p{i}@example.org','role':'parent'},201)
  one=second.call('users?role=parent');two=second.call('users?role=parent&page=2')
  assert one['total']==52 and len(one['items'])==50 and len(two['items'])==2
  assert not ({u['id'] for u in one['items']}&{u['id'] for u in two['items']})
  serialized=json.dumps(second.call('users'))
  assert 'password_hash' not in serialized and 'token_hash' not in serialized and token not in serialized
  audit=json.dumps(second.call('audit'))
  assert token not in audit and 'password_hash' not in audit
  print('PASS: użytkownicy, tworzenie trzech ról, aktywacja admina z MFA, izolacja, edycja profilu trenera, blokada i unieważnienie sesji, ochrona własnego admina, filtry, paginacja, prywatność')
 finally:p.terminate();p.wait()

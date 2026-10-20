"""Seasons, signup gates, month-end withdrawal and return across Warsaw midnight."""
import http.cookiejar,json,os,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
from mfa_helper import enroll
PORT=3162
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
 env={**os.environ,'PORT':str(PORT),'DB_PATH':folder+'/db.sqlite','LOGO_PATH':folder+'/logo','EA_TEST_NOW':'2099-09-30T10:00:00Z'}
 def start():
  p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(80):
   try:Client().call('auth/status');return p
   except urllib.error.URLError:time.sleep(.05)
  p.terminate();p.wait();raise AssertionError('Server did not start')
 p=start()
 try:
  admin,parent,other,guest=Client(),Client(),Client(),Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201)
  enroll(admin.call,env['EA_TEST_NOW'])
  parent_id=parent.call('auth/register',{'name':'Anna','email':'anna@example.org','password':'parent-test-password'},201)['user']['id']
  other.call('auth/register',{'name':'Inna rodzina','email':'other@example.org','password':'other-test-password'},201)
  child=parent.call('athletes',{'name':'Jan'},201)['id'];other_child=other.call('athletes',{'name':'Inne dziecko'},201)['id']
  season_body={'name':'2099 / 2100','start_date':'2099-09-01','end_date':'2100-06-30'}
  season=admin.call('seasons',season_body,201)['id']
  admin.call('seasons',{**season_body,'name':'  2099   / 2100  '},400)
  parent.call('seasons',season_body,403);guest.call('seasons',season_body,401)
  admin.call('seasons',{**season_body,'name':'Nieprawidłowy','start_date':'2100-02-29'},400)
  future=admin.call('seasons',{'name':'Następny','start_date':'2100-09-01','end_date':'2101-06-30'},201)['id']
  location=admin.call('locations',{'name':'Placówka'},201)['id']
  base={'location_id':location,'name':'Liski','capacity':1,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-30T15:00','2099-10-05T15:00']}
  group=admin.call('groups',base,201)['id']
  assert admin.call('state')['groups'][0]['season_id'] is None
  admin.call('groups/lifecycle',{'id':group,'season_id':season})
  admin.call('groups/lifecycle',{'id':group,'season_id':None},400)
  admin.call('groups/lifecycle',{'id':group,'season_id':future},400)
  parent.call('groups/lifecycle',{'id':group,'registration_open':True},403)
  charge=parent.call('enrollments',{'athlete_id':child,'group_id':group},201)['id']
  initial=parent.call('state')
  original_terms=initial['sessions'];original_charges=initial['enrollments']
  # Status changes close the catalog and every quote/signup endpoint, without
  # touching existing terms, memberships or amounts.
  for change in [{'status':'planned'},{'status':'paused'},{'status':'ended'},{'status':'active','registration_open':False}]:
   admin.call('groups/lifecycle',{'id':group,**change})
   assert guest.call('public/catalog')['groups']==[]
   assert other.call('state')['groups']==[]
   guest.call('public/quote',{'group_id':group},400)
   parent.call('quote',{'group_id':group},400)
   other.call('enrollments',{'athlete_id':other_child,'group_id':group},400)
   own=parent.call('state')
   assert own['sessions']==original_terms and own['enrollments']==original_charges
   assert own['groups'][0]['registration_available'] is False
  admin.call('groups/lifecycle',{'id':group,'status':'active','registration_open':True})
  admin.call('seasons/update',{**season_body,'id':season,'status':'archived'})
  assert guest.call('public/catalog')['groups']==[]
  admin.call('groups',{**base,'season_id':season},400)
  admin.call('seasons/update',{**season_body,'id':season,'status':'active','start_date':'2099-10-01'},400)
  admin.call('seasons/update',{**season_body,'id':season,'status':'active'})
  admin.call('groups',{**base,'name':'Poza datami','season_id':future},400)
  future_group=admin.call('groups',{**base,'name':'Grupa przyszłego sezonu','season_id':future,'dates':['2100-09-10T15:00']},201)['id']
  assert all(g['id']!=future_group for g in guest.call('public/catalog')['groups'])
  guest.call('public/quote',{'group_id':future_group},400)
  # Current trainer sees the child until the effective end, but no withdrawal reason.
  trainer_id=admin.call('trainers',{'name':'Trener','email':'trainer@example.org'},201)['id']
  admin.call('groups/trainers',{'group_id':group,'trainer_ids':[trainer_id]})
  token=admin.call('trainers/account',{'trainer_id':trainer_id})['token']
  coach=Client();coach.call('auth/activate',{'token':token,'password':'coach-test-password'})
  body={'athlete_id':child,'group_id':group,'month':'2099-09','reason':'PRYWATNY POWÓD'}
  other.call('memberships/withdraw',body,404);coach.call('memberships/withdraw',body,403)
  parent.call('memberships/withdraw',{**body,'month':'2099-08'},400)
  parent.call('memberships/withdraw',{**body,'reason':''},400)
  end=parent.call('memberships/withdraw',{**body,'ends_at':'2099-09-30T12:00:00'})['ends_at']
  assert end=='2099-10-01T00:00:00'
  audit_count=admin.call('audit')['items'][0]['id']
  parent.call('memberships/withdraw',body)
  assert admin.call('audit')['items'][0]['id']==audit_count
  own=parent.call('state')
  assert own['memberships'][0]['status']=='active' and own['groups'][0]['member_count']==1
  assert own['enrollments']==original_charges and own['adjustments']==[]
  assert 'PRYWATNY POW' not in json.dumps(coach.call('state'))
  other.call('enrollments',{'athlete_id':other_child,'group_id':group},400)
  parent.call('memberships/cancel-withdrawal',body)
  assert parent.call('state')['memberships'][0]['ends_at'] is None
  parent.call('memberships/withdraw',body)
  # Transaction failure cannot partly withdraw or add audit events.
  with sqlite3.connect(env['DB_PATH']) as db:
   db.execute("CREATE TRIGGER fail_period BEFORE UPDATE ON membership_periods BEGIN SELECT RAISE(ABORT,'rollback test');END")
  audit_count=admin.call('audit')['items'][0]['id']
  parent.call('memberships/cancel-withdrawal',body,400)
  assert parent.call('state')['memberships'][0]['ends_at']==end and admin.call('audit')['items'][0]['id']==audit_count
  with sqlite3.connect(env['DB_PATH']) as db:db.execute('DROP TRIGGER fail_period')
  # First next-month midnight in Poland is 22:00 UTC on the previous date.
  p.terminate();p.wait();env['EA_TEST_NOW']='2099-09-30T21:59:59Z';p=start()
  assert parent.call('state')['memberships'][0]['status']=='active'
  p.terminate();p.wait();env['EA_TEST_NOW']='2099-09-30T22:00:00Z';p=start()
  own=parent.call('state')
  assert own['memberships'][0]['status']=='ended' and own['groups'][0]['member_count']==0
  assert own['enrollments']==original_charges
  assert coach.call('state')['athletes']==[] and coach.call('state')['parents']==[]
  coach.call('trainer-notes',{'athlete_id':child,'body':'No longer allowed'},404)
  parent.call('memberships/cancel-withdrawal',{**body,'month':'2099-10'},400)
  # An ended row cannot bypass capacity during return.
  other.call('enrollments',{'athlete_id':other_child,'group_id':group},201)
  parent.call('enrollments',{'athlete_id':child,'group_id':group},400)
  assert len(parent.call('state')['membership_periods'])==1
  admin.call('groups/update',{**base,'id':group,'season_id':season,'capacity':2})
  returned=parent.call('enrollments',{'athlete_id':child,'group_id':group},201)['id']
  parent.call('enrollments',{'athlete_id':child,'group_id':group},400)
  own=parent.call('state')
  assert len(own['athletes'])==1 and len(own['memberships'])==1 and len(own['membership_periods'])==2
  assert own['memberships'][0]['status']=='active' and own['memberships'][0]['ends_at'] is None
  ledger={entry['id']:entry for entry in own['enrollments']}
  assert ledger[charge]['amount']==3500 and ledger[returned]['amount']==3500
  assert ledger[charge]['payer_id']==parent_id and ledger[returned]['payer_id']==parent_id
  assert own['groups'][0]['member_count']==2
  # A pre-existing future charge (legacy data) must be settled explicitly.
  # Later calendar edits cannot bill an ended participation period again.
  legacy_child=parent.call('athletes',{'name':'Przyszłe stare naliczenie'},201)['id']
  legacy_body={**base,'name':'Historia przyszłych należności','capacity':10,'dates':['2099-10-05T15:00','2099-11-05T15:00']}
  legacy_group=admin.call('groups',legacy_body,201)['id']
  parent.call('enrollments',{'athlete_id':legacy_child,'group_id':legacy_group},201)
  with sqlite3.connect(env['DB_PATH']) as db:
   db.create_function('audit_actor_id',0,lambda:None);db.create_function('audit_request_id',0,lambda:None);db.create_function('audit_timestamp',0,lambda:'2099-10-01T00:00:00Z')
   future_charge=db.execute("INSERT INTO enrollments(group_id,parent,email,child,month,amount,created_at,athlete_id,payer_id) VALUES(?,'Anna','anna@example.org','Przyszłe stare naliczenie','2099-11',3500,'2099-10-01T00:00:00',?,?)",(legacy_group,legacy_child,parent_id)).lastrowid
   future_term=db.execute("SELECT id FROM sessions WHERE group_id=? AND starts_at LIKE '2099-11%'",(legacy_group,)).fetchone()[0]
   db.execute('INSERT INTO enrollment_sessions VALUES(?,?,3500)',(future_charge,future_term))
  legacy_withdrawal={'athlete_id':legacy_child,'group_id':legacy_group,'month':'2099-10','reason':'Koniec udziału'}
  parent.call('memberships/withdraw',legacy_withdrawal,400)
  admin.call('adjustments',{'enrollment_id':future_charge,'amount':-3500,'reason':'Rozliczenie wcześniejszego naliczenia za przyszły miesiąc'},201)
  parent.call('memberships/withdraw',legacy_withdrawal)
  admin.call('groups/update',{**legacy_body,'id':legacy_group,'dates':legacy_body['dates']+['2099-11-12T15:00']})
  assert next(entry for entry in parent.call('state')['enrollments'] if entry['id']==future_charge)['balance']==0
  with sqlite3.connect(env['DB_PATH']) as db:assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
  print('PASS: sezony/statusy/bramki zapisów, daty i historia, rezygnacja bez korekt, idempotencja/rollback, północ Warszawy, odebranie dostępu trenerowi, limit miejsc i powrót do jednej kartoteki')
 finally:p.terminate();p.wait()

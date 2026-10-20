"""Seasons, signup gates, month-end withdrawal and return across Warsaw midnight."""
import http.cookiejar,json,os,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
from mfa_helper import enroll
PORT=3182
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
 env={**os.environ,'PORT':str(PORT),'DB_PATH':folder+'/db.sqlite','LOGO_PATH':folder+'/logo','EA_TEST_NOW':'2099-09-01T08:00:00Z'}
 def start():
  p=subprocess.Popen(['node','--import','./scripts/fixed-clock.mjs','server.js'],env=env,stdout=subprocess.DEVNULL)
  for _ in range(80):
   try:Client().call('auth/status');return p
   except urllib.error.URLError:time.sleep(.05)
  p.terminate();p.wait();raise AssertionError('server did not start')
 p=start()
 def advance(now):
  global p
  p.terminate();p.wait();env['EA_TEST_NOW']=now;p=start()
 try:
  admin,parent,other,third,guest=Client(),Client(),Client(),Client(),Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201);enroll(admin.call,env['EA_TEST_NOW'])
  kids=[]
  for i,client in enumerate([parent,other,third]):
   client.call('auth/register',{'name':f'Rodzic {i}','email':f'p{i}@example.org','password':'parent-test-password'},201)
   kids.append(client.call('athletes',{'name':f'Dziecko {i}'},201)['id'])
  location=admin.call('locations',{'name':'Placówka'},201)['id']
  base={'location_id':location,'name':'Próby','capacity':1,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-01T13:00','2099-09-08T13:00','2099-09-15T13:00']}
  g=admin.call('groups',base,201)['id'];g2=admin.call('groups',{**base,'name':'Kolejka'},201)['id']
  state=admin.call('state');term=next(s['id'] for s in state['sessions'] if s['group_id']==g)
  term2=next(s['id'] for s in state['sessions'] if s['group_id']==g2)
  trial=parent.call('enrollments',{'group_id':g,'athlete_id':kids[0],'trial_id':term},201)
  parent.call('enrollments',{'group_id':g2,'athlete_id':kids[0],'trial_id':term2},201)
  paid_group=admin.call('groups',{**base,'name':'Płatna próba','trial_price':1000},201)['id']
  paid_term=next(s['id'] for s in admin.call('state')['sessions'] if s['group_id']==paid_group)
  paid=parent.call('enrollments',{'group_id':paid_group,'athlete_id':kids[0],'trial_id':paid_term},201)
  assert paid['amount']==1000
  assert trial['amount']==0
  parent.call('trials/quote',{'id':trial['id'],'athlete_id':kids[0]},400)
  parent.call('memberships/cancel-withdrawal',{'group_id':g,'athlete_id':kids[0],'month':'2099-09'},400)
  first=other.call('waiting/join',{'group_id':g2,'athlete_id':kids[1]})['waiting_id']
  second=third.call('waiting/join',{'group_id':g2,'athlete_id':kids[2]})['waiting_id']
  assert other.call('waiting/join',{'group_id':g2,'athlete_id':kids[1]})['waiting_id']==first
  assert third.call('state')['waiting_list'][0]['position']==2
  assert parent.call('state')['waiting_list']==[]
  other.call('waiting/cancel',{'id':second,'athlete_id':kids[2]},404)
  parent.call('admissions/settings',{'trial_hours':48,'offer_hours':48},403)
  admin.call('admissions/settings',{'trial_hours':0,'offer_hours':24},400)
  original=parent.call('state')['trial_decisions'][0]['expires_at']
  admin.call('admissions/settings',{'trial_hours':48,'offer_hours':24})
  assert parent.call('state')['trial_decisions'][0]['expires_at']==original
  paid_deadline=next(t['expires_at'] for t in parent.call('state')['trial_decisions'] if t['enrollment_id']==paid['id'])
  admin.call('groups/update',{**base,'id':paid_group,'name':'Płatna próba','trial_price':1000,'dates':['2099-09-01T14:00','2099-09-08T13:00','2099-09-15T13:00']})
  assert next(t['expires_at'] for t in parent.call('state')['trial_decisions'] if t['enrollment_id']==paid['id'])==paid_deadline+3600000
  advance('2099-09-01T13:00:00Z') # Warsaw 15:00; fallback one-hour trial ended at 14:00
  q=parent.call('trials/quote',{'id':trial['id'],'athlete_id':kids[0],'month':'2099-09'})
  assert q=={'amount':7000,'count':2}
  other.call('trials/convert',{'id':trial['id'],'athlete_id':kids[0],'expected_amount':7000},404)
  parent.call('trials/convert',{'id':trial['id'],'athlete_id':kids[0],'expected_amount':1},400)
  with sqlite3.connect(env['DB_PATH']) as db:
   db.execute("CREATE TRIGGER fail_conversion BEFORE UPDATE ON memberships WHEN NEW.status='active' BEGIN SELECT RAISE(ABORT,'forced conversion failure'); END")
  parent.call('trials/convert',{'id':trial['id'],'athlete_id':kids[0],'expected_amount':7000},400)
  assert parent.call('state')['trial_decisions'][0]['status']=='pending'
  with sqlite3.connect(env['DB_PATH']) as db:db.execute('DROP TRIGGER fail_conversion')
  result=parent.call('trials/convert',{'id':trial['id'],'athlete_id':kids[0],'expected_amount':7000})
  assert parent.call('trials/convert',{'id':trial['id'],'athlete_id':kids[0],'expected_amount':7000})['id']==result['id']
  state=parent.call('state');charges=[e for e in state['enrollments'] if e['group_id']==g]
  assert len(charges)==2 and sum(e['balance'] for e in charges)==7000
  assert next(e for e in charges if e['id']==trial['id'])['amount']==0
  assert len([x for x in state['membership_periods'] if x['group_id']==g])==2
  parent.call('trials/convert',{'id':paid['id'],'athlete_id':kids[0],'expected_amount':7000})
  paid_charges=[e for e in parent.call('state')['enrollments'] if e['group_id']==paid_group]
  assert len(paid_charges)==2 and sum(e['balance'] for e in paid_charges)==8000
  # Deadline survives restart and settings changes; releases at exact local 14:00.
  advance('2099-09-02T11:59:59Z');assert other.call('state')['waiting_list'][0]['status']=='waiting'
  advance('2099-09-02T12:00:00Z');state=other.call('state');assert state['waiting_list'][0]['status']=='offered'
  assert third.call('state')['waiting_list'][0]['status']=='waiting'
  public=guest.call('public/catalog');row=next(x for x in public['groups'] if x['id']==g2)
  assert row['member_count']==0 and row['reserved_count']==1
  third.call('enrollments',{'group_id':g2,'athlete_id':kids[2]},400)
  parent.call('trials/quote',{'id':trial['id']+1,'athlete_id':kids[0]},400)
  other.call('waiting/accept',{'id':first,'athlete_id':kids[1],'expected_amount':1},400)
  assert other.call('state')['waiting_list'][0]['status']=='offered'
  # Let first offer expire: second in FIFO receives reserved seat, first cannot accept.
  advance('2099-09-03T12:00:00Z');assert other.call('state')['waiting_list'][0]['status']=='expired'
  assert third.call('state')['waiting_list'][0]['status']=='offered'
  other.call('waiting/accept',{'id':first,'athlete_id':kids[1],'expected_amount':7000},400)
  from concurrent.futures import ThreadPoolExecutor
  with ThreadPoolExecutor(max_workers=2) as pool:
   results=list(pool.map(lambda _:third.call('waiting/accept',{'id':second,'athlete_id':kids[2],'expected_amount':7000,'month':'2099-09'}),range(2)))
  accepted=results[0];assert results[1]['id']==accepted['id']
  assert third.call('waiting/accept',{'id':second,'athlete_id':kids[2],'expected_amount':7000})['id']==accepted['id']
  assert next(x for x in guest.call('public/catalog')['groups'] if x['id']==g2)['member_count']==1
  # Closed registration pauses offers; cancellation gives the next child the offer.
  g3=admin.call('groups',{**base,'name':'Oferta'},201)['id']
  a=other.call('waiting/join',{'group_id':g3,'athlete_id':kids[1]})['waiting_id']
  b=third.call('waiting/join',{'group_id':g3,'athlete_id':kids[2]})['waiting_id']
  admin.call('groups/lifecycle',{'id':g3,'registration_open':False})
  assert next(x for x in other.call('state')['waiting_list'] if x['id']==a)['status']=='waiting'
  other.call('waiting/accept',{'id':a,'athlete_id':kids[1],'expected_amount':7000},400)
  admin.call('groups/lifecycle',{'id':g3,'registration_open':True})
  other.call('waiting/cancel',{'id':a,'athlete_id':kids[1]})
  assert next(x for x in third.call('state')['waiting_list'] if x['id']==b)['status']=='offered'
  # Public full-group opt-in creates account+child+queue only, no amount/membership.
  queued=guest.call('public/enroll',{'group_id':g2,'waitlist':True,'child_first_name':'Jan','child_last_name':'Nowy','parent_first_name':'Anna','parent_last_name':'Nowa','email':'new@example.org','phone':'123456789','password':'public-test-password'},201)
  assert queued['queued'];state=guest.call('state');assert not state['memberships'] and not state['enrollments'] and len(state['waiting_list'])==1
  assert len(state['athletes'])==1
  print('PASS: próba, jawna konwersja i kwota, osobna historia naliczeń, brak duplikatów, deadline/restart, FIFO/oferty/wygaśnięcie/odmowa obejścia, zamknięcie zapisów, ustawienia i publiczna kolejka bez opłaty')
 finally:p.terminate();p.wait()

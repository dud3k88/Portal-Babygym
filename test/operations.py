"""Operational modules: finance, attendance, scoped workspace, payroll, imports and merges."""
import http.cookiejar,json,os,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
from mfa_helper import enroll
PORT=3192
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
  p.terminate();p.wait();raise AssertionError('server not ready')
 p=start()
 try:
  admin,parent,other,coach=Client(),Client(),Client(),Client()
  admin.call('auth/setup',{'name':'Admin','email':'admin@example.org','password':'admin-test-password'},201);recovery=enroll(admin.call,env['EA_TEST_NOW'])
  parent.call('auth/register',{'name':'Rodzic','email':'parent@example.org','password':'parent-test-password'},201)
  other.call('auth/register',{'name':'Inny','email':'other@example.org','password':'parent-test-password'},201)
  child=parent.call('athletes',{'name':'Dziecko'},201)['id']
  result=admin.call('users',{'name':'Trener','email':'coach@example.org','role':'trainer'},201);coach.call('auth/activate',{'token':result['token'],'password':'coach-test-password'})
  trainer=admin.call('state')['trainers'][0]['id']
  location=admin.call('locations',{'name':'Placówka'},201)['id']
  group=admin.call('groups',{'name':'Grupa','location_id':location,'capacity':10,'price':3500,'trial_price':0,'trials':True,'trainer_ids':[trainer],'dates':['2099-09-01T13:00','2099-09-08T13:00']},201)['id']
  charge=parent.call('enrollments',{'group_id':group,'athlete_id':child},201)['id']
  session=parent.call('calendar?from=2099-09-01&to=2099-09-30')['items'][0]['id']
  assert not other.call('calendar?from=2099-09-01&to=2099-09-30')['items']
  other.call('calendar/detail?id='+str(session),status=404)
  parent.call('calendar/absence',{'session_id':session,'athlete_id':child,'active':True})
  coach.call('calendar/mark',{'session_id':session,'athlete_id':child,'status':'present'},400)
  parent.call('calendar/mark',{'session_id':session,'athlete_id':child,'status':'present'},403)
  p.terminate();p.wait();env['EA_TEST_NOW']='2099-09-01T13:00:00Z';p=start()
  coach.call('calendar/mark',{'session_id':session,'athlete_id':child,'status':'present'})
  coach.call('calendar/complete',{'session_id':session,'completed':True})
  coach.call('calendar/complete',{'session_id':session,'completed':True})
  assert parent.call('calendar/detail?id='+str(session))['children'][0]['stamps']==1
  coach.call('calendar/mark',{'session_id':session,'athlete_id':child,'status':'absent'},400)
  coach.call('calendar/mark',{'session_id':session,'athlete_id':child,'status':'absent','reason':'Korekta'})
  assert parent.call('calendar/detail?id='+str(session))['children'][0]['stamps']==0
  parent.call('finance/payment',{'athlete_id':child,'amount':3000,'reference':'A','date':'2099-09-01'},403)
  pay={'athlete_id':child,'amount':3000,'reference':'A','date':'2099-09-01'}
  first=admin.call('finance/payment',pay)['id'];assert admin.call('finance/payment',pay)['duplicate']
  assert parent.call('state')['enrollments'][0]['balance']==4000
  second=admin.call('finance/payment',{**pay,'reference':'B','amount':5000})['id']
  state=parent.call('state');assert state['enrollments'][0]['balance']==0
  assert next(p for p in state['finance']['payments'] if p['id']==second)['credit']==1000
  assert not other.call('state')['finance']['payments']
  assert admin.call('finance/generate',{'month':'2099-09'})['created']==0
  refund=admin.call('finance/refund',{'payment_id':second,'amount':1000,'reference':'R','reason':'Nadpłata'})['id']
  admin.call('finance/refund',{'payment_id':second,'amount':1,'reference':'R2','reason':'Nadpłata'},400)
  admin.call('finance/refundPaid',{'id':refund,'date':'2099-09-01'})
  assert next(p for p in parent.call('state')['finance']['payments'] if p['id']==second)['credit']==0
  # Private conversations and published progress cannot cross families.
  conversation=parent.call('workspace/message',{'subject':'Pytanie','body':'Treść'})['id']
  other.call('workspace/thread?id='+str(conversation),status=404)
  coach.call('workspace/thread?id='+str(conversation),status=404)
  admin.call('workspace/message',{'id':conversation,'body':'Odpowiedź'})
  assert len(parent.call('workspace/thread?id='+str(conversation))['messages'])==2
  assert parent.call('workspace')['notifications']
  program=admin.call('library/program',{'name':'Program','min_age':3,'max_age':7,'description':'Opis'})['id']
  skill=admin.call('library/skill',{'program_id':program,'name':'Równowaga','criteria':'Kryterium','stage':'Etap 1'})['id']
  assessment={'athlete_id':child,'skill_id':skill,'status':'learning','comment':'Wewnętrzne','published':False}
  coach.call('library/assess',assessment)
  assert not parent.call('library')['assessments']
  coach.call('library/assess',{**assessment,'comment':'Postęp','published':True})
  assert len(parent.call('library')['assessments'])==1
  assert not other.call('library')['children']
  other.call('library/card',{'athlete_id':child,'hero':'fox'},403)
  # Stock movement rolls back as a whole when source stock is insufficient.
  location2=admin.call('locations',{'name':'Inna placówka'},201)['id']
  equipment=admin.call('workspace/equipmentSave',{'name':'Piłki','category':'Zabawy'})['id']
  stock={'equipment_id':equipment,'to_location':location,'quantity':10,'status':'good','reason':'Stan początkowy','inventory':True}
  admin.call('workspace/move',stock)
  admin.call('workspace/move',{**stock,'from_location':location,'to_location':location2,'quantity':11,'inventory':False},400)
  assert admin.call('workspace')['equipment']['stock'][0]['quantity']==10
  assert parent.call('workspace')['equipment'] is None
  coach.call('workspace/issue',{'location_id':location2,'body':'Brak sprzętu'},403)
  # Wages use realized sessions, freeze on approval, and stay private.
  admin.call('business/rate',{'trainer_id':trainer,'starts_on':'2099-09-01','amount':6000,'unit_minutes':60})
  wages=coach.call('business/wages?trainer_id='+str(trainer)+'&month=2099-09')
  assert wages['amount']==6000 and len(wages['items'])==1
  parent.call('business',status=403)
  settlement=admin.call('business/settle',{'trainer_id':trainer,'month':'2099-09'})['id']
  admin.call('business/adjustment',{'trainer_id':trainer,'month':'2099-09','amount':100,'reason':'Test'},400)
  admin.call('business/paid',{'id':settlement,'date':'2099-09-01'})
  assert coach.call('business/wages?trainer_id='+str(trainer)+'&month=2099-09')['status']=='paid'
  report=admin.call('business/report?month=2099-09')
  assert report['revenue']==7000 and report['received']==8000 and report['refunds']==1000 and report['wages']==6000
  admin.call('business/snapshot',{'month':'2099-09','reason':'Kontrola'})
  # Bank import is atomic; a repeated transaction never creates extra money.
  bankrow={'athlete_id':child,'amount':100,'reference':'IMPORT1','date':'2099-09-01'}
  admin.call('import/bank',{'rows':[bankrow,{**bankrow,'athlete_id':999999,'reference':'BAD'}]},400)
  assert not any(p['reference']=='IMPORT1' for p in parent.call('state')['finance']['payments'])
  assert admin.call('import/bank',{'rows':[bankrow]})['created']==1
  assert admin.call('import/bank',{'rows':[bankrow]})['duplicates']==1
  # Another child's individually discounted quote is inaccessible.
  admin.call('finance/discount',{'athlete_id':child,'starts_on':'2099-09-01','ends_on':'2099-09-30','kind':'percent','value':1000,'reason':'Rabat'})
  other.call('quote',{'athlete_id':child,'group_id':group},404)
  # Versioned consent is explicit and optional consent can be withdrawn.
  doc=admin.call('workspace/savePolicy',{'kind':'photos','version':'1','title':'Zgoda testowa','body':'Tekst testowy organizatora','published':True})['id']
  parent.call('workspace/consent',{'athlete_id':child,'document_id':doc,'accepted':True})
  parent.call('workspace/consent',{'athlete_id':child,'document_id':doc,'accepted':False})
  assert len(parent.call('workspace')['acceptances'])==2
  other.call('workspace/consent',{'athlete_id':child,'document_id':doc,'accepted':True},404)
  # PDFs and spreadsheets are genuine downloadable documents.
  for path,signature in [('library/pdf?type=card&id='+str(child),b'%PDF-'),('export?kind=athletes&format=xlsx',b'PK')]:
   with admin.http.open(f'http://127.0.0.1:{PORT}/api/'+path) as response:assert response.read().startswith(signature)
  # Suspension corrects only remaining sessions and keeps the same child and charge on resume.
  old_count=len(parent.call('state')['enrollments'])
  admin.call('memberships/operate',{'action':'suspend','group_id':group,'athlete_ids':[child],'reason':'Przerwa'})
  assert parent.call('state')['memberships'][0]['status']=='suspended'
  assert admin.call('business/report?month=2099-09')['revenue']==3500
  admin.call('memberships/operate',{'action':'resume','group_id':group,'athlete_ids':[child],'reason':'Powrót'})
  assert len(parent.call('state')['enrollments'])==old_count
  assert admin.call('business/report?month=2099-09')['revenue']==7000
  # Imports validate the complete batch; repeated rows do not duplicate accounts/children.
  row={'name':'Importowany Zawodnik','birth_date':'2095-01-01','parent_email':'import@example.org','parent_name':'Rodzic Importowany','parent_phone':'123456789'}
  checked=admin.call('import/athletes/check',{'rows':[row,{**row,'birth_date':'bad'}]})
  assert checked['rows'][1]['error']
  admin.call('import/athletes',{'rows':[row,{**row,'birth_date':'bad'}]},400)
  assert not any(a['name']==row['name'] for a in admin.call('state')['athletes'])
  assert admin.call('import/athletes',{'rows':[row]})['created']==1
  assert admin.call('import/athletes',{'rows':[row]})['skipped']==1
  # Merging retains the enrollment and its payments/history; IDs are never reused.
  duplicate=parent.call('athletes',{'name':'Dziecko'},201)['id']
  original=admin.call('state')['athletes'][0]['id']
  parent.call('athletes/merge',{'source_id':duplicate,'target_id':child,'reason':'Duplikat','confirmed':True},403)
  admin.call('athletes/merge',{'source_id':child,'target_id':duplicate,'reason':'Duplikat','confirmed':True})
  merged=parent.call('state')
  assert len(merged['athletes'])==1 and merged['athletes'][0]['id']==duplicate
  assert all(e['athlete_id']==duplicate for e in merged['enrollments'])
  assert all(p['athlete_id']==duplicate for p in merged['membership_periods'])
  # Delete the highest child ID through a second merge and allocate above the historical ID.
  empty=parent.call('athletes',{'name':'Dziecko'},201)['id']
  admin.call('athletes/merge',{'source_id':empty,'target_id':duplicate,'reason':'Kolejny duplikat','confirmed':True})
  newer=parent.call('athletes',{'name':'Nowe dziecko'},201)['id']
  assert newer>empty
  # Transfer rolls back the source when the destination is full, then moves without a new child.
  p.terminate();p.wait();env['EA_TEST_NOW']='2099-09-01T13:00:02Z';p=start()
  full=admin.call('groups',{'name':'Pełna','location_id':location,'capacity':1,'price':3500,'trial_price':0,'trials':False,'dates':['2099-09-08T14:00']},201)['id']
  parent.call('enrollments',{'group_id':full,'athlete_id':newer},201)
  transfer={'action':'transfer','group_id':group,'target_group_id':full,'athlete_ids':[duplicate],'reason':'Zmiana grupy'}
  admin.call('memberships/operate',transfer,400)
  assert next(m for m in parent.call('state')['memberships'] if m['athlete_id']==duplicate and m['group_id']==group)['status']=='active'
  destination=admin.call('groups',{'name':'Docelowa','location_id':location,'capacity':2,'price':3500,'trial_price':0,'trials':False,'dates':['2099-09-08T15:00']},201)['id']
  admin.call('memberships/operate',{**transfer,'target_group_id':destination})
  moved=parent.call('state')
  assert len(moved['athletes'])==2
  assert next(m for m in moved['memberships'] if m['athlete_id']==duplicate and m['group_id']==group)['status']=='ended'
  assert next(m for m in moved['memberships'] if m['athlete_id']==duplicate and m['group_id']==destination)['status']=='active'
  assert next(e for e in moved['enrollments'] if e['athlete_id']==duplicate and e['group_id']==destination)['amount']==3150
  # Group age and required questions are checked by the API, not only the browser.
  ruled=admin.call('groups',{'name':'Od 3 do 5 lat','location_id':location,'capacity':10,'price':3500,'trial_price':0,'trials':True,'dates':['2099-09-15T13:00'],'min_age':3,'max_age':5,'activity_type':'Gimnastyka','parent_description':'Opis dla rodzica','questions':[{'label':'Grupa przedszkolna','required':True}]},201)['id']
  parent.call('enrollments',{'group_id':ruled,'athlete_id':newer,'answers':{'Grupa przedszkolna':'Liski'}},400)
  young=parent.call('athletes',{'name':'Za młody','birth_date':'2096-09-02'},201)['id']
  parent.call('enrollments',{'group_id':ruled,'athlete_id':young,'answers':{'Grupa przedszkolna':'Liski'}},400)
  assert 'Wiek dziecka' in parent.call('waiting/join',{'group_id':ruled,'athlete_id':young},400)['error']
  birthday=parent.call('athletes',{'name':'Trzecie urodziny','birth_date':'2096-09-01'},201)['id']
  optional_charge=parent.call('enrollments',{'group_id':ruled,'athlete_id':birthday},201)['id']
  parent.call('finance/dueDate',{'enrollment_id':optional_charge,'due_on':'2099-09-05','reason':'Test'},403)
  admin.call('finance/dueDate',{'enrollment_id':optional_charge,'due_on':'2099-09-05','reason':'Uzgodniony termin'})
  admin.call('finance/configure',{'auto_monthly':False,'due_day':20,'bank_account':''})
  assert next(e for e in parent.call('state')['enrollments'] if e['id']==optional_charge)['due_on']=='2099-09-05'
  assert not other.call('state')['finance']['deadlines']
  assert any(r['athlete_id']==birthday and json.loads(r['values_json'])['Grupa przedszkolna']=='' for r in parent.call('state')['registration_answers'])
  assert not other.call('state')['registration_answers']
  monthly=admin.call('groups',{'name':'Miesięczna','location_id':location,'capacity':10,'price':2000,'trial_price':0,'trials':False,'dates':['2099-09-15T13:00','2099-10-08T13:00']},201)['id']
  parent.call('enrollments',{'group_id':monthly,'athlete_id':duplicate},201)
  admin.call('finance/price',{'group_id':monthly,'starts_on':'2099-10-01','amount':5000,'vat_bps':None})
  admin.call('finance/configure',{'auto_monthly':True,'due_day':10,'bank_account':''})
  p.terminate();p.wait();env['EA_TEST_NOW']='2099-10-01T08:00:00Z';p=start()
  parent.call('auth/login',{'email':'parent@example.org','password':'parent-test-password'})
  october=parent.call('state')['enrollments']
  assert len([e for e in october if e['group_id']==monthly and e['month']=='2099-10'])==1
  assert next(e for e in october if e['group_id']==monthly and e['month']=='2099-10')['amount']==5000
  assert len(parent.call('state')['enrollments'])==len(october)
  late=next(e for e in october if e['id']==optional_charge)
  assert late['overdue_days']==26 and late['overdue_amount']==3500
  new_charge=next(e for e in october if e['group_id']==monthly and e['month']=='2099-10')
  assert new_charge['due_on']=='2099-10-10' and new_charge['payment_status']=='pending'
  print('PASS: kalendarz i obecności, wpłaty/zwroty, rozmowy i prywatność, zgody, postępy/PDF, sprzęt, wynagrodzenia/raporty, importy, zawieszenie/wznowienie, scalanie z historią i niepowtarzalne ID')
 finally:p.terminate();p.wait()

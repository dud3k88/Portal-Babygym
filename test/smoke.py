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
 p=start()
 try:
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
 finally:p.terminate();p.wait()
 p=start()
 try:assert request('/api/state')['enrollments'][0]['balance']==5000
 finally:p.terminate();p.wait()
 print('PASS: strona, grupa, wycena, zapis, korekta, limit miejsc, trwałość po restarcie')

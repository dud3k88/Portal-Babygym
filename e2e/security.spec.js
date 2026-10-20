import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,readdir,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollMfa } from './mfa-helper.js';
let server,folder;
const origin='http://127.0.0.1:3154';
test.beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'ea-security-e2e-'));
  server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3154',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),SECURITY_OUTBOX_DIR:join(folder,'outbox'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error('Serwer testowy nie wystartował.');
    try{await fetch(origin+'/api/auth/status');return;}catch{await new Promise(resolve=>setTimeout(resolve,50));}
  }
  throw Error('Brak serwera testowego.');
});
test.afterAll(async()=>{
  if(server?.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;}
  if(folder)await rm(folder,{recursive:true,force:true});
});
async function delivery(kind,email) {
  const files=await readdir(join(folder,'outbox'));
  for(const file of files) {
    const message=JSON.parse(await readFile(join(folder,'outbox',file),'utf8'));
    if(message.kind===kind&&message.to===email)return origin+message.path;
  }
  throw Error('Brak wiadomości testowej.');
}
test('MFA i kody zapasowe, zaproszenie nowego opiekuna, reset hasła i cofnięcie dostępu',async({page,browser},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function api(context,path,data){
    const response=await context.request.post(origin+'/api/'+path,{data});
    expect(response.ok(),await response.text()).toBeTruthy();return response.json();
  }
  await page.goto(origin);
  await page.locator('#auth-form [name=name]').fill('Administrator');
  await page.locator('#auth-form [name=email]').fill('admin@example.org');
  await page.locator('#auth-form [name=password]').fill('admin-test-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#mfa-secret')).toBeVisible();
  expect((await page.request.get(origin+'/api/state')).status()).toBe(401);
  const {codes}=await enrollMfa(page);
  await page.locator('#logout').click();
  await page.locator('#auth-form [name=email]').fill('admin@example.org');
  await page.locator('#auth-form [name=password]').fill('admin-test-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#mfa-form')).toBeVisible();
  await expect(page.locator('#mfa-enrollment')).toBeHidden();
  // An email reset link remains usable even with a pending MFA cookie.
  await api(page.context(),'auth/forgot',{email:'admin@example.org'});
  const pendingReset=await page.context().newPage();
  try {
    await pendingReset.goto(await delivery('reset','admin@example.org'));
    await expect(pendingReset.locator('#auth-title')).toHaveText('Nowe hasło');
    await expect(pendingReset.locator('#auth-form [name=password]')).toBeVisible();
  }finally{await pendingReset.close();}
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:testInfo.outputPath('mfa-mobile.png'),fullPage:true});
  await page.locator('#mfa-form [name=code]').fill(codes[0]);await page.locator('#mfa-form button').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  const a=await browser.newContext(),b=await browser.newContext(),pa=await a.newPage(),pb=await b.newPage();
  pa.on('pageerror',error=>errors.push(error.message));pb.on('pageerror',error=>errors.push(error.message));
  try {
    await api(a,'auth/register',{name:'Anna Rodzic',email:'anna@example.org',phone:'123456789',password:'parent-test-password'});
    const child=(await api(a,'athletes',{name:'Jan Wspólny'})).id;
    await api(a,'athletes',{name:'Dziecko prywatne'});
    await pa.goto(origin+'/#children');
    await pa.locator(`#my-children [data-athlete="${child}"]`).click();await pa.locator('[data-athlete-tab=parent]').click();
    await pa.locator('[data-invite-guardian]').click();
    await pa.locator('#guardian-form [name=email]').fill('piotr@example.org');await pa.locator('#guardian-form [type=submit]').click();
    await expect(pa.locator('#athlete-panel-parent')).toContainText('Oczekuje na przyjęcie');
    const invitation=await delivery('guardian','piotr@example.org');
    await pb.goto(invitation);
    await expect(pb.locator('#auth-description')).toContainText('zaproszenie opiekuna');
    await pb.locator('#auth-toggle').click();
    await pb.locator('#auth-form [name=name]').fill('Piotr Opiekun');
    await pb.locator('#auth-form [name=email]').fill('piotr@example.org');
    await pb.locator('#auth-form [name=password]').fill('parent-test-password');
    await pb.locator('#auth-submit').click();
    await expect(pb.locator('#guardian-accept-description')).toContainText('Jan Wspólny');
    await pb.locator('#guardian-accept').click();
    await expect(pb.locator('#my-children')).toContainText('Jan Wspólny');
    await expect(pb.locator('#my-children')).not.toContainText('Dziecko prywatne');
    await pb.locator('#my-children [data-athlete]').click();await pb.locator('[data-athlete-tab=parent]').click();
    await expect(pb.locator('#athlete-panel-parent')).toContainText('Anna Rodzic');
    await expect(pb.locator('#athlete-panel-parent')).toContainText('Piotr Opiekun');
    await pb.setViewportSize({width:390,height:844});
    expect(await pb.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await pb.screenshot({path:testInfo.outputPath('opiekunowie-mobile.png'),fullPage:true});
    await pb.locator('#athlete-detail-dialog [data-close]').click();
    await pb.locator('#logout').click();
    await pb.locator('#auth-forgot').click();await pb.locator('#auth-form [name=email]').fill('piotr@example.org');
    await pb.locator('#auth-submit').click();
    await expect(pb.locator('#auth-message')).toContainText('skrzynki testowej');
    await pb.goto(await delivery('reset','piotr@example.org'));
    await pb.locator('#auth-form [name=password]').fill('new-parent-password');
    await pb.locator('#auth-submit').click();
    await expect(pb.locator('#auth-message')).toContainText('Hasło zmienione');
    await pb.locator('#auth-form [name=email]').fill('piotr@example.org');
    await pb.locator('#auth-form [name=password]').fill('new-parent-password');
    await pb.locator('#auth-submit').click();
    await expect(pb.locator('#my-children')).toContainText('Jan Wspólny');
    await pa.reload();await pa.locator(`#my-children [data-athlete="${child}"]`).click();await pa.locator('[data-athlete-tab=parent]').click();
    pa.once('dialog',dialog=>dialog.accept());await pa.locator('[data-revoke-guardian]').click();
    await expect(pa.locator('#athlete-panel-parent')).not.toContainText('Piotr Opiekun');
    await pb.reload();await expect(pb.locator('#my-children')).not.toContainText('Jan Wspólny');
    expect(errors).toEqual([]);
  }finally{await a.close();await b.close();}
});

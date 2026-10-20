import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, folder;
const origin='http://127.0.0.1:3142';
test.beforeAll(async()=>{
 folder=await mkdtemp(join(tmpdir(),'ea-e2e-'));
 server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{
  env:{...process.env,HOST:'127.0.0.1',PORT:'3142',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
 for(let i=0;i<100;i++) {
  if(server.exitCode!==null)throw Error('Nie udało się uruchomić serwera testowego.');
  try{await fetch(origin+'/api/auth/status');return;}catch{await new Promise(resolve=>setTimeout(resolve,50));}
 }
 throw Error('Serwer nie wystartował.');
});
test.afterAll(async()=>{
 if(server?.exitCode===null) { const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped; }
 if(folder)await rm(folder,{recursive:true,force:true});
});

test('placówka, publiczny zapis, blokada rodzica, dziennik i mobilny panel',async({page,browser})=>{
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
 await page.locator('nav [data-view=locations]').click();
 await page.locator('#locations [data-new-location]').first().click();
 const form=page.locator('#save-location');
 await form.locator('[name=name]').fill('Przedszkole testowe');
 await form.locator('[name=address]').fill('Testowa 12');
 await form.locator('[name=city]').fill('Poznań');
 await form.locator('[name=notes]').fill('Tylko administrator');
 await form.locator('button[type=submit]').click();
 await expect(page.locator('#location-list')).toContainText('Testowa 12, Poznań');
 const state=await (await page.request.get(origin+'/api/state')).json();
 const location=state.locations[0].id;
 await api(page.context(),'groups',{location_id:location,name:'Liski',capacity:10,price:3500,trial_price:0,trials:true,dates:['2099-09-10T13:00']});
 // Parent enters via the real public wizard, no fabricated account or payment.
 const parentContext=await browser.newContext();const parentPage=await parentContext.newPage();
 try {
  parentPage.on('pageerror',error=>errors.push(error.message));
  await parentPage.goto(origin+'/zapisy');
  await parentPage.selectOption('#public-location',String(location));
  await parentPage.locator('[name=group_id]').check();
  await parentPage.locator('#to-child').click();
  await parentPage.locator('[name=child_first_name]').fill('Jan');await parentPage.locator('[name=child_last_name]').fill('Testowy');
  await parentPage.locator('#to-parent').click();
  for(const [name,value] of Object.entries({parent_first_name:'Anna',parent_last_name:'Testowa',email:'parent@example.org',phone:'123456789',password:'parent-test-password',password_confirmation:'parent-test-password'}))await parentPage.locator(`[name=${name}]`).fill(value);
  await parentPage.locator('#public-submit').click();await expect(parentPage).toHaveURL(/#children/);
  await expect(parentPage.locator('#my-children')).toContainText('Jan Testowy');
  await page.reload();await page.locator('nav [data-view=athletes]').click();
  await page.locator('#athlete-list [data-athlete]').click();await page.locator('[data-athlete-tab=parent]').click();
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-parent-access]').click();
  await expect(page.locator('#athlete-panel-parent')).toContainText('Zablokowane');
  expect((await parentPage.request.get(origin+'/api/state')).status()).toBe(401);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-parent-access]').click();
  await expect(page.locator('#athlete-panel-parent')).toContainText('Aktywne');
  await page.locator('#athlete-detail-dialog [data-close]').click();
  await page.locator('nav [data-view=locations]').click();await page.locator('[data-edit-location]').click();
  await form.locator('[name=status]').selectOption('archived');await form.locator('button[type=submit]').click();
  await expect(page.locator('#location-list')).toContainText('Archiwalna');
  await parentPage.goto(origin+'/zapisy');await expect(parentPage.locator('#public-location option')).toHaveCount(1);
  await page.locator('nav [data-view=audit]').click();await expect(page.locator('#audit-list')).toContainText('Administrator');
  await expect(page.locator('#audit-list')).toContainText('Placówka');
  await page.locator('#audit-list details').first().locator('summary').click();
  await expect(page.locator('#audit-list details[open]')).toContainText('Status');
  await page.setViewportSize({width:390,height:844});
  for(const view of ['audit','locations','athletes']) {
   await page.goto(origin+'/#'+view);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  expect(errors).toEqual([]);
 }finally{await parentContext.close();}
});

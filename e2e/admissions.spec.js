import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollMfa } from './mfa-helper.js';
let server,folder;
const origin='http://127.0.0.1:3184';
test.beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'ea-admissions-e2e-'));
  server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3184',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
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
test('lista rezerwowa publiczna, oferta w panelu, przyjęcie i ustawienia',async({page,browser},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function api(context,path,data){const response=await context.request.post(origin+'/api/'+path,{data});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
 await page.goto(origin);await page.locator('#auth-form [name=name]').fill('Administrator');await page.locator('#auth-form [name=email]').fill('admin@example.org');await page.locator('#auth-form [name=password]').fill('admin-test-password');await page.locator('#auth-submit').click();await enrollMfa(page);
 const location=(await api(page.context(),'locations',{name:'Przedszkole Testowe'})).id;
 const body={name:'Liski',location_id:location,capacity:1,price:3500,trial_price:0,trials:true,dates:['2099-09-08T13:00','2099-09-15T13:00']};
 const group=(await api(page.context(),'groups',body)).id;
 const p=(await api(page.context(),'parents',{name:'Rodzic pierwszy',email:'first@example.org'})).id;
 const child=(await api(page.context(),'athletes',{name:'Pierwsze dziecko',parent_id:p})).id;
 await api(page.context(),'enrollments',{group_id:group,athlete_id:child});
 const context=await browser.newContext();const parentPage=await context.newPage();parentPage.on('pageerror',error=>errors.push(error.message));
 try {
  await parentPage.goto(origin+'/zapisy');await parentPage.selectOption('#public-location',String(location));
  await expect(parentPage.locator('#public-group-list')).toContainText('Lista rezerwowa');
  await parentPage.locator('[name=group_id]').check();await expect(parentPage.locator('#public-quote')).toContainText('bez opłaty');await parentPage.locator('#to-child').click();
  await parentPage.locator('[name=child_first_name]').fill('Jan');await parentPage.locator('[name=child_last_name]').fill('Testowy');await parentPage.locator('#to-parent').click();
  await parentPage.locator('[name=parent_first_name]').fill('Anna');await parentPage.locator('[name=parent_last_name]').fill('Testowa');await parentPage.locator('[name=email]').fill('parent@example.org');await parentPage.locator('[name=phone]').fill('123456789');await parentPage.locator('[name=password]').fill('parent-test-password');await parentPage.locator('[name=password_confirmation]').fill('parent-test-password');
  await expect(parentPage.locator('#public-submit')).toContainText('kolejki');await parentPage.locator('#public-submit').click();
  await expect(parentPage.locator('#my-children')).toContainText('pozycja 1');
  let state=await (await context.request.get(origin+'/api/state')).json();expect(state.enrollments).toHaveLength(0);
  await api(page.context(),'groups/update',{...body,id:group,capacity:2});
  await parentPage.reload();await expect(parentPage.locator('#my-children [data-accept-offer]')).toBeVisible();
  await parentPage.setViewportSize({width:390,height:844});expect(await parentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await parentPage.screenshot({path:testInfo.outputPath('oferta-mobile.png'),fullPage:true});
  await parentPage.locator('[data-accept-offer]').click();await expect(parentPage.locator('#admission-summary')).toContainText('70,00');await parentPage.locator('#admission-confirm button').click();
  await expect(parentPage.locator('#my-children')).toContainText('Zapis stały');expect((await (await context.request.get(origin+'/api/state')).json()).enrollments).toHaveLength(1);
  await page.reload();await page.locator('nav [data-view=waiting]').click();await page.selectOption('#waiting-filter','all');await expect(page.locator('#waiting-list')).toContainText('Zapis potwierdzony');
  await page.locator('#admission-settings [name=trial_hours]').fill('48');await page.locator('#admission-settings button').click();await expect(page.locator('#notice')).toContainText('zapisane');
  expect((await (await page.request.get(origin+'/api/state')).json()).admission_settings.trial_hours).toBe(48);
  const trialGroup=(await api(page.context(),'groups',{...body,name:'Próba gratis',dates:['2099-09-01T13:00','2099-09-08T13:00','2099-09-15T13:00']})).id;
  const trialState=await (await context.request.get(origin+'/api/state')).json();
  const trialSession=trialState.sessions.find(s=>s.group_id===trialGroup);
  await api(context,'enrollments',{group_id:trialGroup,athlete_id:trialState.athletes[0].id,trial_id:trialSession.id});
  await parentPage.reload();await expect(parentPage.locator('[data-trial-convert]')).toBeDisabled();
  const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
  server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3184',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T13:00:00Z'},stdio:'ignore'});
  for(let i=0;i<100;i++){try{await fetch(origin+'/api/auth/status');break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
  await parentPage.reload();await parentPage.locator('[data-trial-convert]').click();await expect(parentPage.locator('#admission-summary')).toContainText('70,00');
  await parentPage.screenshot({path:testInfo.outputPath('kontynuacja-mobile.png'),fullPage:true});
  await parentPage.locator('#admission-confirm button').click();await expect(parentPage.locator('[data-trial-convert]')).toHaveCount(0);
  const converted=await (await context.request.get(origin+'/api/state')).json();expect(converted.enrollments.filter(e=>e.group_id===trialGroup)).toHaveLength(2);
  expect(errors).toEqual([]);
 }finally{await context.close();}
});

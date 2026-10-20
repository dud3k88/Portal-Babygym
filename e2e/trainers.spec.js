import { enrollMfa } from './mfa-helper.js';
import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server,folder;
const origin='http://127.0.0.1:3146';
test.beforeAll(async()=>{
 folder=await mkdtemp(join(tmpdir(),'ea-trainer-e2e-'));
 server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3146',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
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
test('administrator aktywuje konto trenera; własne grupy, notatka i blokada; listy na telefonie',async({page,browser},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function api(path,data){const response=await page.request.post(origin+'/api/'+path,{data});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
 await page.goto(origin);
 await page.locator('#auth-form [name=name]').fill('Administrator');await page.locator('#auth-form [name=email]').fill('admin@example.org');await page.locator('#auth-form [name=password]').fill('admin-test-password');await page.locator('#auth-submit').click();
 await enrollMfa(page);
 await page.locator('nav [data-view=trainers]').click();await page.locator('#trainers [data-open=trainer-dialog]').first().click();
 await page.locator('#create-trainer [name=name]').fill('Anna Trener');await page.locator('#create-trainer [name=email]').fill('trainer@example.org');await page.locator('#create-trainer [type=submit]').click();
 await expect(page.locator('#trainer-list')).toContainText('Anna Trener');
 const data=await (await page.request.get(origin+'/api/state')).json(),trainerId=data.trainers[0].id;
 const location=(await api('locations',{name:'Przedszkole Ekologiczne'})).id;
 const group=(await api('groups',{location_id:location,name:'Liski',capacity:10,price:3500,trial_price:0,trials:true,dates:['2099-09-10T13:00'],trainer_ids:[trainerId]})).id;
 const parent=(await api('parents',{name:'Rodzic Testowy',email:'parent@example.org',phone:'123456789'})).id;
 const child=(await api('athletes',{name:'Jan Testowy',parent_id:parent,notes:'NIEWIDOCZNE DLA TRENERA'})).id;
 await api('enrollments',{group_id:group,athlete_id:child});
 await page.reload();await page.locator('[data-trainer-account]').click();
 await expect(page.locator('#invitation-dialog')).toBeVisible();
 const invitation=await page.locator('#invitation-link').inputValue();
 const coach=await browser.newContext(),coachPage=await coach.newPage();coachPage.on('pageerror',error=>errors.push(error.message));
 try {
  await coachPage.goto(invitation);await coachPage.locator('#auth-form [name=password]').fill('trainer-test-password');await coachPage.locator('#auth-submit').click();
  await expect(coachPage).toHaveURL(/#coach/);
  await expect(coachPage.locator('#coach-sessions')).toContainText('Liski');
  await expect(coachPage.locator('#coach-roster')).toContainText('123456789');
  expect(await coachPage.locator('nav button:visible').evaluateAll(buttons=>buttons.map(b=>b.dataset.view).sort())).toEqual(['business','calendar','coach','equipment','library','messages']);
  await expect(coachPage.locator('nav [data-view=billing]')).toBeHidden();
  await expect(coachPage.locator('nav [data-view=users]')).toBeHidden();
  await expect(coachPage.locator('body')).not.toContainText('NIEWIDOCZNE DLA TRENERA');
  await coachPage.selectOption('#coach-group',String(group));
  await coachPage.locator('[data-coach-note]').click();await coachPage.locator('#coach-note-form textarea').fill('Ćwiczenia równowagi');await coachPage.locator('#coach-note-form [type=submit]').click();
  await expect(coachPage.locator('#coach-roster')).toContainText('Ćwiczenia równowagi');
  await coachPage.screenshot({path:testInfo.outputPath('panel-trenera.png'),fullPage:true});
  await coachPage.setViewportSize({width:390,height:844});
  await coachPage.selectOption('#coach-group','');
  expect(await coachPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await coachPage.screenshot({path:testInfo.outputPath('panel-trenera-mobile.png'),fullPage:true});
  // Admin sees the separate note in the existing child record.
  await page.locator('#invitation-dialog [data-close]').click();await page.locator('nav [data-view=athletes]').click();
  await page.reload();await page.locator('[data-athlete]').first().click();await expect(page.locator('#athlete-panel-data')).toContainText('Ćwiczenia równowagi');await page.locator('#athlete-detail-dialog [data-close]').click();
  await page.locator('nav [data-view=trainers]').click();await page.locator('[data-edit-trainer]').click();
  await page.selectOption('#create-trainer [name=status]','inactive');await page.locator('#create-trainer [type=submit]').click();
  await expect(page.locator('#trainer-list')).toContainText('Nieaktywny');
  await coachPage.locator('#coach-refresh').click();await expect(coachPage.locator('#auth-form')).toBeVisible();
  // Public selection remains usable on a narrow screen.
  await coachPage.goto(origin+'/zapisy');await coachPage.selectOption('#public-location',String(location));await expect(coachPage.locator('#public-group-list')).toContainText('Liski');
  await coachPage.screenshot({path:testInfo.outputPath('zapisy-mobile.png'),fullPage:true});
  expect(await coachPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
 }finally{await coach.close();}
});

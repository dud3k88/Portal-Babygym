import { enrollMfa } from './mfa-helper.js';
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

test('placówka, publiczny zapis, blokada rodzica, dziennik i mobilny panel',async({page,browser},testInfo)=>{
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
 await enrollMfa(page);
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
 await api(page.context(),'groups',{location_id:location,name:'Liski',min_age:3,max_age:7,activity_type:'Gimnastyka',parent_description:'Ruch i zabawa',questions:[{label:'Grupa przedszkolna',required:true}],capacity:10,price:3500,trial_price:0,trials:true,dates:['2099-09-10T13:00']});
 // Parent enters via the real public wizard, no fabricated account or payment.
 const parentContext=await browser.newContext();const parentPage=await parentContext.newPage();
 try {
  parentPage.on('pageerror',error=>errors.push(error.message));
  await parentPage.goto(origin+'/zapisy');
  await parentPage.selectOption('#public-location',String(location));
  await expect(parentPage.locator('#public-group-list')).toContainText('Ruch i zabawa');
  await parentPage.locator('[name=group_id]').check();
  await parentPage.locator('#to-child').click();
  await parentPage.locator('[name=child_first_name]').fill('Jan');await parentPage.locator('[name=child_last_name]').fill('Testowy');
  await expect(parentPage.locator('[name=birth_date]')).toHaveAttribute('required','');
  await parentPage.locator('[name=birth_date]').fill('2095-01-01');
  await expect(parentPage.locator('[data-question="Grupa przedszkolna"]')).not.toHaveAttribute('required','');
  await parentPage.locator('#to-parent').click();
  for(const [name,value] of Object.entries({parent_first_name:'Anna',parent_last_name:'Testowa',email:'parent@example.org',phone:'123456789',password:'parent-test-password',password_confirmation:'parent-test-password'}))await parentPage.locator(`[name=${name}]`).fill(value);
  await parentPage.locator('#public-submit').click();await expect(parentPage).toHaveURL(/#children/);
  await expect(parentPage.locator('#my-children')).toContainText('Jan Testowy');
  await page.reload();await page.locator('nav [data-view=billing]').click();
  await page.locator('[data-deadline]').click();
  await page.locator('#operation-form [name=due_on]').fill('2099-09-20');
  await page.locator('#operation-form [name=reason]').fill('Indywidualne ustalenie terminu');
  await page.locator('#operation-form [type=submit]').click();
  await expect(page.locator('#enrollments')).toContainText('20.09.2099');
  await page.selectOption('#billing-filter-status','overdue');
  await expect(page.locator('#enrollments')).toContainText('Brak należności');
  await page.selectOption('#billing-filter-status','pending');
  await expect(page.locator('#enrollments')).toContainText('Jan Testowy');
  await page.locator('nav [data-view=athletes]').click();
  await expect(page.locator('.directory-table tbody tr')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('zawodnicy.png'),fullPage:true});
  await page.locator('#athlete-list [data-athlete]').click();await page.locator('[data-athlete-tab=parent]').click();
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-parent-access]').click();
  await expect(page.locator('#athlete-panel-parent')).toContainText('Zablokowane');
  expect((await parentPage.request.get(origin+'/api/state')).status()).toBe(401);
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-parent-access]').click();
  await expect(page.locator('#athlete-panel-parent')).toContainText('Aktywne');
  await page.locator('#athlete-detail-dialog [data-close]').click();
  await page.locator('nav [data-view=calendar]').click();
  await page.locator('#lesson-filters [name=from]').fill('2099-09-08');
  await page.selectOption('#lesson-filters [name=view]','week');
  await expect(page.locator('.lesson-event')).toHaveCount(1);
  await expect(page.locator('.lesson-day')).toHaveCount(7);
  await page.screenshot({path:testInfo.outputPath('kalendarz.png'),fullPage:true});
  await page.locator('.lesson-event').click();
  await expect(page.locator('#lesson-dialog')).toBeVisible();
  await page.locator('#lesson-dialog [data-close]').click();
  await page.locator('[data-calendar-move="1"]').click();
  await expect(page.locator('#calendar-range')).toContainText('15.09.2099');
  await expect(page.locator('.lesson-event')).toHaveCount(0);
  await page.locator('#calendar-today').click();
  await expect(page.locator('#calendar-range')).toContainText('01.09.2099');
  await page.locator('nav [data-view=locations]').click();await page.locator('[data-edit-location]').click();
  await form.locator('[name=status]').selectOption('archived');await form.locator('button[type=submit]').click();
  await expect(page.locator('#location-list')).toContainText('Archiwalna');
  await parentPage.goto(origin+'/zapisy');await expect(parentPage.locator('#public-location option')).toHaveCount(1);
  await page.locator('nav [data-view=audit]').click();await expect(page.locator('#audit-list')).toContainText('Administrator');
  await expect(page.locator('#audit-list')).toContainText('Placówka');
  await page.locator('#audit-list details').first().locator('summary').click();
  await expect(page.locator('#audit-list details[open]')).toContainText('Status');
  await page.setViewportSize({width:390,height:844});
  for(const view of ['audit','locations','athletes','finance','calendar','messages','policies','equipment','library','business']) {
   await page.goto(origin+'/#'+view);
   await expect(page.locator(view==='calendar'?'#calendar-page':'#'+view)).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view).toBeTruthy();
  }
  await page.locator('[data-business-action=category]').click();
  await page.locator('#operation-form [name=name]').fill('Usługi testowe');
  await page.locator('#operation-form [type=submit]').click();
  await page.locator('[data-business-action=cost]').click();
  await page.locator('#operation-form [name=amount]').fill('100');
  await page.locator('#operation-form [name=label]').fill('Koszt testowy');
  await page.locator('#operation-form [type=submit]').click();
  await expect(page.locator('#business-records')).toContainText('Koszt testowy');
  await expect(page.locator('#business-report')).toContainText('100,00');
  expect(errors).toEqual([]);
 }finally{await parentContext.close();}
});

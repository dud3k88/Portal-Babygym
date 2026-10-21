import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollMfa } from './mfa-helper.js';
let server,folder;
const origin='http://127.0.0.1:3164';
test.beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'ea-participation-e2e-'));
  server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3164',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
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
test('sezon, grupa, kopia, zamknięcie zapisów i rezygnacja rodzica z końcem miesiąca',async({page,browser},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function api(context,path,data){
    const response=await context.request.post(origin+'/api/'+path,{data});
    expect(response.ok(),await response.text()).toBeTruthy();return response.json();
  }
  await page.goto(origin);
  await page.locator('#auth-form [name=name]').fill('Administrator');await page.locator('#auth-form [name=email]').fill('admin@example.org');
  await page.locator('#auth-form [name=password]').fill('admin-test-password');await page.locator('#auth-submit').click();
  await enrollMfa(page);
  await page.locator('nav [data-view=seasons]').click();await page.locator('[data-new-season]').click();
  const seasonForm=page.locator('#season-form');
  await seasonForm.locator('[name=name]').fill('2099/2100');await seasonForm.locator('[name=start_date]').fill('2099-09-01');await seasonForm.locator('[name=end_date]').fill('2100-06-30');
  await seasonForm.locator('[type=submit]').click();await expect(page.locator('#season-list')).toContainText('2099/2100');
  const initial=await (await page.request.get(origin+'/api/state')).json(),seasonId=initial.seasons[0].id;
  const location=(await api(page.context(),'locations',{name:'Przedszkole Testowe'})).id;
  await page.reload();await page.locator('nav [data-view=groups]').click();await page.locator('#groups [data-open=group-dialog]').first().click();
  const groupForm=page.locator('#create-group');
  await expect(groupForm.locator('[name=price]')).toHaveValue('35');
  await expect(groupForm.locator('[name=season_id]')).toHaveValue(String(seasonId));
  await expect(page.locator('#group-trainer-picker')).not.toHaveAttribute('open','');
  await groupForm.locator('[name=location_id]').selectOption(String(location));await groupForm.locator('[name=name]').fill('Liski');
  await groupForm.locator('[name=season_id]').selectOption(String(seasonId));
  await groupForm.locator('[name=end_date]').fill('2099-10-31');
  await groupForm.locator('[name=price]').fill('35');await groupForm.locator('[type=submit]').click();
  await expect(page.locator('#group-dialog')).toBeHidden();
  await page.locator('[data-location-groups]').click();await expect(page.locator('#calendar')).toContainText('2099/2100');
  await page.locator('[data-enter-group]').click();await page.locator('[data-copy-group]').click();
  await expect(groupForm.locator('[name=id]')).toHaveValue('');
  await expect(groupForm.locator('[name=status]')).toHaveValue('planned');
  await expect(groupForm.locator('[name=registration_open]')).not.toBeChecked();
  await groupForm.locator('[name=name]').fill('Kopia Lisków');await groupForm.locator('[name=season_id]').selectOption(String(seasonId));
  await groupForm.locator('[name=end_date]').fill('2099-10-31');await groupForm.locator('[type=submit]').click();
  const data=await (await page.request.get(origin+'/api/state')).json(),group=data.groups.find(group=>group.name==='Liski');
  expect(data.groups.find(group=>group.name==='Kopia Lisków').member_count).toBe(0);
  await page.locator('[data-lifecycle]').click();const lifecycle=page.locator('#lifecycle-form');
  await lifecycle.locator('[name=registration_open]').uncheck();await lifecycle.locator('[type=submit]').click();
  expect((await (await page.request.get(origin+'/api/public/catalog')).json()).groups).toEqual([]);
  await page.locator('[data-lifecycle]').click();await lifecycle.locator('[name=registration_open]').check();await lifecycle.locator('[type=submit]').click();
  const parent=await browser.newContext(),parentPage=await parent.newPage();parentPage.on('pageerror',error=>errors.push(error.message));
  try {
    await api(parent,'auth/register',{name:'Anna Rodzic',email:'parent@example.org',password:'parent-test-password'});
    const child=(await api(parent,'athletes',{name:'Jan Dziecko'})).id;
    await api(parent,'enrollments',{athlete_id:child,group_id:group.id});
    const before=await (await parent.request.get(origin+'/api/state')).json();
    await parentPage.goto(origin+'/#children');
    await parentPage.locator('#my-children [data-withdraw-group]').click();
    await expect(parentPage.locator('#withdrawal-summary')).toContainText('2099-10-01');
    await parentPage.locator('#withdrawal-form [name=reason]').fill('Zmiana planu rodziny');
    await parentPage.locator('#withdrawal-form [type=submit]').click();
    await expect(parentPage.locator('#my-children')).toContainText('miejsce zwalnia się 2099-10-01');
    const after=await (await parent.request.get(origin+'/api/state')).json();
    expect(after.enrollments).toEqual(before.enrollments);expect(after.groups.find(item=>item.id===group.id).member_count).toBe(1);
    await parentPage.setViewportSize({width:390,height:844});
    await parentPage.locator('#my-children [data-athlete]').click();await parentPage.locator('[data-athlete-tab=groups]').click();
    await parentPage.locator('.participation-history summary').click();
    await expect(parentPage.locator('#athlete-panel-groups')).toContainText('Zmiana planu rodziny');
    expect(await parentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await parentPage.screenshot({path:testInfo.outputPath('uczestnictwo-mobile.png'),fullPage:true});
    parentPage.once('dialog',dialog=>dialog.accept());await parentPage.locator('#athlete-panel-groups [data-cancel-withdrawal]').click();
    await expect(parentPage.locator('#athlete-panel-groups [data-withdraw-group]')).toBeVisible();
    expect((await (await parent.request.get(origin+'/api/state')).json()).memberships[0].ends_at).toBeNull();
    await page.reload();
    await page.locator('nav [data-view=athletes]').click();
    await page.selectOption('#athlete-filter-season',String(seasonId));
    await expect(page.locator('#athlete-list')).toContainText('Jan Dziecko');
    await page.selectOption('#athlete-filter-season','unassigned');
    await expect(page.locator('#athlete-list [data-athlete]')).toHaveCount(0);
    await page.locator('nav [data-view=billing]').click();
    await page.selectOption('#billing-filter-season',String(seasonId));
    await expect(page.locator('#enrollments')).toContainText('Jan Dziecko');
    await page.selectOption('#billing-filter-season','unassigned');
    await expect(page.locator('#enrollments [data-adjust]')).toHaveCount(0);
    await page.locator('nav [data-view=groups]').click();
    await page.locator('[data-location-groups]').click();await page.selectOption('#group-filter-status','planned');
    await expect(page.locator('[data-enter-group]')).toHaveCount(1);await expect(page.locator('#calendar')).toContainText('Kopia Lisków');
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath('sezony-grupy-mobile.png'),fullPage:true});
    expect(errors).toEqual([]);
  }finally{await parent.close();}
});

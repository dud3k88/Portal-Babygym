import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrollMfa } from './mfa-helper.js';
let server,folder;
const origin='http://127.0.0.1:3174';
test.beforeAll(async()=>{
  folder=await mkdtemp(join(tmpdir(),'ea-users-e2e-'));
  server=spawn(process.execPath,['--import','./scripts/fixed-clock.mjs','server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'3174',DB_PATH:join(folder,'db.sqlite'),LOGO_PATH:join(folder,'logo'),EA_TEST_NOW:'2099-09-01T10:00:00Z'},stdio:'ignore'});
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
test('administrator dodaje konto, aktywacja wymaga MFA, filtry i blokada na telefonie',async({page,browser},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);
 await page.locator('#auth-form [name=name]').fill('Administrator');await page.locator('#auth-form [name=email]').fill('admin@example.org');
 await page.locator('#auth-form [name=password]').fill('admin-test-password');await page.locator('#auth-submit').click();await enrollMfa(page);
 await page.locator('nav [data-view=users]').click();await expect(page.locator('#user-list')).toContainText('Twoje konto');
 await page.locator('[data-new-user]').click();const form=page.locator('#user-form');
 await form.locator('[name=name]').fill('Drugi Administrator');await form.locator('[name=email]').fill('second@example.org');await form.locator('[name=role]').selectOption('admin');
 await expect(page.locator('#user-role-help')).toContainText('wszystkich danych');
 await form.locator('[type=submit]').click();await expect(page.locator('#invitation-dialog')).toBeVisible();
 const link=await page.locator('#invitation-link').inputValue();await page.locator('#invitation-dialog [data-close]').click();
 const second=await browser.newContext();const secondPage=await second.newPage();secondPage.on('pageerror',error=>errors.push(error.message));
 try {
  await secondPage.goto(link);await secondPage.locator('#auth-form [name=password]').fill('second-test-password');await secondPage.locator('#auth-submit').click();
  await expect(secondPage.locator('#mfa-form')).toBeVisible();await enrollMfa(secondPage);
  await secondPage.locator('nav [data-view=users]').click();await expect(secondPage.locator('#user-list')).toContainText('Drugi Administrator');
  await page.locator('#user-filters [name=search]').fill('second@example.org');await page.locator('#user-filters [type=submit]').click();
  await expect(page.locator('#user-list .entry')).toHaveCount(1);await expect(page.locator('#user-list')).toContainText('MFA: włączone');
  await page.locator('[data-edit-user]').click();await expect(form.locator('[name=role]')).toBeDisabled();await form.locator('[name=phone]').fill('123456789');await form.locator('[type=submit]').click();
  await expect(page.locator('#user-list')).toContainText('123456789');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-access-user]').click();await expect(page.locator('#user-list')).toContainText('Dostęp zablokowany');
  expect((await second.request.get(origin+'/api/users')).status()).toBe(401);
  await page.selectOption('#user-filters [name=status]','blocked');await expect(page.locator('#user-list .entry')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:testInfo.outputPath('uzytkownicy-mobile.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-access-user]').click();await expect(page.locator('#user-list .entry')).toHaveCount(0);
  await page.locator('#user-filters [type=reset]').click();await expect(page.locator('#user-list .entry')).toHaveCount(2);
  expect(errors).toEqual([]);
 } finally {await second.close();}
});

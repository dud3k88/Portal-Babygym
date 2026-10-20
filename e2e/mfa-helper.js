import { expect } from '@playwright/test';
import { totp } from '../security.js';
export async function enrollMfa(page) {
 await expect(page.locator('#mfa-secret')).toHaveValue(/^[A-Z2-7]{32}$/);
 const secret=await page.locator('#mfa-secret').inputValue();
 await page.locator('#mfa-form [name=code]').fill(totp(secret,Math.floor(Date.parse('2099-09-01T10:00:00Z')/30000)));
 await page.locator('#mfa-form button').click();
 await expect(page.locator('#mfa-codes')).toContainText(/^[a-f0-9]{16}/);
 const codes=(await page.locator('#mfa-codes').textContent()).trim().split('\n');
 await page.locator('#mfa-continue').click();
 return {secret,codes};
}

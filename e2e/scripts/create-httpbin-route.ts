/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { chromium, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/ui';

async function fillEditor(page: any, dialog: any, value: string) {
  await dialog.getByTestId('editor-loading')
    .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  const editor = dialog.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);

  // Click editor to focus, select all, delete, then type new value
  await editor.click();
  const textbox = editor.getByRole('textbox');

  // Select all content and delete it
  await textbox.press('Control+a');
  await textbox.press('Backspace');
  await page.waitForTimeout(200);

  // Type the new JSON value
  await textbox.pressSequentially(value, { delay: 10 });
  await page.waitForTimeout(500);

  // Click outside to trigger blur/onChange
  await dialog.locator('h2, [class*="title"]').first().click();
  await page.waitForTimeout(800);
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto(BASE_URL);
  console.log('Opened dashboard');

  // Login
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  console.log('Logged in');

  await page.getByRole('link', { name: 'Routes', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(3000);
  console.log('On Add Route page');

  // Step 1
  await page.locator('input[name="name"]').fill('httpbin-keyauth-v2');
  await page.locator('textarea[name="desc"]').fill('Route to httpbin.org with key-auth and proxy-rewrite');
  await page.locator('input[name="uri"]').fill('/httpbin/*');
  const methodsInput = page.getByText('HTTP Methods').locator('..').locator('input').first();
  await methodsInput.click();
  await page.getByRole('option', { name: 'GET' }).click();
  await page.getByRole('option', { name: 'POST' }).click();
  await page.keyboard.press('Escape');
  console.log('Step 1 filled');

  // Step 2
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(2000);
  await page.locator('.mantine-Select-input:visible').nth(2).click();
  await page.waitForTimeout(1000);
  await page.getByRole('option', { name: /httpbin/ }).first().click();
  await page.waitForTimeout(1000);
  console.log('Step 2 done');

  // Step 3
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(2000);
  console.log('Step 3: Plugins');

  const selectPluginsBtn = page.getByRole('button', { name: 'Select Plugins' });
  const selectPluginsDialog = page.getByRole('dialog', { name: 'Select Plugins' });
  const addPluginDialog = page.getByRole('dialog', { name: 'Add Plugin' });
  const searchInput = selectPluginsDialog.getByPlaceholder('Search');

  // key-auth
  await selectPluginsBtn.click();
  await searchInput.fill('key-auth');
  await page.waitForTimeout(1000);
  await selectPluginsDialog.getByTestId('plugin-key-auth').getByRole('button', { name: 'Add' }).click();
  await fillEditor(page, addPluginDialog, '{"header":"apikey"}');
  await page.screenshot({ path: '/tmp/keyauth-before-add.png' });
  await addPluginDialog.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(2000);

  const keyauthHidden = await addPluginDialog.isHidden().catch(() => false);
  if (!keyauthHidden) {
    // Check editor content and error
    const lines = await addPluginDialog.locator('.view-line').allTextContents();
    console.log('key-auth editor:', lines.join(''));
    const err = await addPluginDialog.locator('text=/invalid|error|format/i').first().textContent().catch(() => 'none');
    console.log('key-auth error:', err);
    await page.screenshot({ path: '/tmp/keyauth-error.png' });
    throw new Error('key-auth plugin add failed');
  }
  console.log('Added key-auth');

  // proxy-rewrite
  await selectPluginsBtn.click();
  await searchInput.fill('proxy-rewrite');
  await page.waitForTimeout(1000);
  await selectPluginsDialog.getByTestId('plugin-proxy-rewrite').getByRole('button', { name: 'Add' }).click();
  await fillEditor(page, addPluginDialog, '{"regex_uri":["^/httpbin/(.*)","/$1"]}');
  await page.screenshot({ path: '/tmp/proxy-rewrite-before-add.png' });
  await addPluginDialog.getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(2000);

  const proxyHidden = await addPluginDialog.isHidden().catch(() => false);
  if (!proxyHidden) {
    const lines = await addPluginDialog.locator('.view-line').allTextContents();
    console.log('proxy-rewrite editor:', lines.join(''));
    const err = await addPluginDialog.locator('text=/invalid|error|format|fewer/i').first().textContent().catch(() => 'none');
    console.log('proxy-rewrite error:', err);
    await page.screenshot({ path: '/tmp/proxy-rewrite-error.png' });
    throw new Error('proxy-rewrite plugin add failed');
  }
  console.log('Added proxy-rewrite');

  // Verify & submit
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/route-created.png' });
  console.log('Route created!');

  await page.waitForTimeout(10000);
  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

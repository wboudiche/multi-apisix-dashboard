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
/* eslint-disable playwright/no-wait-for-timeout */
import { env } from '@e2e/utils/env';
import { expect, test } from '@playwright/test';

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');

test.setTimeout(90000);

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  const url = page.url();
  if (url.includes('/login')) {
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  }
}

async function navigateToRequestOverrideStep(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/routes/add`);
  await page.waitForTimeout(1000);

  // Step 1: Fill required fields
  await page.locator('input[name="name"]').fill('test-override');
  await page.locator('input[name="uri"]').fill('/test-override');

  // Step 1 -> 2
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);

  // Step 2: Add upstream node to pass validation
  const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });
  await addNodeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addNodeBtn.click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
  await page.locator('input[placeholder="Port"]').fill('80');

  // Step 2 -> 3 (Request Override)
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(1000);
}

test.describe('Route Add - Request Override Step', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Request Override step is visible in stepper', async ({ page }) => {
    await page.goto(`${BASE_URL}/routes/add`);
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Request Override')).toBeVisible();
  });

  test('Request Override shows all form fields', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    await expect(page.getByText('Scheme', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('URI Override', { exact: true })).toBeVisible();
    await expect(page.getByText('Host Override', { exact: true })).toBeVisible();
    await expect(page.getByText('Method Override', { exact: true })).toBeVisible();
    await expect(page.getByText('Header Override', { exact: true })).toBeVisible();
    await expect(page.getByText('Keep Original').first()).toBeVisible();
  });

  test('Changing scheme to HTTPS adds proxy-rewrite plugin', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    // Click HTTPS label (Mantine Radio renders as label, not role=radio)
    await page.locator('label:has-text("HTTPS")').click();
    await page.waitForTimeout(500);

    // Step 3 -> 4 (Plugins)
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('proxy-rewrite')).toBeVisible({ timeout: 10000 });
  });

  test('Static URI override generates proxy-rewrite', async ({ page }) => {
    await navigateToRequestOverrideStep(page);

    // Click "Static" label for URI Override (first Static label)
    await page.locator('label:has-text("Static")').first().click();
    await page.waitForTimeout(500);

    // Fill static URI
    await page.locator('input[placeholder="/new/path"]').fill('/api/v2');
    await page.waitForTimeout(500);

    // Step 3 -> 4 (Plugins)
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('proxy-rewrite')).toBeVisible({ timeout: 10000 });
  });
});

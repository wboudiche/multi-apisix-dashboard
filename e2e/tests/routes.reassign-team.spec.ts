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
import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/ui';

test.setTimeout(60000);

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

async function selectLocalInstance(page: import('@playwright/test').Page) {
  const instanceInput = page.locator('input[placeholder="Select instance"]');
  await instanceInput.click();
  await page.waitForTimeout(500);
  await page.locator('[role="option"]:has-text("Local")').click();
  await page.waitForTimeout(1000);
}

async function navigateToFirstRouteDetail(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/routes`);
  await page.waitForTimeout(2000);

  const detailLink = page.locator('a[href*="/routes/detail/"]').first();
  if (!(await detailLink.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }

  await detailLink.click();
  await page.waitForTimeout(2000);
  return true;
}

test.describe('Route Detail - Reassign Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await selectLocalInstance(page);
  });

  test('Reassign Team button visible on route detail page', async ({ page }) => {
    const hasRoutes = await navigateToFirstRouteDetail(page);
    if (!hasRoutes) {
      test.skip();
      return;
    }

    const reassignBtn = page.getByRole('button', { name: /Reassign Team/i });
    await expect(reassignBtn).toBeVisible({ timeout: 10000 });
  });

  test('Reassign Team modal opens with team selector', async ({ page }) => {
    const hasRoutes = await navigateToFirstRouteDetail(page);
    if (!hasRoutes) {
      test.skip();
      return;
    }

    // Click the Reassign Team button
    const reassignBtn = page.getByRole('button', { name: /Reassign Team/i });
    await expect(reassignBtn).toBeVisible({ timeout: 10000 });
    await reassignBtn.click();
    await page.waitForTimeout(1000);

    // Verify modal content
    await expect(page.getByText('Reassign Team', { exact: true })).toBeVisible();
    await expect(page.getByText('Select team')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reassign' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    // Close modal via Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(500);

    // Verify modal is closed - the Reassign button inside the modal should no longer be visible
    await expect(page.getByRole('button', { name: 'Reassign' })).toBeHidden({ timeout: 5000 });
  });
});

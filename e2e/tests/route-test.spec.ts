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

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);
  if (page.url().includes('login')) {
    await page.locator('input').first().fill('admin');
    await page.locator('input[type="password"]').fill('admin');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }
}

async function navigateToFirstRouteDetail(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/routes`);
  await page.waitForTimeout(3000);

  // Click the first "Configure" button in the table to go to route detail
  const configureBtn = page.getByRole('button', { name: /configure/i }).first();
  if (!(await configureBtn.isVisible().catch(() => false))) {
    return false;
  }
  await configureBtn.click();
  await page.waitForTimeout(2000);
  return true;
}

test.describe('Route Test Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can open route test drawer from route detail page', async ({ page }) => {
    const hasRoute = await navigateToFirstRouteDetail(page);
    if (!hasRoute) {
      test.skip(true, 'No routes available');
      return;
    }

    // Click the Test Route button
    const testButton = page.getByRole('button', { name: /test route/i });
    await expect(testButton).toBeVisible();
    await testButton.click();
    await page.waitForTimeout(500);

    // Verify the drawer opened
    const drawer = page.locator('.mantine-Drawer-content');
    await expect(drawer).toBeVisible();

    // Verify drawer title
    await expect(drawer.getByText('Test Route')).toBeVisible();

    // Verify Send button exists
    await expect(drawer.getByRole('button', { name: /send/i })).toBeVisible();

    // Verify path input is pre-filled with a path starting with /
    const pathInputs = drawer.locator('input');
    let foundPath = false;
    const count = await pathInputs.count();
    for (let i = 0; i < count; i++) {
      const val = await pathInputs.nth(i).inputValue();
      if (val.startsWith('/')) {
        foundPath = true;
        console.log('Pre-filled path:', val);
        break;
      }
    }
    expect(foundPath).toBeTruthy();

    await page.screenshot({ path: '/tmp/route-test-drawer.png', fullPage: true });
  });

  test('can send a test request and see response', async ({ page }) => {
    const hasRoute = await navigateToFirstRouteDetail(page);
    if (!hasRoute) {
      test.skip(true, 'No routes available');
      return;
    }

    // Open test drawer
    await page.getByRole('button', { name: /test route/i }).click();
    await page.waitForTimeout(500);

    const drawer = page.locator('.mantine-Drawer-content');

    // Click Send
    await drawer.getByRole('button', { name: /send/i }).click();

    // Wait for response
    await page.waitForTimeout(5000);

    // Check if we got a response — look for a status badge (e.g., "200", "404", etc.)
    const statusBadge = drawer.locator('.mantine-Badge-root').first();
    const errorBox = drawer.locator('[style*="red"]').first();

    const hasResponse = await statusBadge.isVisible().catch(() => false);
    const hasError = await errorBox.isVisible().catch(() => false);

    expect(hasResponse || hasError).toBeTruthy();

    if (hasResponse) {
      const statusText = await statusBadge.textContent();
      console.log('Response status:', statusText);

      // Verify Body and Headers tabs exist in response
      const responseTabs = drawer.getByRole('tab');
      const tabCount = await responseTabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(2);

      // Verify duration is shown (Xms pattern)
      const pageText = await drawer.textContent();
      expect(pageText).toMatch(/\d+ms/);
    }

    await page.screenshot({ path: '/tmp/route-test-response.png', fullPage: true });
  });

  test('can add and remove headers', async ({ page }) => {
    const hasRoute = await navigateToFirstRouteDetail(page);
    if (!hasRoute) {
      test.skip(true, 'No routes available');
      return;
    }

    await page.getByRole('button', { name: /test route/i }).click();
    await page.waitForTimeout(500);

    const drawer = page.locator('.mantine-Drawer-content');

    // Count initial remove buttons (X icons for headers)
    const initialRemoveBtns = await drawer.locator('.mantine-ActionIcon-root').count();

    // Click "Add Header"
    await drawer.getByRole('button', { name: /add header/i }).click();

    // Verify a new row appeared
    const afterRemoveBtns = await drawer.locator('.mantine-ActionIcon-root').count();
    expect(afterRemoveBtns).toBeGreaterThan(initialRemoveBtns);

    // Remove the last header
    await drawer.locator('.mantine-ActionIcon-root').last().click();

    const finalRemoveBtns = await drawer.locator('.mantine-ActionIcon-root').count();
    expect(finalRemoveBtns).toBe(afterRemoveBtns - 1);

    await page.screenshot({ path: '/tmp/route-test-headers.png', fullPage: true });
  });

  test('can switch to query tab and add parameters', async ({ page }) => {
    const hasRoute = await navigateToFirstRouteDetail(page);
    if (!hasRoute) {
      test.skip(true, 'No routes available');
      return;
    }

    await page.getByRole('button', { name: /test route/i }).click();
    await page.waitForTimeout(500);

    const drawer = page.locator('.mantine-Drawer-content');

    // Click Query tab
    await drawer.getByRole('tab', { name: /query/i }).click();
    await page.waitForTimeout(200);

    // Add a query parameter
    await drawer.getByRole('button', { name: /add parameter/i }).click();

    // Should now have input fields for the new parameter
    // Use the visible tabpanel (query) — locate visible inputs only
    const visibleInputs = drawer.locator('[role="tabpanel"]:not([hidden]) input:visible');
    const inputCount = await visibleInputs.count();
    expect(inputCount).toBeGreaterThanOrEqual(2);

    // Fill in key and value
    await visibleInputs.first().fill('testKey');
    await visibleInputs.nth(1).fill('testValue');

    // Verify values are set
    await expect(visibleInputs.first()).toHaveValue('testKey');
    await expect(visibleInputs.nth(1)).toHaveValue('testValue');

    await page.screenshot({ path: '/tmp/route-test-query.png', fullPage: true });
  });

  test('shows body tab for POST method', async ({ page }) => {
    const hasRoute = await navigateToFirstRouteDetail(page);
    if (!hasRoute) {
      test.skip(true, 'No routes available');
      return;
    }

    await page.getByRole('button', { name: /test route/i }).click();
    await page.waitForTimeout(500);

    const drawer = page.locator('.mantine-Drawer-content');

    // Initially with GET, Body tab should not be visible
    const bodyTabBefore = drawer.getByRole('tab', { name: /^body$/i });
    const bodyVisibleBefore = await bodyTabBefore.isVisible().catch(() => false);

    // Change method to POST
    const methodSelect = drawer.locator('.mantine-Select-input').first();
    await methodSelect.click();
    await page.waitForTimeout(200);
    await page.getByRole('option', { name: 'POST' }).click();
    await page.waitForTimeout(200);

    // Body tab should now be visible
    const bodyTabAfter = drawer.getByRole('tab', { name: /body/i }).first();
    await expect(bodyTabAfter).toBeVisible();

    // Click Body tab and type some JSON
    await bodyTabAfter.click();
    const textarea = drawer.locator('textarea');
    await textarea.fill('{"test": true}');
    await expect(textarea).toHaveValue('{"test": true}');

    await page.screenshot({ path: '/tmp/route-test-body.png', fullPage: true });
  });
});

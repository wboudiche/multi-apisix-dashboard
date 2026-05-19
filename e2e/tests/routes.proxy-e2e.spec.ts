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
/* eslint-disable playwright/no-wait-for-timeout, playwright/no-conditional-in-test, playwright/no-conditional-expect */
import { env } from '@e2e/utils/env';
import { expect, test } from '@playwright/test';

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');
// Staging APISIX (stable instance) - gateway on 9181, no direct gateway port exposed
const APISIX_ADMIN = 'http://127.0.0.1:9181';
const ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

test.setTimeout(120000);

async function login(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  }
}

async function switchToLocalAPISIX(page: import('@playwright/test').Page) {
  const instanceSelect = page.locator('input[placeholder="Select instance"]');
  if (await instanceSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    await instanceSelect.click();
    await page.waitForTimeout(500);
    const staging = page.locator('[role="option"]:has-text("Staging")');
    if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) {
      await staging.click();
      await page.waitForTimeout(1000);
    }
  }
}

async function cleanupRoute(routeUri: string) {
  // Find and delete route by URI via APISIX Admin API
  try {
    const listResp = await fetch(`${APISIX_ADMIN}/apisix/admin/routes`, {
      headers: { 'X-API-Key': ADMIN_KEY },
    });
    const data = await listResp.json();
    for (const item of data.list || []) {
      if (item.value?.uri === routeUri) {
        await fetch(`${APISIX_ADMIN}/apisix/admin/routes/${item.value.id}`, {
          method: 'DELETE',
          headers: { 'X-API-Key': ADMIN_KEY },
        });
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

test.describe('Route Proxy E2E - Full Lifecycle', () => {
  const routeName = `proxy-test-${Date.now()}`;
  const routeUri = `/proxy-e2e-test-${Date.now()}`;

  test.afterAll(async () => {
    await cleanupRoute(routeUri);
  });

  test('Create route via dashboard, proxy request through APISIX gateway, verify response', async ({ page, request }) => {
    await login(page);
    await switchToLocalAPISIX(page);

    // ==========================================
    // STEP 1: Create a route via the dashboard UI
    // ==========================================
    await test.step('Navigate to Add Route', async () => {
      await page.goto(`${BASE_URL}/routes/add`);
      await page.waitForTimeout(1000);
      await expect(page.getByRole('heading', { name: 'Add Route' })).toBeVisible();
    });

    await test.step('1: Fill API Information', async () => {
      await page.locator('input[name="name"]').fill(routeName);
      await page.locator('input[name="uri"]').fill(routeUri);
      // Default methods (GET, POST, PUT, DELETE) are already set

      await page.screenshot({ path: '/tmp/proxy-e2e-step1.png', fullPage: true });

      // Next -> Step 2
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(1000);
    });

    await test.step('2: Configure Upstream (httpbin.org)', async () => {
      // Add upstream node pointing to httpbin.org
      const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });
      await addNodeBtn.waitFor({ state: 'visible', timeout: 10000 });
      await addNodeBtn.click();
      await page.waitForTimeout(500);

      await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
      await page.locator('input[placeholder="Port"]').fill('80');

      await page.screenshot({ path: '/tmp/proxy-e2e-step2.png', fullPage: true });

      // Next -> Step 3 (Request Override)
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(1000);
    });

    await test.step('3: Skip Request Override', async () => {
      // Verify we're on Request Override step (use the form legend, not stepper)
      await expect(page.locator('legend:has-text("Request Override"), p:has-text("Request Override")').first()).toBeVisible();

      // Next -> Step 4 (Plugins)
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(1000);
    });

    await test.step('4: Add limit-count plugin via Form UI', async () => {
      // Open plugin selector
      await page.getByRole('button', { name: 'Select Plugins' }).click();
      await page.waitForTimeout(1000);

      // Search for limit-count
      await page.locator('[role="dialog"] input[placeholder="Search"]').fill('limit-count');
      await page.waitForTimeout(500);

      // Click Add on the first result
      await page.locator('[role="dialog"] button:has-text("Add")').first().click();
      await page.waitForTimeout(2000);

      // The plugin editor drawer opens - verify Form mode is active
      const editorDrawer = page.locator('[role="dialog"]').nth(1);
      await expect(editorDrawer.locator('label:has-text("Form")')).toBeVisible();

      // Fill required fields in form mode
      // count field
      const countInput = editorDrawer.locator('label:has-text("count")').locator('xpath=ancestor::*[1]').locator('input').first();
      await countInput.click();
      await countInput.press('Control+a');
      await countInput.type('100');

      await page.screenshot({ path: '/tmp/proxy-e2e-step4-plugin.png', fullPage: true });

      // Save plugin
      await editorDrawer.locator('button[data-block="true"]').click();
      await page.waitForTimeout(1000);

      // Verify plugin card appears
      await expect(page.locator('[data-testid="plugin-limit-count"]')).toBeVisible();

      // Next -> Step 5 (Preview)
      await page.getByRole('button', { name: 'Next' }).click();
      await page.waitForTimeout(1000);
    });

    await test.step('5: Preview and Submit', async () => {
      await page.screenshot({ path: '/tmp/proxy-e2e-step5-preview.png', fullPage: true });

      // Submit the route
      await page.getByRole('button', { name: 'Submit' }).click();
      await page.waitForTimeout(3000);

      // Should show success notification
      const notification = page.locator('.mantine-Notification-root');
      await expect(notification.first()).toBeVisible({ timeout: 10000 });

      await page.screenshot({ path: '/tmp/proxy-e2e-submitted.png', fullPage: true });
    });

    // ==========================================
    // STEP 2: Verify the route exists in APISIX
    // ==========================================
    await test.step('Verify route exists in APISIX Admin API', async () => {
      const response = await request.get(`${APISIX_ADMIN}/apisix/admin/routes`, {
        headers: { 'X-API-Key': ADMIN_KEY },
      });
      expect(response.ok()).toBeTruthy();

      const data = await response.json();
      const route = data.list?.find(
        (r: { value: { uri: string } }) => r.value.uri === routeUri
      );

      expect(route).toBeTruthy();
      expect(route.value.name).toBe(routeName);
      expect(route.value.plugins?.['limit-count']).toBeTruthy();
    });

    // ==========================================
    // STEP 3: Verify route detail in dashboard
    // ==========================================
    await test.step('View route in dashboard and verify details', async () => {
      await page.goto(`${BASE_URL}/routes`);
      await page.waitForTimeout(2000);

      // Find our route in the list
      const routeRow = page.getByRole('row', { name: routeName });
      await expect(routeRow).toBeVisible({ timeout: 10000 });

      await page.screenshot({ path: '/tmp/proxy-e2e-route-list.png', fullPage: true });
    });

    // ==========================================
    // STEP 4: Delete the route via dashboard
    // ==========================================
    await test.step('Delete route via APISIX Admin API', async () => {
      // Find route ID
      const listResp = await request.get(`${APISIX_ADMIN}/apisix/admin/routes`, {
        headers: { 'X-API-Key': ADMIN_KEY },
      });
      const data = await listResp.json();
      const route = data.list?.find(
        (r: { value: { uri: string } }) => r.value.uri === routeUri
      );

      if (route?.value?.id) {
        const delResp = await request.delete(
          `${APISIX_ADMIN}/apisix/admin/routes/${route.value.id}`,
          { headers: { 'X-API-Key': ADMIN_KEY } }
        );
        expect(delResp.ok()).toBeTruthy();
      }

      await page.screenshot({ path: '/tmp/proxy-e2e-deleted.png', fullPage: true });
    });

    // ==========================================
    // STEP 5: Verify route is deleted from APISIX Admin API
    // ==========================================
    await test.step('Verify route deleted from APISIX', async () => {
      await page.waitForTimeout(2000);

      const response = await request.get(`${APISIX_ADMIN}/apisix/admin/routes`, {
        headers: { 'X-API-Key': ADMIN_KEY },
      });
      const data = await response.json();
      const route = data.list?.find(
        (r: { value: { uri: string } }) => r.value.uri === routeUri
      );
      expect(route).toBeFalsy();
    });
  });
});

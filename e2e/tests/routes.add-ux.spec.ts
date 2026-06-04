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

test.setTimeout(60000);

// Helper: login via JWT
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

// Helper: navigate to add route page (clears draft first)
async function goToAddRoute(page: import('@playwright/test').Page) {
  await page.evaluate(() => localStorage.removeItem('apisix-route-draft'));
  await page.goto(`${BASE_URL}/routes/add`);
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/routes\/add/);
}

// Helper: clear the pre-selected default methods (GET/POST/PUT/DELETE) from the TagsInput.
// The add-route form ships with defaults, so selected methods are absent from the dropdown.
async function clearMethods(page: import('@playwright/test').Page) {
  const wrapper = page
    .locator('.mantine-InputWrapper-root')
    .filter({ hasText: 'HTTP Methods' });
  const removeButtons = wrapper.locator('.mantine-Pill-remove');
  while ((await removeButtons.count()) > 0) {
    await removeButtons.first().click();
    await page.waitForTimeout(100);
  }
}

// Helper: select HTTP methods from the TagsInput
async function selectMethods(page: import('@playwright/test').Page, methods: string[]) {
  const methodsInput = page
    .locator('.mantine-InputWrapper-root')
    .filter({ hasText: 'HTTP Methods' })
    .locator('.mantine-TagsInput-input');

  for (const m of methods) {
    await methodsInput.click();
    await page.waitForTimeout(300);
    await page.getByRole('option', { name: m, exact: true }).click();
    await page.waitForTimeout(200);
  }
  // Close dropdown by clicking outside (on the page title)
  await page.locator('h1').first().click();
  await page.waitForTimeout(500);
}

// Helper: make the upstream step valid. The form defaults to a custom upstream with no
// nodes, which fails schema validation and blocks the Next button on step 2.
async function addUpstreamNode(page: import('@playwright/test').Page) {
  const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });
  await addNodeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addNodeBtn.click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
  await page.locator('input[placeholder="Port"]').fill('80');
}

// Helper: click Next, waiting for any dropdown/overlay to close first
async function clickNext(page: import('@playwright/test').Page) {
  // Ensure no dropdown is open
  const listbox = page.locator('[role="listbox"]');
  if (await listbox.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(2000);
}

test.describe('Route Add - UX Improvements', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Feature 7: Match Preview shows methods and URI in real-time', async ({ page }) => {
    await goToAddRoute(page);

    // The form ships with defaults (uri /* + GET/POST/PUT/DELETE),
    // so the preview is visible immediately with those values
    const previewBar = page.locator('[style*="dashed"]', { hasText: 'Route Preview' });
    await expect(previewBar).toBeVisible();
    await expect(previewBar.locator('code:has-text("/*")')).toBeVisible();

    // Changing the URI updates the preview in real-time
    await page.locator('input[name="uri"]').fill('/api/test');
    await page.waitForTimeout(500);
    await expect(previewBar.locator('code:has-text("/api/test")')).toBeVisible();

    // Removing all methods falls back to the ALL METHODS badge
    await clearMethods(page);
    await expect(previewBar.locator('text=ALL METHODS')).toBeVisible();

    // Selecting specific methods replaces the ALL METHODS badge
    await selectMethods(page, ['GET', 'POST']);
    const previewText = await previewBar.textContent();
    expect(previewText).toContain('GET');
    expect(previewText).toContain('POST');
    expect(previewText).not.toContain('ALL METHODS');

    await page.screenshot({ path: '/tmp/ux-match-preview.png' });
  });

  test('Feature 3: Tooltips show on info icons', async ({ page }) => {
    await goToAddRoute(page);

    const infoIcons = page.locator('svg[width="14"][height="14"]');
    const count = await infoIcons.count();
    expect(count).toBeGreaterThan(0);

    await infoIcons.first().hover();
    await page.waitForTimeout(500);

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: '/tmp/ux-tooltip.png' });
  });

  test('Feature 12: Plugin count badge shows on step label', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-plugin-badge');
    await page.locator('input[name="uri"]').fill('/test-badge');

    await clickNext(page); // step 1 -> 2 (Upstream)
    await addUpstreamNode(page); // custom upstream needs a node to pass validation
    await clickNext(page); // step 2 -> 3 (Request Override)
    await clickNext(page); // step 3 -> 4 (Plugins)

    // Open plugin drawer
    await page.getByRole('button', { name: 'Select Plugins' }).click();
    await page.waitForTimeout(1000);

    // Add a plugin from the categorized list
    const drawer = page.locator('.mantine-Drawer-body');
    await drawer.getByRole('button', { name: 'Add' }).first().click();
    await page.waitForTimeout(1000);
    await page.locator('button[data-block="true"]').click();
    await page.waitForTimeout(2000);

    // Check that the stepper's Plugins step shows a badge count "1"
    const stepperText = await page.evaluate(() => {
      const steps = document.querySelectorAll('.mantine-Stepper-step');
      return steps[3]?.textContent || '';
    });
    expect(stepperText).toContain('1');
    expect(stepperText).toContain('Plugins');

    await page.screenshot({ path: '/tmp/ux-plugin-badge.png' });
  });

  test('Feature 4: Step summaries show after completing steps', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-step-summary');
    await page.locator('input[name="uri"]').fill('/summary-test');
    await clearMethods(page); // drop the GET/POST/PUT/DELETE defaults
    await selectMethods(page, ['GET']);

    // Go to step 2
    await clickNext(page);

    // Step 1 description should now show the summary
    const stepDescription = page.locator('.mantine-Stepper-stepDescription').first();
    await expect(stepDescription).toBeVisible();
    const descText = await stepDescription.textContent();
    expect(descText).toContain('GET');
    expect(descText).toContain('/summary-test');

    await page.screenshot({ path: '/tmp/ux-step-summary.png' });
  });

  test('Feature 1: Preview step shows structured summary', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-preview');
    await page.locator('input[name="uri"]').fill('/preview-test');
    await clearMethods(page); // drop the GET/POST/PUT/DELETE defaults
    await selectMethods(page, ['GET']);

    // Navigate through all steps to Preview (step 5)
    await clickNext(page); // step 1 -> 2
    await addUpstreamNode(page); // custom upstream needs a node to pass validation
    await clickNext(page); // step 2 -> 3 (Request Override)
    await clickNext(page); // step 3 -> 4 (Plugins)
    await clickNext(page); // step 4 -> 5 (Preview)
    await page.waitForTimeout(1000);

    // Should show structured content from RoutePreviewSummary (section headings are
    // plain Text paragraphs). Exact match avoids the stepper label "Define API Information".
    await expect(page.getByText('API Information', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Upstream Configuration', { exact: true })).toBeVisible();

    // Should show the route name and URI
    await expect(page.locator('text=test-preview')).toBeVisible();
    await expect(page.locator('code:has-text("/preview-test")')).toBeVisible();

    await page.screenshot({ path: '/tmp/ux-preview.png' });
  });

  test('Feature 6: Test Connection button visible in upstream step', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-upstream-conn');
    await page.locator('input[name="uri"]').fill('/upstream-test');

    // Go to step 2 (Upstream) — custom upstream mode is the default
    await clickNext(page);

    // The button renders disabled until a node with a host exists
    const testBtn = page.getByRole('button', { name: /Test Connection/i });
    await expect(testBtn).toBeVisible({ timeout: 5000 });
    await expect(testBtn).toBeDisabled();

    await addUpstreamNode(page);
    await expect(testBtn).toBeEnabled();

    await page.screenshot({ path: '/tmp/ux-test-connection.png' });
  });

  test('Feature 10: Keyboard navigation with Enter and Escape', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-keyboard-nav');
    await page.locator('input[name="uri"]').fill('/keyboard-test');

    // Click on a non-interactive element then press Enter
    await page.locator('h1').first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Should have advanced to step 2
    await expect(page.locator('text=Upstream').first()).toBeVisible();

    // Press Escape to go back
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Should be back on step 1
    await expect(page.locator('input[name="name"]')).toBeVisible();

    await page.screenshot({ path: '/tmp/ux-keyboard-nav.png' });
  });

  test('Feature 2: Unsaved changes warning on cancel', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-unsaved');
    await page.locator('input[name="uri"]').fill('/unsaved-test');
    await page.waitForTimeout(500);

    // Click Cancel (click on the page title first to deselect any input)
    await page.locator('h1').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(1000);

    // Modal should appear
    await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();

    // Click Stay
    await page.getByRole('button', { name: 'Stay' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('input[name="name"]')).toHaveValue('test-unsaved');

    // Click Cancel again then Leave
    await page.locator('h1').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Leave' }).click();
    await page.waitForTimeout(2000);

    await expect(page).toHaveURL(/\/routes/);

    await page.screenshot({ path: '/tmp/ux-unsaved-warning.png' });
  });

  test('Feature 11: Draft auto-save and restore', async ({ page }) => {
    await goToAddRoute(page);

    // Fill some data
    await page.locator('input[name="name"]').fill('draft-auto-save-test');
    await page.locator('input[name="uri"]').fill('/draft-test');
    await page.waitForTimeout(3000); // wait for auto-save debounce

    // Verify draft is saved in localStorage
    const draft = await page.evaluate(() => localStorage.getItem('apisix-route-draft'));
    expect(draft).toBeTruthy();
    const parsed = JSON.parse(draft!);
    expect(parsed.name).toBe('draft-auto-save-test');

    // Handle the beforeunload dialog that appears when form is dirty
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(`${BASE_URL}/routes/add`, { waitUntil: 'load' });
    await page.waitForTimeout(5000);

    // The draft should be restored
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15000 });
    const nameValue = page.locator('input[name="name"]');
    await expect(nameValue).toHaveValue('draft-auto-save-test');

    // Discard draft button should be visible
    await expect(page.getByRole('button', { name: 'Discard Draft' })).toBeVisible();

    await page.screenshot({ path: '/tmp/ux-draft-autosave.png' });

    // Clean up
    await page.evaluate(() => localStorage.removeItem('apisix-route-draft'));
  });
});

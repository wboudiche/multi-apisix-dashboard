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
/* eslint-disable playwright/no-wait-for-timeout, playwright/no-conditional-in-test, playwright/no-skipped-test, playwright/no-conditional-expect */
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

    // Initially no preview (no data entered)
    await expect(page.locator('text=Route Preview')).toBeHidden();

    // Fill URI
    await page.locator('input[name="uri"]').fill('/api/test');
    await page.waitForTimeout(500);

    // Preview should appear with the URI and "ALL METHODS"
    await expect(page.locator('text=Route Preview')).toBeVisible();
    await expect(page.locator('code:has-text("/api/test")')).toBeVisible();
    await expect(page.locator('text=ALL METHODS')).toBeVisible();

    // Select specific methods
    await selectMethods(page, ['GET', 'POST']);

    // The preview bar (dashed border Paper) should show selected methods
    const previewBar = page.locator('[style*="dashed"]');
    await expect(previewBar).toBeVisible();
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

    await clickNext(page);
    await clickNext(page);
    await clickNext(page);

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
    await selectMethods(page, ['GET']);

    // Navigate through all steps to Preview (step 5)
    await clickNext(page); // step 1 -> 2
    await clickNext(page); // step 2 -> 3 (Request Override)
    await clickNext(page); // step 3 -> 4 (Plugins)
    await clickNext(page); // step 4 -> 5 (Preview)
    await page.waitForTimeout(1000);

    // Should show structured content from RoutePreviewSummary
    // Use exact heading match to avoid matching stepper label "Define API Information"
    await expect(page.getByRole('button', { name: 'API Information', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Upstream Configuration', exact: true })).toBeVisible();

    // Should show the route name and URI
    await expect(page.locator('text=test-preview')).toBeVisible();
    await expect(page.locator('code:has-text("/preview-test")')).toBeVisible();

    await page.screenshot({ path: '/tmp/ux-preview.png' });
  });

  test('Feature 6: Test Connection button visible in upstream step', async ({ page }) => {
    await goToAddRoute(page);

    await page.locator('input[name="name"]').fill('test-upstream-conn');
    await page.locator('input[name="uri"]').fill('/upstream-test');

    // Go to step 2 (Upstream)
    await clickNext(page);

    // Select "Custom" from the Upstream dropdown
    const upstreamSelect = page.locator('.mantine-Select-input').last();
    await upstreamSelect.click();
    await page.waitForTimeout(500);

    const customOption = page.getByRole('option', { name: 'Custom' });
    if (await customOption.isVisible()) {
      await customOption.click();
      await page.waitForTimeout(1000);

      const testBtn = page.getByRole('button', { name: /Test Connection/i });
      await expect(testBtn).toBeVisible({ timeout: 5000 });

      await page.screenshot({ path: '/tmp/ux-test-connection.png' });
    } else {
      await page.keyboard.press('Escape');
      test.skip();
    }
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

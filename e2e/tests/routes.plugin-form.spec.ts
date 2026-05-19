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
/* eslint-disable playwright/no-wait-for-timeout, playwright/no-conditional-in-test */
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
    await page.waitForURL((u) => !u.pathname.includes('/login'), {
      timeout: 15000,
    });
  }
}

async function goToAddRoute(page: import('@playwright/test').Page) {
  await page.evaluate(() => localStorage.removeItem('apisix-route-draft'));
  await page.goto(`${BASE_URL}/routes/add`);
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/routes\/add/);
}

async function clickNext(page: import('@playwright/test').Page) {
  const listbox = page.locator('[role="listbox"]');
  if (await listbox.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(2000);
}

/**
 * Navigate to the Plugins step (step 4) in the route wizard.
 *
 * Steps: fill name + uri -> Next (to Upstream) -> add upstream node ->
 * Next (to Request Override) -> Next (to Plugins)
 */
async function navigateToPluginsStep(page: import('@playwright/test').Page) {
  await goToAddRoute(page);

  // Step 1: API Info - fill required fields
  await page.locator('input[name="name"]').fill('test-plugin-form');
  await page.locator('input[name="uri"]').fill('/test-plugin-form');

  // Next -> Step 2: Upstream
  await clickNext(page);

  // Add upstream node
  const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });
  await addNodeBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addNodeBtn.click();
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="Hostname or IP"]').fill('httpbin.org');
  await page.locator('input[placeholder="Port"]').fill('80');

  // Next -> Step 3: Request Override
  await clickNext(page);

  // Next -> Step 4: Plugins
  await clickNext(page);
}

/**
 * Open the plugin editor drawer for limit-conn.
 *
 * Clicks "Select Plugins", searches for limit-conn, clicks the first "Add"
 * button. Returns the plugin editor drawer (second dialog).
 */
async function addLimitConnPlugin(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  await page.waitForTimeout(1000);

  const searchInput = page.locator('[role="dialog"] input[placeholder="Search"]');
  await expect(searchInput).toBeVisible({ timeout: 10000 });
  await searchInput.fill('limit-conn');
  await page.waitForTimeout(1000);

  // Click the first "Add" button in the search results
  const addButtons = page.locator('[role="dialog"]').first().getByRole('button', { name: 'Add' });
  await addButtons.first().click();
  await page.waitForTimeout(1500);

  // The plugin editor is the second dialog (the drawer that opens on top)
  const editorDrawer = page.locator('[role="dialog"]').last();
  await expect(editorDrawer).toBeVisible({ timeout: 10000 });

  return editorDrawer;
}

test.describe('Route Plugin Form Editor', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Form/JSON toggle is visible for plugins with schema', async ({
    page,
  }) => {
    await navigateToPluginsStep(page);
    const editorDrawer = await addLimitConnPlugin(page);

    // Verify the Form/JSON toggle labels are visible in the editor drawer
    const formLabel = editorDrawer.locator('label:has-text("Form")');
    const jsonLabel = editorDrawer.locator('label:has-text("JSON")');

    await expect(formLabel).toBeVisible({ timeout: 10000 });
    await expect(jsonLabel).toBeVisible({ timeout: 10000 });
  });

  test('Form mode shows typed fields for limit-conn', async ({ page }) => {
    await navigateToPluginsStep(page);
    const editorDrawer = await addLimitConnPlugin(page);

    // Switch to Form mode
    await editorDrawer.locator('label:has-text("Form")').click();
    await page.waitForTimeout(1000);

    // Verify that the expected form field labels are visible
    const expectedLabels = ['conn', 'burst', 'key', 'rejected_code', 'policy'];

    for (const label of expectedLabels) {
      await expect(
        editorDrawer.getByText(label, { exact: true })
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test('Form values sync to JSON mode', async ({ page }) => {
    await navigateToPluginsStep(page);
    const editorDrawer = await addLimitConnPlugin(page);

    // Switch to Form mode
    await editorDrawer.locator('label:has-text("Form")').click();
    await page.waitForTimeout(1000);

    // Find the conn field input and set it to 999
    const connInput = editorDrawer.getByLabel('conn', { exact: true });
    await expect(connInput).toBeVisible({ timeout: 10000 });
    await connInput.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('999');
    await page.waitForTimeout(500);

    // Switch to JSON mode
    await editorDrawer.locator('label:has-text("JSON")').click();
    await page.waitForTimeout(1500);

    // Verify the JSON editor contains our value
    // Monaco renders content in .view-lines, check for "999" in the editor area
    const monacoArea = editorDrawer.locator('.monaco-editor');
    await expect(monacoArea).toBeVisible({ timeout: 5000 });
    const editorText = await monacoArea.textContent();
    expect(editorText).toContain('999');
  });

  test('Plugin saves correctly from form mode', async ({ page }) => {
    await navigateToPluginsStep(page);
    const editorDrawer = await addLimitConnPlugin(page);

    // Switch to Form mode
    await editorDrawer.locator('label:has-text("Form")').click();
    await page.waitForTimeout(1000);

    // Fill in required fields so the plugin config is valid
    const connInput = editorDrawer.getByLabel('conn', { exact: true });
    await connInput.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('10');

    const burstInput = editorDrawer.getByLabel('burst', { exact: true });
    await burstInput.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('5');

    const defaultConnDelayInput = editorDrawer.getByLabel('default_conn_delay', { exact: true });
    if (await defaultConnDelayInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await defaultConnDelayInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('1');
    }

    const rejectedCodeInput = editorDrawer.getByLabel('rejected_code', { exact: true });
    if (await rejectedCodeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rejectedCodeInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('503');
    }

    const keyInput = editorDrawer.getByLabel('key', { exact: true });
    if (await keyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await keyInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('remote_addr');
    }

    await page.waitForTimeout(500);

    // Click the save/add button (block-level button in the drawer)
    const saveButton = editorDrawer.locator('button[data-block="true"]');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Verify the plugin appears in the plugins section with the test ID
    const pluginTag = page.locator('[data-testid="plugin-limit-conn"]');
    await expect(pluginTag).toBeVisible({ timeout: 15000 });
  });
});

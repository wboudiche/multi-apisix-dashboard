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
import { permission } from '@e2e/pom/permission';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq } from '@e2e/utils/req';
import { expect, type Page, test } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

/**
 * The Plugin Metadata page kept its queries in cache under keys that did not
 * name the instance, and switching instance in the header does not remount
 * the page. So after a switch it went on showing the previous instance's
 * metadata — while a save from the same drawer is addressed to the instance
 * now selected, because `req` reads the instance afresh for every request
 * (#180). An admin who opened the page on staging, switched to prod and
 * edited a card was shown staging's configuration and would save it to prod.
 */

// A plugin no other spec touches: http-logger, syslog, tcp-logger and
// udp-logger all belong to other plugin_metadata specs, whose hooks create and
// delete their entries.
const PLUGIN = 'file-logger';
// The same plugin, a different value on each instance — the only way to tell
// from the screen which instance's metadata is shown.
const LOCAL_PATH = randomId('e2e-local');
const STAGING_PATH = randomId('e2e-staging');

// Both tests read the seeded entries, so they run in one worker, in order.
test.describe.configure({ mode: 'serial' });

// loginAs, a reload to pick the instance and the page's own loads do not fit
// in Playwright's 30s default.
const TIMEOUT_MS = 120_000;

// e2eReq is bound to the local instance.
const onStaging = () => ({
  headers: { 'X-Instance-ID': getFixtures().stagingInstanceId },
});

test.beforeAll(async () => {
  await e2eReq.put(`${API_PLUGIN_METADATA}/${PLUGIN}`, { path: LOCAL_PATH });
  await e2eReq.put(
    `${API_PLUGIN_METADATA}/${PLUGIN}`,
    { path: STAGING_PATH },
    onStaging()
  );
});

test.afterAll(async () => {
  // Already gone is fine.
  await e2eReq.delete(`${API_PLUGIN_METADATA}/${PLUGIN}`).catch(() => {});
  await e2eReq
    .delete(`${API_PLUGIN_METADATA}/${PLUGIN}`, onStaging())
    .catch(() => {});
});

const card = (page: Page) => page.getByTestId(`plugin-${PLUGIN}`);

/** Open the card's editor, show its JSON, and return the editor's text. */
const openEditorJson = async (page: Page) => {
  await card(page).getByRole('button', { name: 'Edit' }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit Plugin' });
  await expect(drawer).toBeVisible();
  await drawer.locator('label:has-text("JSON")').click();
  return { drawer, json: drawer.locator('.monaco-editor .view-lines') };
};

/** Open the page on staging, as an admin of both instances. */
const openOnStaging = async (page: Page) => {
  const fx = getFixtures();
  await permission.loginAs(page, fx.users.admin.username, fx.users.admin.password);
  await permission.switchInstance(page, 'Staging APISIX');
  await page.goto('/ui/plugin_metadata');

  // The baseline: opened on staging, the page shows staging's value. This
  // also proves the editor displays the value at all, so a check after the
  // switch cannot pass on an empty editor.
  await expect(card(page)).toBeVisible({ timeout: 30000 });
  const { drawer, json } = await openEditorJson(page);
  await expect(json).toContainText(STAGING_PATH);
  await drawer.locator('.mantine-Drawer-close').click();
  await expect(drawer).toBeHidden();
};

/**
 * In the header, the way a person would — not permission.switchInstance,
 * whose reload remounts the page and hides exactly this.
 */
const switchToLocalInHeader = async (page: Page) => {
  const switcher = page.locator('header input[placeholder="Select instance"]');
  await switcher.click();
  await page.getByRole('option', { name: 'Local APISIX' }).click();
  await expect(switcher).toHaveValue('Local APISIX');
};

test('after an instance switch in the header, the page shows the new instance', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openOnStaging(page);
    await switchToLocalInHeader(page);

    const { json } = await openEditorJson(page);
    await expect(json).toContainText(LOCAL_PATH);
    await expect(json).not.toContainText(STAGING_PATH);
  } finally {
    await context.close();
  }
});

test('while the new instance loads, the page does not offer the previous one', async ({
  browser,
}) => {
  // With only the query keys fixed, the page kept the cards it had built from
  // staging's answers until local's arrived. On a slow gateway, Edit in that
  // window opened staging's configuration, and Save sent it to local. Local's
  // answer is held here, which makes the slow gateway deterministic.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });
  let release = () => {};

  try {
    const page = await context.newPage();
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/apisix/admin/plugin_metadata/${PLUGIN}`, async (route) => {
      if (route.request().headers()['x-instance-id'] === fx.localInstanceId) {
        await released;
      }
      await route.continue();
    });

    await openOnStaging(page);
    await switchToLocalInHeader(page);

    // The page's own sign that it is waiting on local, so the absence after it
    // is checked on a page that has moved on to local — not on one that has
    // not re-rendered yet.
    await expect(page.getByTestId('plugin-metadata-loading')).toBeVisible();
    await expect(card(page)).toHaveCount(0);

    release();
    const { json } = await openEditorJson(page);
    await expect(json).toContainText(LOCAL_PATH);
  } finally {
    release();
    await context.close();
  }
});

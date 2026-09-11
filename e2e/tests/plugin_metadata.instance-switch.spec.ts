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
import { pluginConfigsPom } from '@e2e/pom/plugin_configs';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq } from '@e2e/utils/req';
import { expect, type Page, type Request, test } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

/**
 * The Plugin Metadata page kept its queries in cache under keys that did not
 * name the instance, and switching instance in the header does not remount
 * the page. So after a switch it went on showing the previous instance's
 * metadata — while a save from the same drawer is addressed to the instance
 * now selected, because `req` reads the instance afresh for every request
 * (#180). An admin who opened the page on staging, switched to prod and
 * edited a card was shown staging's configuration and would have saved it to
 * prod.
 */

// A plugin no other spec uses. http-logger, syslog and udp-logger belong to
// other plugin_metadata specs, whose hooks create and delete their entries.
const PLUGIN = 'file-logger';
// The same plugin, a different value on each instance — the only way to tell
// from the screen which instance's metadata is shown.
const LOCAL_PATH = randomId('e2e-local');
const STAGING_PATH = randomId('e2e-staging');

// The tests read the seeded entries, so they run in one worker, in order.
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

const loginAsAdminOn = async (page: Page, instance: string) => {
  const fx = getFixtures();
  await permission.loginAs(page, fx.users.admin.username, fx.users.admin.password);
  await permission.switchInstance(page, instance);
};

/** Open the page on staging, as an admin of both instances. */
const openOnStaging = async (page: Page) => {
  await loginAsAdminOn(page, 'Staging APISIX');
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
 * whose reload remounts everything and hides exactly this.
 */
const switchInHeader = async (page: Page, instance: string) => {
  const switcher = page.locator('header input[placeholder="Select instance"]');
  await switcher.click();
  await page.getByRole('option', { name: instance }).click();
  await expect(switcher).toHaveValue(instance);
};

/**
 * Count the page's plugin metadata reads still in flight, so a test can wait
 * for the page to settle rather than for a length of time. Reads only: a test
 * may be holding a write on purpose.
 */
const trackMetadataRequests = (page: Page) => {
  let inFlight = 0;
  const isMetadata = (r: Request) =>
    r.method() === 'GET' && r.url().includes('/apisix/admin/plugin_metadata/');
  page.on('request', (r) => {
    if (isMetadata(r)) inFlight += 1;
  });
  const settle = (r: Request) => {
    if (isMetadata(r)) inFlight -= 1;
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  return () => inFlight;
};

test('after an instance switch in the header, the page shows the new instance', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openOnStaging(page);
    await switchInHeader(page, 'Local APISIX');

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
    await switchInHeader(page, 'Local APISIX');

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

test('a gateway failing on the switch leaves the app, and an open form, in place', async ({
  browser,
}) => {
  // Keyed on the instance, the plugin catalogue is fetched again on a switch
  // where it used to come from cache. The query suspends, and its error went
  // up to the root route's error boundary: the whole app, header included,
  // replaced by the error page, and a half-filled form lost with it. A gateway
  // the proxy cannot reach now reads as an empty catalogue, as the resource
  // lists already do.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });
  const typed = randomId('e2e-form-kept');

  try {
    const page = await context.newPage();
    // Staging's catalogue answers 502, as the proxy does for a gateway it
    // cannot reach. Matched on the path: in a glob `?` is one character.
    await page.route(
      (url) => url.pathname.endsWith('/apisix/admin/plugins'),
      async (route) => {
        if (route.request().headers()['x-instance-id'] === fx.stagingInstanceId) {
          await route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ error_msg: 'e2e: gateway unreachable' }),
          });
          return;
        }
        await route.continue();
      }
    );

    await loginAsAdminOn(page, 'Local APISIX');
    await pluginConfigsPom.toAdd(page);
    await pluginConfigsPom.isAddPage(page);
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill(typed);
    await expect(
      page.getByRole('button', { name: 'Select Plugins' })
    ).toBeVisible();

    const failed = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.endsWith('/apisix/admin/plugins') &&
        res.status() === 502
    );
    await switchInHeader(page, 'Staging APISIX');
    await failed;

    // Visible, not merely present: while the query retried, the form was still
    // in the document but hidden behind the root loader — and then gone.
    await expect(name).toBeVisible();
    await expect(name).toHaveValue(typed);
    await expect(page.locator('header')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a save that lands after a switch leaves the previous instance its own metadata', async ({
  browser,
}) => {
  // A save refetches the page's queries when it succeeds. Landing after a
  // switch, that refetch ran for the unmounted page — under staging's keys —
  // while `req` addressed it to the instance now selected, so staging's cache
  // came to hold local's metadata. Back on staging within the cache's lifetime,
  // the page showed it from cache, and Edit opened local's configuration for a
  // Save addressed to staging.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });
  let releasePut = () => {};
  let releaseStagingGets = () => {};

  try {
    const page = await context.newPage();
    const putReleased = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const stagingGetsReleased = new Promise<void>((resolve) => {
      releaseStagingGets = resolve;
    });
    let holdStagingGets = false;
    await page.route(`**/apisix/admin/plugin_metadata/${PLUGIN}`, async (route) => {
      const request = route.request();
      if (request.headers()['x-instance-id'] === fx.stagingInstanceId) {
        if (request.method() === 'PUT') await putReleased;
        if (request.method() === 'GET' && holdStagingGets) {
          await stagingGetsReleased;
        }
      }
      await route.continue();
    });

    const inFlight = trackMetadataRequests(page);

    await openOnStaging(page);

    // Save staging's entry as it is. The PUT is held, so it lands later.
    await card(page).getByRole('button', { name: 'Edit' }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit Plugin' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toBeHidden();

    await switchInHeader(page, 'Local APISIX');
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect.poll(inFlight).toBe(0);

    releasePut();
    await expect(
      page.getByText(`Edit Plugin Metadata of ${PLUGIN} Successfully`)
    ).toBeVisible();
    await expect.poll(inFlight).toBe(0);

    // Back on staging with staging's own answers held: what the page shows now
    // comes from its cache.
    holdStagingGets = true;
    await switchInHeader(page, 'Staging APISIX');
    const { json } = await openEditorJson(page);
    await expect(json).toContainText(STAGING_PATH);
    await expect(json).not.toContainText(LOCAL_PATH);
  } finally {
    releasePut();
    releaseStagingGets();
    await context.close();
  }
});

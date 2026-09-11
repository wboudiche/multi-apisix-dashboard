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
import { expect, type Page, type Request, test } from '@playwright/test';

import {
  API_PLUGIN_CONFIGS,
  API_ROUTES,
  API_UPSTREAMS,
} from '@/config/constant';

/**
 * A detail page is one instance's record. Its query was keyed without the
 * instance and switching instance in the header did not remount it, so after
 * a switch it went on showing the record it had opened with — while a save
 * from it went to the instance now selected, under the same id (#187). The
 * page now reloads the record from the new instance, and says so when that
 * instance has no such record.
 */

// Present on both instances under one id, with a different name on each: the
// way the same configuration is deployed to staging and prod. The name is how
// the screen tells which instance's record it is showing.
const ROUTE_BOTH = randomId('e2e-detail-both');
const PLUGIN_CONFIG_BOTH = randomId('e2e-detail-pc');
// Present on staging only.
const ROUTE_STAGING_ONLY = randomId('e2e-detail-staging-only');
const UPSTREAM_STAGING_ONLY = randomId('e2e-detail-upstream');

const onLocal = (id: string) => `${id}-on-local`;
const onStagingName = (id: string) => `${id}-on-staging`;

// The tests read the seeded records, so they run in one worker, in order.
test.describe.configure({ mode: 'serial' });

// loginAs, a reload to pick the instance and the page's own loads do not fit
// in Playwright's 30s default.
const TIMEOUT_MS = 120_000;

// e2eReq is bound to the local instance.
const onStaging = () => ({
  headers: { 'X-Instance-ID': getFixtures().stagingInstanceId },
});

const route = (id: string, name: string) => ({
  id,
  name,
  uri: `/${id}`,
  methods: ['GET'],
  upstream: {
    type: 'roundrobin',
    nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }],
  },
});

const pluginConfig = (id: string, name: string) => ({
  id,
  name,
  plugins: { 'response-rewrite': { body: 'e2e' } },
});

test.beforeAll(async () => {
  await e2eReq.put(`${API_ROUTES}/${ROUTE_BOTH}`, route(ROUTE_BOTH, onLocal(ROUTE_BOTH)));
  await e2eReq.put(
    `${API_ROUTES}/${ROUTE_BOTH}`,
    route(ROUTE_BOTH, onStagingName(ROUTE_BOTH)),
    onStaging()
  );
  await e2eReq.put(
    `${API_ROUTES}/${ROUTE_STAGING_ONLY}`,
    route(ROUTE_STAGING_ONLY, onStagingName(ROUTE_STAGING_ONLY)),
    onStaging()
  );
  await e2eReq.put(
    `${API_UPSTREAMS}/${UPSTREAM_STAGING_ONLY}`,
    {
      name: onStagingName(UPSTREAM_STAGING_ONLY),
      type: 'roundrobin',
      nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }],
    },
    onStaging()
  );
  await e2eReq.put(
    `${API_PLUGIN_CONFIGS}/${PLUGIN_CONFIG_BOTH}`,
    pluginConfig(PLUGIN_CONFIG_BOTH, onLocal(PLUGIN_CONFIG_BOTH))
  );
  await e2eReq.put(
    `${API_PLUGIN_CONFIGS}/${PLUGIN_CONFIG_BOTH}`,
    pluginConfig(PLUGIN_CONFIG_BOTH, onStagingName(PLUGIN_CONFIG_BOTH)),
    onStaging()
  );
});

test.afterAll(async () => {
  // Already gone is fine. Routes before the upstream nothing references.
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_BOTH}`).catch(() => {});
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_BOTH}`, onStaging()).catch(() => {});
  await e2eReq
    .delete(`${API_ROUTES}/${ROUTE_STAGING_ONLY}`, onStaging())
    .catch(() => {});
  await e2eReq
    .delete(`${API_UPSTREAMS}/${UPSTREAM_STAGING_ONLY}`, onStaging())
    .catch(() => {});
  await e2eReq
    .delete(`${API_PLUGIN_CONFIGS}/${PLUGIN_CONFIG_BOTH}`)
    .catch(() => {});
  await e2eReq
    .delete(`${API_PLUGIN_CONFIGS}/${PLUGIN_CONFIG_BOTH}`, onStaging())
    .catch(() => {});
});

const nameField = (page: Page) =>
  page.getByRole('textbox', { name: 'Name', exact: true });

const loginAsAdminOn = async (page: Page, instance: string) => {
  const fx = getFixtures();
  await permission.loginAs(page, fx.users.admin.username, fx.users.admin.password);
  await permission.switchInstance(page, instance);
};

/** Open a detail page on staging, as an admin of both instances. */
const openOnStaging = async (page: Page, path: string, name: string) => {
  await loginAsAdminOn(page, 'Staging APISIX');
  await page.goto(path);
  // The baseline: opened on staging, the page shows staging's record.
  await expect(nameField(page)).toHaveValue(name, { timeout: 30000 });
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
 * Count the page's reads of one path still in flight, so a test can wait for
 * the page to settle rather than for a length of time. Reads only: a test may
 * be holding a write on purpose.
 */
const trackReads = (page: Page, path: string) => {
  let inFlight = 0;
  const isRead = (r: Request) => r.method() === 'GET' && r.url().includes(path);
  page.on('request', (r) => {
    if (isRead(r)) inFlight += 1;
  });
  const settle = (r: Request) => {
    if (isRead(r)) inFlight -= 1;
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  return () => inFlight;
};

test('a record on both instances is shown from the one switched to', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openOnStaging(
      page,
      `/ui/routes/detail/${ROUTE_BOTH}`,
      onStagingName(ROUTE_BOTH)
    );
    await switchInHeader(page, 'Local APISIX');
    await expect(nameField(page)).toHaveValue(onLocal(ROUTE_BOTH));

    // And back. Staging's record is in the cache by now, so nothing loads and
    // nothing forces the page under the gate to render again: only the gate's
    // remount on the instance does.
    await switchInHeader(page, 'Staging APISIX');
    await expect(nameField(page)).toHaveValue(onStagingName(ROUTE_BOTH));
  } finally {
    await context.close();
  }
});

test('a record the new instance lacks is reported, not shown from the old one', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openOnStaging(
      page,
      `/ui/routes/detail/${ROUTE_STAGING_ONLY}`,
      onStagingName(ROUTE_STAGING_ONLY)
    );
    await switchInHeader(page, 'Local APISIX');

    // The positive sign first, so the absence after it is checked on a page
    // that has moved on to local.
    const notFound = page.getByTestId('detail-not-found');
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText(ROUTE_STAGING_ONLY);
    await expect(nameField(page)).toHaveCount(0);

    await notFound.getByRole('button', { name: 'Back to List' }).click();
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/routes'));
  } finally {
    await context.close();
  }
});

test('a page that suspends on its record reports it too, inside the app', async ({
  browser,
}) => {
  // The upstream page reads its record with useSuspenseQuery. Were the new
  // instance's 404 thrown from it, it would reach the root route's error
  // boundary and replace the whole app, header included.
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openOnStaging(
      page,
      `/ui/upstreams/detail/${UPSTREAM_STAGING_ONLY}`,
      onStagingName(UPSTREAM_STAGING_ONLY)
    );
    await switchInHeader(page, 'Local APISIX');

    await expect(page.getByTestId('detail-not-found')).toBeVisible();
    await expect(nameField(page)).toHaveCount(0);
    await expect(
      page.locator('header input[placeholder="Select instance"]')
    ).toHaveValue('Local APISIX');
  } finally {
    await context.close();
  }
});

test('a save that lands after a switch leaves the first instance its own record', async ({
  browser,
}) => {
  // A save refetches the page's record when it succeeds. Landing after a
  // switch, that refetch runs for a page already unmounted, under the first
  // instance's key; addressed to the instance selected by then, it would
  // store the second instance's record there, to be shown on the way back.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });
  const path = `/apisix/admin/plugin_configs/${PLUGIN_CONFIG_BOTH}`;
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
    await page.route(`**${path}`, async (route) => {
      const request = route.request();
      if (request.headers()['x-instance-id'] === fx.stagingInstanceId) {
        if (request.method() === 'PUT') await putReleased;
        if (request.method() === 'GET' && holdStagingGets) {
          await stagingGetsReleased;
        }
      }
      await route.continue();
    });
    const inFlight = trackReads(page, path);

    await openOnStaging(
      page,
      `/ui/plugin_configs/detail/${PLUGIN_CONFIG_BOTH}`,
      onStagingName(PLUGIN_CONFIG_BOTH)
    );

    // Save staging's record as it is. The PUT is held, so it lands later.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await switchInHeader(page, 'Local APISIX');
    await expect(nameField(page)).toHaveValue(onLocal(PLUGIN_CONFIG_BOTH), {
      timeout: 30000,
    });
    await expect.poll(inFlight).toBe(0);

    // The save's own refetch, whichever instance answers it — armed before
    // the release, so the wait for the page to settle cannot resolve before
    // that refetch has started.
    const refetched = page.waitForRequest(
      (r) => r.method() === 'GET' && r.url().includes(path)
    );
    releasePut();
    await expect(page.getByText(/^Edit .+ Successfully$/)).toBeVisible();
    await refetched;
    await expect.poll(inFlight).toBe(0);

    // Back on staging with staging's own answers held: what the page shows now
    // comes from its cache.
    holdStagingGets = true;
    await switchInHeader(page, 'Staging APISIX');
    await expect(nameField(page)).toHaveValue(onStagingName(PLUGIN_CONFIG_BOTH));
  } finally {
    releasePut();
    releaseStagingGets();
    await context.close();
  }
});

test('an unreachable instance’s banner does not follow a switch to a reachable one', async ({
  browser,
}) => {
  // Any successful proxy answer used to clear the banner. Now that a request
  // can be addressed to an instance other than the selected one, an answer
  // clears only the banner of the instance that gave it — so the banner must
  // show for the selected instance alone, or staging's would stay up on
  // local's pages.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    // Every staging request answers 502, as the proxy does for a gateway it
    // cannot reach. All of them: a staging answer that got through would say
    // staging is reachable, and clear its banner as it should.
    await page.route(
      (url) => url.pathname.includes('/apisix/admin/'),
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

    await loginAsAdminOn(page, 'Staging APISIX');
    await page.goto('/ui/routes');
    const banner = page.getByRole('alert').filter({ hasText: 'Staging APISIX' });
    await expect(banner).toBeVisible({ timeout: 30000 });

    const localListed = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname.endsWith('/apisix/admin/routes') &&
        res.request().headers()['x-instance-id'] === fx.localInstanceId &&
        res.ok()
    );
    await switchInHeader(page, 'Local APISIX');
    await localListed;
    // Seen a moment ago, so this passes only if it goes.
    await expect(banner).toHaveCount(0);
  } finally {
    await context.close();
  }
});

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
import { routesPom } from '@e2e/pom/routes';
import { randomId } from '@e2e/utils/common';
import { env } from '@e2e/utils/env';
import { e2eReq, listEvery } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { putRouteReq } from '@/apis/routes';
import { API_ROUTES, API_UPSTREAMS, PAGE_SIZE_MAX } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

// The list endpoint injects the dashboard's own __team_id into every row — an
// empty string when the route belongs to no team — so any route round-tripped
// back to the Admin API reproduces this, not only team-assigned ones.
const ROUTE_ID = randomId('dup-route');
const ROUTE_NAME = `${ROUTE_ID}-original`;
const LIST_URL = `${env.E2E_TARGET_URL.replace(/\/$/, '')}/routes`;

const route: APISIXType['Route'] = {
  id: ROUTE_ID,
  name: ROUTE_NAME,
  uri: `/${ROUTE_ID}`,
  methods: ['GET'],
  upstream: {
    nodes: [{ host: '127.0.0.1', port: 80, weight: 100 }],
  },
};

// The gateway carries other routes and the list defaults to 10 per page, so ask
// for a page large enough that the seeded route is always on it.
const gotoRoutesList = async (page: Page) => {
  await page.goto(`${LIST_URL}?page_size=${PAGE_SIZE_MAX}`);
  await routesPom.isIndexPage(page);
};

const openMoreMenu = async (page: Page, name: string) => {
  await routesPom.rowByName(page, name).getByRole('button', { name: 'More' }).click();
};

test.beforeEach(async () => {
  await putRouteReq(e2eReq, route);
});

test.afterEach(async () => {
  // The duplicate gets a server-assigned id, so clean up by name.
  const rows = await listEvery<APISIXType['Route']>(API_ROUTES);
  await Promise.all(
    rows
      .filter((item) => item.value.name?.startsWith(ROUTE_ID))
      .map((item) => e2eReq.delete(`${API_ROUTES}/${item.value.id}`))
  );
});

test('duplicates a route whole, offline, without leaking dashboard fields', async ({
  page,
}) => {
  await gotoRoutesList(page);

  await openMoreMenu(page, ROUTE_NAME);
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();

  // The quick-create dialog, on the route it copies.
  const dialog = page.getByRole('dialog', { name: `Duplicate “${ROUTE_NAME}”` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(`${ROUTE_NAME} (copy)`);
  await expect(dialog.getByRole('textbox', { name: 'Path' })).toHaveValue(route.uri!);
  await dialog.getByRole('button', { name: 'Create offline' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/additional properties forbidden/)).toHaveCount(0);

  const copy = (await listEvery<APISIXType['Route']>(API_ROUTES))
    .map((item) => item.value)
    .find((item) => item.name === `${ROUTE_NAME} (copy)`);
  expect(copy).toBeDefined();
  expect(copy!.id).not.toBe(ROUTE_ID);
  // Offline: it answers on the original's path, and takes no traffic yet.
  expect(copy!.status).toBe(0);
  expect(copy!.upstream?.nodes).toEqual(route.upstream?.nodes);
});

test('duplicates a route onto another upstream, keeping the rest', async ({ page }) => {
  const upstreamId = `${ROUTE_ID}-other`;
  await e2eReq.put(`${API_UPSTREAMS}/${upstreamId}`, {
    name: upstreamId,
    type: 'roundrobin',
    nodes: { '127.0.0.1:1980': 1 },
  });
  await putRouteReq(e2eReq, { ...route, priority: 7, vars: [['http_x_env', '==', 'beta']] });

  try {
    await gotoRoutesList(page);
    await openMoreMenu(page, ROUTE_NAME);
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    const dialog = page.getByRole('dialog', { name: `Duplicate “${ROUTE_NAME}”` });
    await dialog.locator('label').filter({ hasText: /^Existing upstream$/ }).click();
    await dialog.getByRole('textbox', { name: 'Existing upstream' }).click();
    await page.getByRole('option', { name: upstreamId }).click();
    await dialog.getByRole('button', { name: 'Create offline' }).click();
    await expect(dialog).toBeHidden();

    const copy = (await listEvery<APISIXType['Route']>(API_ROUTES))
      .map((item) => item.value)
      .find((item) => item.name === `${ROUTE_NAME} (copy)`);
    expect(copy).toMatchObject({
      uri: route.uri,
      methods: route.methods,
      priority: 7,
      vars: [['http_x_env', '==', 'beta']],
      status: 0,
      upstream_id: upstreamId,
    });
    expect(copy!.upstream).toBeUndefined();
  } finally {
    await e2eReq.delete(`${API_UPSTREAMS}/${upstreamId}`).catch(() => null);
  }
});

// Every write path that echoes back a resource it just read hits this — the
// Duplicate action above, and the raw-JSON drawer, whose Save is gated behind a
// Monaco editor that is not worth driving from a test. Asserting at the API
// level covers them both and pins down the premise: the list really does hand
// out __team_id.
test('accepts a write body still carrying the dashboard fields it handed out', async () => {
  const listed = await listEvery<APISIXType['Route']>(API_ROUTES);
  const row = listed.find((item) => item.value.name === ROUTE_NAME);
  expect(row).toBeDefined();

  const value = row!.value as unknown as Record<string, unknown>;
  expect(value).toHaveProperty('__team_id');

  // Write it back exactly as read, minus only the server-managed fields the UI
  // already strips. This is what "Duplicate" and "Save JSON" both send.
  const body = { ...value };
  delete body.id;
  delete body.create_time;
  delete body.update_time;

  const res = await e2eReq.put(`${API_ROUTES}/${row!.value.id}`, body);
  expect(res.status).toBe(200);
});

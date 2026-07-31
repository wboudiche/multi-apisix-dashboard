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
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { getRouteListReq, putRouteReq } from '@/apis/routes';
import { API_ROUTES, PAGE_SIZE_MAX } from '@/config/constant';
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
  const res = await getRouteListReq(e2eReq, { page: 1, page_size: PAGE_SIZE_MAX });
  await Promise.all(
    res.list
      .filter((item) => item.value.name?.startsWith(ROUTE_ID))
      .map((item) => e2eReq.delete(`${API_ROUTES}/${item.value.id}`))
  );
});

test('duplicates a route without leaking dashboard fields to the Admin API', async ({
  page,
}) => {
  await gotoRoutesList(page);

  await openMoreMenu(page, ROUTE_NAME);
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();

  // Success navigates to the copy's detail page. The bug surfaced instead as a
  // toast reading "additional properties forbidden, found __team_id".
  await routesPom.isDetailPage(page);
  await expect(page.getByText(/additional properties forbidden/)).toHaveCount(0);
  await expect(page).toHaveURL((url) => !url.pathname.endsWith(`/detail/${ROUTE_ID}`));
});

// Every write path that echoes back a resource it just read hits this — the
// Duplicate action above, and the raw-JSON drawer, whose Save is gated behind a
// Monaco editor that is not worth driving from a test. Asserting at the API
// level covers them both and pins down the premise: the list really does hand
// out __team_id.
test('accepts a write body still carrying the dashboard fields it handed out', async () => {
  const listed = await getRouteListReq(e2eReq, { page: 1, page_size: PAGE_SIZE_MAX });
  const row = listed.list.find((item) => item.value.name === ROUTE_NAME);
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

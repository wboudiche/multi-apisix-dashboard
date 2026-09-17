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

import { API_ROUTES, PAGE_SIZE_MAX } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * Offline takes a route offline.
 *
 * It used to delete it, beside a Delete in the More menu that did the same:
 * two ways to the same irreversible thing, one of them named after something
 * else entirely (#164). A route carries a status the list already shows.
 */
const ROUTE_ID = randomId('e2e-publish-toggle');

test.beforeEach(async () => {
  await e2eReq.put(`${API_ROUTES}/${ROUTE_ID}`, {
    name: ROUTE_ID,
    uri: `/${ROUTE_ID}`,
    status: 1,
    upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
  });
});

test.afterEach(async () => {
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_ID}`).catch(() => null);
});

const statusOf = async () => {
  const res = await e2eReq.get<unknown, { data: { value: APISIXType['Route'] } }>(
    `${API_ROUTES}/${ROUTE_ID}`
  );
  return res.data.value.status;
};

const row = (page: Page) => routesPom.rowByName(page, ROUTE_ID);

// The gateway carries other routes and the list defaults to ten per page, so
// ask for a page large enough that the seeded route is always on it.
const openList = async (page: Page) => {
  await page.goto(`${env.E2E_TARGET_URL.replace(/\/$/, '')}/routes?page=1&page_size=${PAGE_SIZE_MAX}`);
  await routesPom.isIndexPage(page);
  await expect(row(page)).toHaveCount(1, { timeout: 20000 });
};

test('Offline takes the route offline, and Publish brings it back', async ({ page }) => {
  await openList(page);
  await expect(row(page)).toContainText('Published');

  await row(page).getByRole('button', { name: 'Offline', exact: true }).click();

  await expect(row(page)).toContainText('Unpublished');
  expect(await statusOf()).toBe(0);

  await row(page).getByRole('button', { name: 'Publish', exact: true }).click();

  await expect(row(page)).toContainText('Published');
  expect(await statusOf()).toBe(1);
});

test('Delete is the one that removes it, and says so', async ({ page }) => {
  await openList(page);

  await row(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

  await expect(row(page)).toHaveCount(0);
  // Gone from the gateway too, not merely from the page.
  await expect(e2eReq.get(`${API_ROUTES}/${ROUTE_ID}`)).rejects.toThrow();
});

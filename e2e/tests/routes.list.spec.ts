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
import { env } from '@e2e/utils/env';
import { setupPaginationTests } from '@e2e/utils/pagination-test-helper';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { putRouteReq } from '@/apis/routes';
import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

test('should navigate to routes page', async ({ page }) => {
  await test.step('navigate to routes page', async () => {
    await routesPom.getRouteNavBtn(page).click();
    await routesPom.isIndexPage(page);
  });

  await test.step('verify routes page components', async () => {
    await expect(routesPom.getAddRouteBtn(page)).toBeVisible();

    // list table exists (redesigned columns: Name / Path / Status / Operation)
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByText('Name', { exact: true })).toBeVisible();
    await expect(table.getByText('Path', { exact: true })).toBeVisible();
    await expect(table.getByText('Status', { exact: true })).toBeVisible();
    await expect(table.getByText('Operation', { exact: true })).toBeVisible();
  });
});

// Shared by the fixtures, the scoping filter and the cell matcher below, so
// they cannot drift apart.
const FIXTURE_PREFIX = 'route_name_';

const routes: APISIXType['Route'][] = Array.from({ length: 11 }, (_, i) => ({
  id: `route_id_${i + 1}`,
  name: `${FIXTURE_PREFIX}${i + 1}`,
  uri: `/test_route_${i + 1}`,
  desc: `Description for route ${i + 1}`,
  methods: ['GET'],
  upstream: {
    nodes: [
      {
        host: `node_${i + 1}`,
        port: 80,
        weight: 100,
      },
    ],
  },
}));

test.describe('page and page_size should work correctly', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await Promise.all(routes.map((d) => putRouteReq(e2eReq, d)));
  });

  test.afterAll(async () => {
    await Promise.all(
      routes.map((d) => e2eReq.delete(`${API_ROUTES}/${d.id}`))
    );
  });

  // Setup pagination tests with route-specific configurations
  const filterItemsNotInPage = async (page: Page) => {
    // filter the item which not in the current page
    // it should be random, so we need get all items in the table
    const itemsInPage = await page
      .getByRole('cell', { name: /route_name_/ })
      .all();
    const names = await Promise.all(itemsInPage.map((v) => v.textContent()));
    return routes.filter((d) => !names.includes(d.name));
  };

  setupPaginationTests(test, {
    // Scoped to this spec's own fixtures rather than the whole gateway. The
    // pagination assertions need a known total, which used to be arranged by
    // deleting every route first — taking any real data with it. Filtering by
    // the fixture name prefix gives the same determinism without touching
    // anything else, and the filter survives page changes because setParams
    // merges into the existing search params.
    pom: {
      ...routesPom,
      toIndex: (page: Page) =>
        page.goto(`${env.E2E_TARGET_URL}routes?name=${FIXTURE_PREFIX}`),
    },
    items: routes,
    filterItemsNotInPage,
    getCell: (page, item) =>
      page.getByRole('cell', { name: item.name }).first(),
    // The redesigned routes list uses Mantine Pagination without a
    // page-size selector
    variant: 'mantine',
  });
});

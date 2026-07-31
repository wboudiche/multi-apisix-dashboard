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
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { API_ROUTES } from '@/config/constant';

/**
 * APISIX omits `status` when it was never set, and such a route serves traffic
 * exactly as `status: 1` does — probed on the data plane, where a route with no
 * status answers 502 (matched, upstream unreachable) while `status: 0` answers
 * 404 (not matched at all).
 *
 * The table compared `status === 1`, so every route that had never been
 * explicitly published was labelled Unpublished while it was live. It also
 * disagreed with the dashboard's own filter, which counts an absent status as
 * published.
 */

const NO_STATUS = 'e2e-status-absent';
const DISABLED = 'e2e-status-disabled';
const PUBLISHED = 'e2e-status-published';

const seed = async (id: string, status?: number) => {
  await e2eReq.put(`${API_ROUTES}/${id}`, {
    uri: `/${id}`,
    name: id,
    ...(status === undefined ? {} : { status }),
    upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
  });
};

const rowFor = (page: Page, id: string) =>
  page.getByRole('row').filter({ hasText: id });

test.beforeEach(async () => {
  await seed(NO_STATUS);
  await seed(DISABLED, 0);
  await seed(PUBLISHED, 1);
});

test.afterEach(async () => {
  for (const id of [NO_STATUS, DISABLED, PUBLISHED]) {
    await e2eReq.delete(`${API_ROUTES}/${id}`).catch(() => null);
  }
});

test('a route with no explicit status is shown as published', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(rowFor(page, NO_STATUS)).toHaveCount(1, { timeout: 20000 });

  // The route that was never explicitly published is live, and says so.
  await expect(rowFor(page, NO_STATUS)).toContainText('Published');
  await expect(rowFor(page, PUBLISHED)).toContainText('Published');

  // Only an explicit 0 reads as unpublished.
  // Case matters here: the badge reads "Unpublished", and asserting
  // "Published" above would not match it.
  await expect(rowFor(page, DISABLED)).toContainText('Unpublished');
});

test('the label agrees with the Published filter', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(rowFor(page, NO_STATUS)).toHaveCount(1, { timeout: 20000 });

  // The backend counts an absent status as published (matchesStatus). Filtering
  // by Published therefore returns this route — and the table used to label the
  // very row the filter had just selected as UnPublished.
  await page
    .getByPlaceholder('UnPublished/Published')
    .first()
    .click();
  await page.getByRole('option', { name: 'Published', exact: true }).click();
  // The filters are staged locally and only applied on Search.
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(rowFor(page, NO_STATUS)).toHaveCount(1);
  await expect(rowFor(page, NO_STATUS)).toContainText('Published');
  await expect(rowFor(page, DISABLED)).toHaveCount(0);
});

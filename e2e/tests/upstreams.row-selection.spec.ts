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
import { expect } from '@playwright/test';

import { getUpstreamListReq } from '@/apis/upstreams';
import { API_UPSTREAMS, PAGE_SIZE_MAX } from '@/config/constant';

/**
 * These list pages feed ProTable the {key, value} envelopes APISIX returns,
 * but declared rowKey="id" — a field that exists at record.value.id, not on the
 * record. Every row therefore resolved to the same undefined key, so checking
 * one row checked all of them while the counter still said 1.
 *
 * It was not only cosmetic: the ids handed to batch delete were undefined too,
 * so Delete issued requests against /upstreams/undefined and removed nothing.
 *
 * Upstreams stands in for the ten pages sharing this shape; the fix is the same
 * one-line change on each.
 */

const IDS = ['e2e-rowsel-a', 'e2e-rowsel-b', 'e2e-rowsel-c'];

const seed = async () => {
  for (const id of IDS) {
    await e2eReq.put(`${API_UPSTREAMS}/${id}`, {
      name: id,
      type: 'roundrobin',
      nodes: { '127.0.0.1:1980': 1 },
    });
  }
};

const remaining = async (): Promise<string[]> => {
  const res = await getUpstreamListReq(e2eReq, { page: 1, page_size: PAGE_SIZE_MAX });
  return res.list.map((u) => u.value.id).filter((id) => IDS.includes(id));
};

test.beforeEach(seed);

test.afterEach(async () => {
  for (const id of IDS) {
    await e2eReq.delete(`${API_UPSTREAMS}/${id}`).catch(() => null);
  }
});

const rowFor = (page: import('@playwright/test').Page, id: string) =>
  page.getByRole('row').filter({ hasText: id });

test('checking one row selects that row alone', async ({ page }) => {
  await page.goto('/ui/upstreams');
  await expect(rowFor(page, IDS[0])).toHaveCount(1, { timeout: 20000 });

  await rowFor(page, IDS[0]).getByRole('checkbox').check();

  // The one row is checked and the others are not — the mismatch in the report
  // was every box appearing checked while only one was really selected.
  await expect(rowFor(page, IDS[0]).getByRole('checkbox')).toBeChecked();
  await expect(rowFor(page, IDS[1]).getByRole('checkbox')).not.toBeChecked();
  await expect(rowFor(page, IDS[2]).getByRole('checkbox')).not.toBeChecked();
});

test('batch delete removes exactly the rows that were checked', async ({ page }) => {
  await page.goto('/ui/upstreams');
  await expect(rowFor(page, IDS[0])).toHaveCount(1, { timeout: 20000 });

  await rowFor(page, IDS[0]).getByRole('checkbox').check();
  await rowFor(page, IDS[1]).getByRole('checkbox').check();

  await page.getByRole('button', { name: /Delete/ }).first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

  // The two checked rows go and the third stays. Before the fix the request
  // went to /upstreams/undefined and nothing was removed at all.
  await expect
    .poll(remaining, { timeout: 15000 })
    .toEqual([IDS[2]]);
});

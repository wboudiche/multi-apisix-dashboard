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
import { adminPom } from '@e2e/pom/admin';
import { getOverview } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

import { API_ROUTES } from '@/config/constant';

test('gateway health widget shows live instance counts', async ({ page }) => {
  await adminPom.toOverview(page);
  await adminPom.isOverviewPage(page);

  // The RingProgress label renders "<active>/<total>" above "Online".
  const counts = page.getByText(/^\d+\/\d+$/);
  await expect(counts).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();

  const [active, total] = (await counts.textContent())!.split('/').map(Number);
  expect(active).toBeLessThanOrEqual(total);
  // The e2e stack always has the two seeded gateways.
  expect(total).toBeGreaterThanOrEqual(2);

  // Both seeded gateways appear in the connectivity table.
  await expect(adminPom.rowByText(page, 'Local APISIX')).toBeVisible();
  await expect(adminPom.rowByText(page, 'Staging APISIX')).toBeVisible();
});

test('resource matrix reflects a route created via the API', async ({ page }) => {
  const routeName = randomId('adm-overview-probe');
  const created = await e2eReq.post<
    unknown,
    { data: { value: { id: string } } }
  >(API_ROUTES, {
    name: routeName,
    uri: `/${routeName}`,
    upstream: { type: 'roundrobin', nodes: { 'example.com:80': 1 } },
  });

  try {
    // The backend caches overview data for 30s; poll until the refresh
    // has aggregated at least our route.
    await expect
      .poll(async () => (await getOverview()).global_stats.routes, {
        timeout: 45000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(1);

    await adminPom.toOverview(page);
    await adminPom.isOverviewPage(page);
    await expect(page.getByText('Total Routes')).toBeVisible();

    // The stat next to "Total Routes" is a non-zero number.
    const stat = page
      .locator('div')
      .filter({ has: page.getByText('Total Routes') })
      .getByRole('heading', { level: 2 })
      .first();
    await expect(stat).toHaveText(/^\d+$/);
    expect(Number(await stat.textContent())).toBeGreaterThanOrEqual(1);
  } finally {
    await e2eReq.delete(`${API_ROUTES}/${created.data.value.id}`);
  }
});

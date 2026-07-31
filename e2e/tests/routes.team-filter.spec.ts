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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * The list showed a Team column but offered no way to narrow by it, so on an
 * instance with several teams an admin — the only role that sees more than one
 * team's resources — had no way to answer "what does this team own?".
 *
 * Filtering happens in the proxy alongside the other filters, before the page
 * is cut, so the totals stay honest.
 */

const PROXY = '/api/v1/apisix/admin';
const BACKEND_ROUTE = 'e2e-teamfilter-backend';
const FRONTEND_ROUTE = 'e2e-teamfilter-frontend';
const UNOWNED_ROUTE = 'e2e-teamfilter-unowned';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const seed = async (token: string, id: string, teamId?: string) => {
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      uri: `/${id}`,
      name: id,
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
    },
  });
  if (teamId) {
    await apiFetch(`/api/v1/apisix/ownership/routes/${id}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: teamId },
    });
  }
};

const rowFor = (page: Page, id: string) =>
  page.getByRole('row').filter({ hasText: id });

const filterByTeam = async (page: Page, label: string) => {
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByPlaceholder('Any team').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();
};

test.beforeEach(async () => {
  const token = await loginAdmin();
  await seed(token, BACKEND_ROUTE, fx().backendTeamId);
  await seed(token, FRONTEND_ROUTE, fx().frontendTeamId);
  await seed(token, UNOWNED_ROUTE);
});

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const id of [BACKEND_ROUTE, FRONTEND_ROUTE, UNOWNED_ROUTE]) {
    await apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => null);
  }
});

test('narrows the list to a single team', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(rowFor(page, BACKEND_ROUTE)).toHaveCount(1, { timeout: 20000 });

  await filterByTeam(page, 'Backend Team');

  await expect(rowFor(page, BACKEND_ROUTE)).toHaveCount(1);
  await expect(rowFor(page, FRONTEND_ROUTE)).toHaveCount(0);
  await expect(rowFor(page, UNOWNED_ROUTE)).toHaveCount(0);
});

test('finds the resources that belong to no team', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(rowFor(page, UNOWNED_ROUTE)).toHaveCount(1, { timeout: 20000 });

  // Unowned resources are invisible to every non-admin, so an admin is the
  // only one who can go looking for them — and had no way to before.
  await filterByTeam(page, 'Unassigned');

  await expect(rowFor(page, UNOWNED_ROUTE)).toHaveCount(1);
  await expect(rowFor(page, BACKEND_ROUTE)).toHaveCount(0);
  await expect(rowFor(page, FRONTEND_ROUTE)).toHaveCount(0);
});

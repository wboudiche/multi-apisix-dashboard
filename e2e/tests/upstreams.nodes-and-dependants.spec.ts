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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The upstreams list said nothing about how many nodes an upstream has, nor
 * about what would break if it were drained or deleted (#144). The node count
 * is in the upstream itself; what depends on it is not, and cannot be counted
 * in the browser - that list is narrowed to the reader's team, so a developer
 * would read "nothing uses this" about an upstream another team's routes run
 * through. The proxy counts it, as it does for services (#277).
 */

const PROXY = '/api/v1/apisix/admin';
const suffix = Math.random().toString(36).slice(2, 8);
const upstreamId = `e2e-144-up-${suffix}`;
const serviceId = `e2e-144-svc-${suffix}`;
const ownRouteName = `e2e-144-own-${suffix}`;
const otherRouteName = `e2e-144-other-${suffix}`;

// loginAs and switchInstance reload the page more than once.
const TIMEOUT_MS = 90_000;

const onTeam = (teamId: string) => ({
  'X-Instance-ID': getFixtures().localInstanceId,
  'X-Team-ID': teamId,
});

test.beforeAll(async () => {
  const fx = getFixtures();
  const token = await loginAdmin();

  // Two nodes, so the count is not one the page could have guessed.
  await apiFetch(`${PROXY}/upstreams/${upstreamId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: {
      name: upstreamId,
      type: 'roundrobin',
      nodes: { '127.0.0.1:1980': 1, '127.0.0.1:1981': 1 },
    },
  });
  // A service pointing at it: a dependant of its own, and one that stands for
  // every route bound to that service.
  await apiFetch(`${PROXY}/services/${serviceId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: { name: serviceId, upstream_id: upstreamId },
  });
  // One route of the developer's team...
  await apiFetch(`${PROXY}/routes/${ownRouteName}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: { name: ownRouteName, uri: `/${ownRouteName}`, upstream_id: upstreamId },
  });
  // ...and one of another's, which they cannot read and must still be counted.
  await apiFetch(`${PROXY}/routes/${otherRouteName}`, token, {
    method: 'PUT',
    headers: onTeam(fx.viewersTeamId),
    json: { name: otherRouteName, uri: `/${otherRouteName}`, upstream_id: upstreamId },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  const headers = { 'X-Instance-ID': getFixtures().localInstanceId };
  for (const path of [
    `routes/${ownRouteName}`,
    `routes/${otherRouteName}`,
    `services/${serviceId}`,
    `upstreams/${upstreamId}`,
  ]) {
    await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers }).catch(
      () => undefined
    );
  }
});

test('says how many nodes an upstream has and what leans on it', async ({ page }) => {
  await page.goto(`/ui/upstreams?name=${upstreamId}`);

  const row = page.getByRole('row').filter({ hasText: upstreamId });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  await expect(row.getByTestId('upstream-node-count')).toHaveText('2');
  await expect(row.getByTestId('upstream-route-count')).toHaveText('Routes: 2');
  // The service is counted apart: it is one dependant, and it stands for every
  // route bound to it.
  await expect(row.getByText('Services: 1')).toBeVisible();
});

test('counts the routes of other teams, without showing them', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  // A context of its own: the worker's stored session belongs to the admin.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
    await permission.switchInstance(page, 'Local APISIX');

    // The route list this account can read holds one of the two...
    await page.goto('/ui/routes?name=e2e-144-');
    await expect(page.getByRole('row').filter({ hasText: ownRouteName })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.getByRole('row').filter({ hasText: otherRouteName })).toHaveCount(0);

    // ...and the upstream still says two, because draining it would break both.
    await page.goto(`/ui/upstreams?name=${upstreamId}`);
    const row = page.getByRole('row').filter({ hasText: upstreamId });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await expect(row.getByTestId('upstream-route-count')).toHaveText('Routes: 2');
  } finally {
    await context.close();
  }
});

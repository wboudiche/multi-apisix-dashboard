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
import { expect, test } from '@playwright/test';

/**
 * The Upstream column and the upstream filter used to answer from two places.
 * The filter resolved a route's service in the proxy, reading every service;
 * the column resolved it in the browser, from a service list narrowed to the
 * operator's team. A developer whose route is bound to another team's service
 * found it among an upstream filter's results while its own cell said it had
 * no upstream (#161).
 */

const PROXY = '/api/v1/apisix/admin';
const suffix = Math.random().toString(36).slice(2, 8);
const upstreamId = `e2e-161-up-${suffix}`;
const serviceId = `e2e-161-svc-${suffix}`;
const routeName = `e2e-161-route-${suffix}`;

// loginAs and switchInstance reload the page more than once.
const TIMEOUT_MS = 90_000;

const onTeam = (teamId: string) => ({
  'X-Instance-ID': getFixtures().localInstanceId,
  'X-Team-ID': teamId,
});

test.beforeAll(async () => {
  const fx = getFixtures();
  const token = await loginAdmin();
  // The upstream and the service belong to a team the developer is not in...
  await apiFetch(`${PROXY}/upstreams/${upstreamId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.viewersTeamId),
    json: { name: upstreamId, type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
  });
  await apiFetch(`${PROXY}/services/${serviceId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.viewersTeamId),
    json: { name: serviceId, upstream_id: upstreamId },
  });
  // ...and the route to the developer's own, bound to that service.
  await apiFetch(`${PROXY}/routes/${routeName}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: { name: routeName, uri: `/${routeName}`, service_id: serviceId },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  const headers = { 'X-Instance-ID': getFixtures().localInstanceId };
  for (const path of [`routes/${routeName}`, `services/${serviceId}`, `upstreams/${upstreamId}`]) {
    await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers }).catch(
      () => undefined
    );
  }
});

test("a route bound to another team's service shows the upstream it reaches", async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  // A context of its own: the worker's stored session belongs to the admin.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await permission.loginAs(page, fx.users.dev.username, fx.users.dev.password);
    await permission.switchInstance(page, 'Local APISIX');
    await page.goto(`/ui/routes?name=${routeName}`);

    const row = page.getByRole('row').filter({ hasText: routeName });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    // The developer may not read that upstream, so its name is out of reach
    // and the cell names it by id — but it names it.
    await expect(row.getByRole('link', { name: upstreamId })).toBeVisible();
  } finally {
    await context.close();
  }
});

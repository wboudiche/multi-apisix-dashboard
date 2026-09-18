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
 * How many routes depend on a service is the number that decides whether
 * deleting it is safe, so it has to be counted where the whole list is: the
 * proxy. Counted in the browser it would be counted from a list the proxy has
 * already narrowed to the reader's team, and a developer would read "nothing
 * depends on this" about a service another team's routes run through — the one
 * wrong answer that gets a service deleted (#277, after #161).
 */

const PROXY = '/api/v1/apisix/admin';
const suffix = Math.random().toString(36).slice(2, 8);
const serviceId = `e2e-277-svc-${suffix}`;
const ownRouteName = `e2e-277-own-${suffix}`;
const otherRouteName = `e2e-277-other-${suffix}`;
const streamRouteId = `e2e-277-stream-${suffix}`;

// loginAs and switchInstance reload the page more than once.
const TIMEOUT_MS = 90_000;

const onTeam = (teamId: string) => ({
  'X-Instance-ID': getFixtures().localInstanceId,
  'X-Team-ID': teamId,
});

test.beforeAll(async () => {
  const fx = getFixtures();
  const token = await loginAdmin();

  // The service belongs to the developer's team, so they can see it at all...
  await apiFetch(`${PROXY}/services/${serviceId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: {
      name: serviceId,
      upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
    },
  });
  // ...one route of their own...
  await apiFetch(`${PROXY}/routes/${ownRouteName}`, token, {
    method: 'PUT',
    headers: onTeam(fx.backendTeamId),
    json: { name: ownRouteName, uri: `/${ownRouteName}`, service_id: serviceId },
  });
  // ...and one that is not, which they cannot read and must still be counted.
  await apiFetch(`${PROXY}/routes/${otherRouteName}`, token, {
    method: 'PUT',
    headers: onTeam(fx.viewersTeamId),
    json: { name: otherRouteName, uri: `/${otherRouteName}`, service_id: serviceId },
  });
  // A stream route keeps a service alive just as an HTTP one does, and the
  // detail page lists them under a tab of their own.
  await apiFetch(`${PROXY}/stream_routes/${streamRouteId}`, token, {
    method: 'PUT',
    headers: onTeam(fx.viewersTeamId),
    json: { server_port: 9100, service_id: serviceId },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  const headers = { 'X-Instance-ID': getFixtures().localInstanceId };
  for (const path of [
    `stream_routes/${streamRouteId}`,
    `routes/${ownRouteName}`,
    `routes/${otherRouteName}`,
    `services/${serviceId}`,
  ]) {
    await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers }).catch(
      () => undefined
    );
  }
});

test('the services table counts every route on the gateway, not the readable ones', async ({
  page,
}) => {
  await page.goto(`/ui/services?name=${serviceId}`);

  const row = page.getByRole('row').filter({ hasText: serviceId });
  await expect(row).toHaveCount(1, { timeout: 30000 });
  // Two HTTP routes, counted apart from the stream route: the service's own
  // page lists the two kinds under separate tabs, so one total would match
  // neither of them. Read from the Routes cell by test id rather than by its
  // text: any cell holding "2" would satisfy a plain text match.
  await expect(row.getByTestId('service-route-count')).toHaveText('2');
  await expect(row.getByText('Stream routes: 1')).toBeVisible();
});

test('the cards say the same number as the table', async ({ page }) => {
  await page.goto(`/ui/services?name=${serviceId}&view=cards`);

  const card = page.getByText(serviceId, { exact: true }).locator('..');
  // The first render of a cold page: the same budget the table test gives it.
  await expect(card.getByText('Routes: 2')).toBeVisible({ timeout: 30000 });
  await expect(card.getByText('Stream routes: 1')).toBeVisible();
});

test('a developer sees the routes of other teams in the count, without seeing the routes', async ({
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

    // The route list is the developer's own: the other team's route is not in
    // it, which is what a count taken from this page would have been built on.
    await page.goto('/ui/routes?name=e2e-277-');
    await expect(page.getByRole('row').filter({ hasText: ownRouteName })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.getByRole('row').filter({ hasText: otherRouteName })).toHaveCount(0);

    // The service list still says two, because the second route is there
    // whether or not this account may read it - and deleting the service
    // would break it just the same.
    await page.goto(`/ui/services?name=${serviceId}`);
    const row = page.getByRole('row').filter({ hasText: serviceId });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await expect(row.getByTestId('service-route-count')).toHaveText('2');
  } finally {
    await context.close();
  }
});

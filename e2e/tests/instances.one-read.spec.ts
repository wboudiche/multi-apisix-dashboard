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
import { adminToken, deleteInstancesByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

const PREFIX = randomId('one-read');
// The same env var global-setup reads, composed the same way as
// instances.admin.spec: hardcoding it would silently decouple this spec from
// the gateway the fixtures actually registered.
const STAGING_APISIX_URL =
  process.env['E2E_STAGING_APISIX_URL'] ?? 'http://127.0.0.1:9181';
const STAGING_ADMIN_KEY = process.env['E2E_STAGING_ADMIN_KEY'] ?? 'edd1c9f034335f136f87ad84b625c8f1';

test.afterAll(async () => {
  // Through the UI is how this spec removes it, but only on the happy path -
  // and an instance left behind changes the list every other spec reads.
  await deleteInstancesByPrefix(PREFIX);
});

/**
 * /api/v1/instances was read twice on every page load - InstanceGuard had its
 * own query, the header an effect of its own - and a third time on the
 * instances page. Two round trips, three notions of the same list, and three
 * places a fix had to land. It also produced a dead end: the guard's "Try
 * again" could not re-drive the header's effect, so it reloaded the page
 * instead (#165).
 */

test('is read once for a page that guards on it and shows it in the header', async ({
  page,
}) => {
  const reads: string[] = [];
  await page.route('**/api/v1/instances', (route) => {
    reads.push(route.request().method());
    return route.fallback();
  });

  // The fixture has already loaded a page, and its own read of the list must
  // not be counted against this one.
  await page.goto('/ui/routes');
  reads.length = 0;
  await page.reload();
  // The guarded page has rendered, so both readers have had what they needed.
  await expect(page.getByRole('heading', { name: 'Routes' })).toBeVisible({
    timeout: 20000,
  });
  // The header has its list too - the selector is filled from it.
  await expect(page.locator('header input[placeholder="Select instance"]')).toBeVisible();

  expect(reads).toEqual(['GET']);
});

test('and once more for the page that used to read it a third time', async ({ page }) => {
  // The instances page had a loader of its own, writing the same atom the
  // header wrote. It reads the shared query now, so landing on it costs one
  // request for the page, the header and the guard together.
  const reads: string[] = [];
  await page.route('**/api/v1/instances', (route) => {
    reads.push(route.request().method());
    return route.fallback();
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  reads.length = 0;
  await page.reload();
  await adminPom.isInstancesPage(page);
  await expect(page.locator('header input[placeholder="Select instance"]')).toBeVisible();

  expect(reads).toEqual(['GET']);
});

test('reports a refetch that fails, instead of running on quietly', async ({ page }) => {
  // react-query keeps the last good list when a refetch fails, deliberately -
  // a one-second blip should not replace a working dashboard. The cost used to
  // be that nothing said so: the header's report came from its own effect,
  // which never ran again. It reads the query's error now, whatever triggered
  // it (#165).
  const name = `${PREFIX}-refetch`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: `${STAGING_APISIX_URL}/apisix/admin`,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  await expect(adminPom.rowByText(page, name)).toBeVisible();

  // Break the list, then make the page re-read it: deleting an instance
  // refetches, which is a refetch with a working dashboard behind it.
  await page.route('**/api/v1/instances', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>index</body></html>',
    })
  );
  await adminPom.rowByText(page, name).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`Delete instance "${name}"?`)).toBeVisible();
  await page.getByRole('button', { name: 'Delete anyway' }).click();

  await expect(
    page
      .locator('.mantine-Notification-root')
      .filter({ hasText: 'Instances unavailable' })
  ).toBeVisible({ timeout: 20000 });
  // And the dashboard is still the one it was. The row for the instance just
  // deleted is even still on screen: that is the last good list being kept
  // rather than replaced by a failure - deliberate, and the reason the report
  // above has to exist.
  await expect(page.getByRole('heading', { name: 'Instances' })).toBeVisible();
  await expect(adminPom.rowByText(page, name)).toBeVisible();
});

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
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * The header polls instance health on a 30s timer. The poll used to be a
 * useEffect that called its fetcher synchronously on mount, which set state
 * during the effect and cascaded a render on every change to the instance
 * list; the loader beside it swallowed its own failure into console.error.
 *
 * These pin the behaviour that has to survive moving the poll onto the shared
 * data layer: it runs on load, it runs again on the timer without a reload,
 * what comes back is keyed by instance id, and a failure is now something the
 * operator can see.
 */

const HEALTH = '**/api/v1/instances/health';
const POLL_INTERVAL_MS = 30_000;

// The dot is decorative — no role, no accessible name — so it is addressed by
// the one thing that makes it a dot. Scoped to the header so the instances
// page, which draws its own connectivity column, cannot match first.
const healthDot = (page: Page) =>
  page.locator('header [style*="border-radius: 50%"]').first();

test('polls instance health on load', async ({ page }) => {
  let polls = 0;
  await page.route(HEALTH, (route) => {
    polls += 1;
    return route.continue();
  });

  await page.goto('/ui/routes');
  await expect(healthDot(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(() => polls, { timeout: 20000 }).toBeGreaterThan(0);
});

test('polls again on the timer without a page reload', async ({ page }) => {
  await page.clock.install();

  let polls = 0;
  await page.route(HEALTH, (route) => {
    polls += 1;
    return route.continue();
  });

  await page.goto('/ui/routes');
  await expect(healthDot(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(() => polls, { timeout: 20000 }).toBeGreaterThan(0);

  const afterLoad = polls;
  await page.clock.runFor(POLL_INTERVAL_MS + 1000);
  await expect.poll(() => polls, { timeout: 20000 }).toBeGreaterThan(afterLoad);
});

test('reads the status of the selected instance out of the response', async ({
  page,
}) => {
  const fx = getFixtures();

  // Only the selected instance is marked down. A response keyed by anything
  // other than instance_id would leave the dot on "Checking…" instead.
  await page.route(HEALTH, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          instance_id: fx.localInstanceId,
          name: 'Local APISIX',
          status: 'Disconnected',
          last_check: new Date().toISOString(),
          error: 'probe refused',
        },
        {
          instance_id: fx.stagingInstanceId,
          name: 'Staging APISIX',
          status: 'Connected',
          last_check: new Date().toISOString(),
        },
      ]),
    })
  );

  await page.goto('/ui/routes');
  await healthDot(page).hover();
  await expect(page.getByText('Disconnected: probe refused')).toBeVisible({
    timeout: 20000,
  });
});

test('loads the instance list once rather than on every render', async ({
  page,
}) => {
  // The loader writes the instance list into a jotai atom, so anything
  // unstable in its dependency array re-runs it on the render it just caused.
  // Its own effect cannot be the thing that keeps waking it.
  let loads = 0;
  await page.route('**/api/v1/instances', (route) => {
    loads += 1;
    return route.continue();
  });

  await page.goto('/ui/routes');
  await expect(healthDot(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(() => loads, { timeout: 20000 }).toBeGreaterThan(0);

  // A couple of runs are expected: the effect also keys on the instance id it
  // auto-selects. A loop would be running far past this by now.
  /* eslint-disable-next-line playwright/no-wait-for-timeout --
     Asserting that a request stops repeating has no state to wait for. */
  await page.waitForTimeout(3000);
  expect(loads).toBeLessThanOrEqual(4);
});

test('says so when the instance list cannot be loaded', async ({ page }) => {
  // The loader logged this to the console and carried on, so an operator saw a
  // header with no instance selector and no reason given for it.
  await page.route('**/api/v1/instances', (route) =>
    route.fulfill({ status: 500, body: '{}' })
  );

  await page.goto('/ui/routes');
  await expect(
    page.getByText('Could not load the instance list.')
  ).toBeVisible({ timeout: 20000 });
});

test('stays quiet when the account may not list teams', async ({ page }) => {
  // /api/v1/teams is admin-only and answers 403 to a developer, which is the
  // ordinary case rather than a fault: they get no team switcher and that is
  // all. Reporting it would put a red toast on every page of every non-admin
  // session — and blame the instance list, which loaded perfectly well.
  await page.route('**/api/v1/teams', (route) =>
    route.fulfill({ status: 403, body: '{"error":"Forbidden"}' })
  );

  await page.goto('/ui/routes');
  await expect(healthDot(page)).toBeVisible({ timeout: 20000 });

  // Sampled rather than read once: notifications auto-close, so a single check
  // can miss one and pass for the wrong reason.
  /* eslint-disable playwright/no-wait-for-timeout --
     Asserting that something never appears has no state to wait for. */
  let peak = 0;
  for (let i = 0; i < 8; i++) {
    peak = Math.max(peak, await page.locator('.mantine-Notification-root').count());
    await page.waitForTimeout(250);
  }
  /* eslint-enable playwright/no-wait-for-timeout */
  expect(peak).toBe(0);
});

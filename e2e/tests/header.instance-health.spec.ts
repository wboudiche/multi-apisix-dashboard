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
import { deleteInstancesByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { env } from '@e2e/utils/env';
import { getFixtures } from '@e2e/utils/fixtures';
import { test } from '@e2e/utils/test';
import { expect, type Page, test as base } from '@playwright/test';

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

// Real second APISIX from e2e/server/docker-compose.yml; key from apisix_conf_2.yml.
const STAGING_ADMIN_URL =
  process.env['E2E_STAGING_APISIX_URL'] ?? 'http://127.0.0.1:9181';
const STAGING_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';
// HealthDot's colour for an instance absent from the map — its "Checking…" state.
const UNKNOWN_DOT_COLOUR = 'rgb(107, 114, 128)';

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

test('says why the instance list could not be loaded', async ({ page }) => {
  // The loader logged this to the console and carried on, so an operator saw a
  // header with no instance selector and no reason given for it. Every instance
  // handler answers {"error": "<reason>"}, and collapsing a 403, a binding error
  // and an etcd outage into one generic line throws away the only thing that
  // says what to do next — so the reason is shown, not a fixed string.
  await page.route('**/api/v1/instances', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'etcd is unreachable' }),
    })
  );

  await page.goto('/ui/routes');
  await expect(page.getByText('etcd is unreachable')).toBeVisible({
    timeout: 20000,
  });
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

// The health endpoint opens a live connection to every gateway the caller may
// see, so each extra sweep costs real time on the backend. These pin when it is
// allowed to run — and, just as much, when it is not.

test('gives a newly added gateway a health dot without waiting for the timer', async ({
  page,
}) => {
  // The list is shared state: the instances page writes the same atom the
  // header reads. Counting probes would prove nothing here — that page runs a
  // health sweep of its own (routes/instances/index.tsx:271) against the same
  // URL — so this reads the header's own dot for the new gateway instead.
  const prefix = randomId('hdr-health');
  const name = `${prefix}-added`;

  try {
    await adminPom.toInstances(page);
    await adminPom.isInstancesPage(page);

    await page.getByRole('button', { name: 'Add Instance' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Admin API URL').fill(STAGING_ADMIN_URL);
    await page.getByLabel('Admin Key').fill(STAGING_ADMIN_KEY);
    await page.getByRole('button', { name: 'Create Instance' }).click();
    // The fixture already registered this gateway; sharing one is allowed once
    // confirmed.
    await page.getByRole('button', { name: 'Save anyway' }).click();
    await expect(adminPom.rowByText(page, name)).toBeVisible({ timeout: 20000 });

    // The header selector now lists it. Its dot must resolve rather than rest
    // on the grey "Checking…" it shows for an instance absent from the map.
    await page.locator('header input[placeholder="Select instance"]').click();
    const dot = page
      .getByRole('option', { name })
      .locator('[style*="border-radius: 50%"]');
    await expect(dot).toBeVisible({ timeout: 10000 });

    // Well inside the 30s poll, so a pass cannot be the timer coming round.
    await expect
      .poll(
        () => dot.evaluate((el) => getComputedStyle(el).backgroundColor),
        { timeout: 12000 }
      )
      .not.toBe(UNKNOWN_DOT_COLOUR);
  } finally {
    await deleteInstancesByPrefix(prefix);
  }
});

test('reports a malformed instance list instead of throwing past its own catch', async ({
  page,
}) => {
  // A misrouted proxy answers 200 with the SPA's own HTML. axios resolves, so
  // this arrives as success carrying a string where a list belongs — the one
  // shape that gets past a try wrapped around the request alone, throwing on
  // `data.some` afterwards as an unhandled rejection with nothing shown.
  await page.route('**/api/v1/instances', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '"<!doctype html><html></html>"',
    })
  );

  await page.goto('/ui/routes');

  await expect(
    page.getByText('Could not load the instance list.')
  ).toBeVisible({ timeout: 20000 });

  // Scoped to what this loader owns. The app as a whole still falls over on
  // this input, from InstanceGuard's own independent read of the same endpoint
  // (src/components/page/InstanceGuard.tsx:114) — tracked in #153.
});

base('logging out does not probe health without a token', async ({ browser }) => {
  // Own context: this signs out, which would poison the worker-scoped session.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  const unauthenticated: string[] = [];
  await page.route(HEALTH, (route) => {
    const auth = route.request().headers()['authorization'];
    if (!auth) unauthenticated.push(route.request().url());
    return route.continue();
  });

  try {
    await page.goto(env.E2E_TARGET_URL);
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10000 });
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await expect(healthDot(page)).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'admin' }).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    // Clearing the user must stop the poll, not re-key it and fire it anonymously:
    // the 401 that comes back has no refresh token left to use, and the
    // interceptor answers it by leaving the SPA entirely.
    await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 15000 });
    /* eslint-disable-next-line playwright/no-wait-for-timeout --
       The probe races the redirect; the point is that it never starts. */
    await page.waitForTimeout(2000);

    expect(unauthenticated).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/ui/login');
  } finally {
    await context.close();
  }
});

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
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * Resource pages read through `req`, which had no notion of the session at
 * all: it answered a 401 with `Promise.resolve({ data: {} })`, so an expired
 * session on /ui/routes showed a toast that auto-closed and then an empty
 * table — indistinguishable from a gateway with no routes (#168).
 *
 * The fix cannot be "redirect on 401". The proxy relays APISIX's status
 * verbatim (handlers/proxy.go), so a 401 here equally means the instance's
 * admin key is wrong — and signing someone out for a misconfigured gateway
 * would be a worse bug than the one being fixed. The dashboard's own
 * rejections carry `code: session_invalid`; a gateway's do not.
 */

const ROUTES = '**/apisix/admin/routes*';

// What the dashboard's auth middleware answers (middleware/auth.go).
const sessionExpired = JSON.stringify({
  error: 'Token expired',
  code: 'session_invalid',
});

// What APISIX answers for a bad admin key, relayed untouched by the proxy.
const badAdminKey = JSON.stringify({
  description: 'wrong apikey',
  error_msg: 'failed to check token',
});

/** Fail the first call to `glob` only, then let the rest through. */
const failOnce = async (page: Page, glob: string, body: string) => {
  let failed = false;
  await page.route(glob, (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body,
    });
  });
};

test('an expired session refreshes and the page loads, rather than reading as empty', async ({
  page,
}) => {
  // The access token lasts 15 minutes; `req` had no way to renew it, so
  // whichever resource call happened to land first after it lapsed was the one
  // that came back as "this gateway has nothing". The refresh token is still
  // good here, so the only correct outcome is that the operator never notices.
  await failOnce(page, ROUTES, sessionExpired);

  await page.goto('/ui/routes');

  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/ui/routes');
});

test('a session that cannot be refreshed goes to the login form', async ({
  page,
}) => {
  await failOnce(page, ROUTES, sessionExpired);
  await page.route('**/api/v1/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"Invalid refresh token"}',
    })
  );

  await page.goto('/ui/routes');

  await page.waitForURL((url) => url.pathname.endsWith('/login'), {
    timeout: 30000,
  });
  expect(new URL(page.url()).pathname).toBe('/ui/login');
});

test('a gateway rejecting the admin key does not sign the operator out', async ({
  page,
}) => {
  // The bug the obvious fix would introduce. This 401 comes from APISIX, not
  // from the dashboard: the session is fine and the instance is misconfigured.
  // Ending the session here would send someone to the login form to fix a
  // problem that logging in again cannot touch — and lose whatever they were
  // in the middle of.
  await page.route(ROUTES, (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: badAdminKey,
    })
  );

  await page.goto('/ui/routes');

  // Told what happened, in the gateway's own words.
  await expect(
    page.getByText('failed to check token').first()
  ).toBeVisible({ timeout: 30000 });

  // And still here.
  expect(new URL(page.url()).pathname).toBe('/ui/routes');

  /* eslint-disable-next-line playwright/no-wait-for-timeout --
     Asserting that a redirect never starts has no state to wait for. */
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).toBe('/ui/routes');
});

test('recovers from a real expired token, against the real backend', async ({
  page,
}) => {
  // The three above mock the 401, so they pin the frontend's half and would
  // all keep passing if the two constants drifted apart —
  // SESSION_INVALID_CODE in src/apis/session.ts and SessionInvalidCode in
  // api/internal/middleware/auth.go. Nothing but agreement between those two
  // strings makes any of this work.
  //
  // So this one takes no mock at all: it corrupts the access token and lets
  // the real middleware answer. The refresh token is untouched and still good,
  // so the only way the page loads is if the backend marked its rejection and
  // the frontend recognised the mark.
  await page.goto('/ui/routes');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });

  await page.evaluate(() =>
    localStorage.setItem('auth:access_token', 'no.longer.valid')
  );

  await page.reload();

  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/ui/routes');

  // And the session really was renewed, rather than the page having been
  // served from cache without ever asking.
  expect(
    await page.evaluate(() => localStorage.getItem('auth:access_token'))
  ).not.toBe('no.longer.valid');
});

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

  // And says so. Ending a session is a full page load, which destroys any
  // notification still on screen, so without this the operator arrives at a
  // login form with no idea why — mid-way through a batch delete, say, with
  // four of twelve routes gone and nothing to explain the rest.
  await expect(
    page.getByText('Your session ended').first()
  ).toBeVisible({ timeout: 20000 });
});

test('a gateway rejecting the admin key does not sign the operator out', async ({
  page,
}) => {
  // The bug the obvious fix would introduce. This 401 comes from APISIX, not
  // from the dashboard: the session is fine and the instance is misconfigured.
  // Ending the session here would send someone to the login form to fix a
  // problem that logging in again cannot touch — and lose whatever they were
  // in the middle of.
  // Every proxied call, not just this page's list. A refused admin key refuses
  // all of them, and the distinction matters: a successful proxy response
  // clears the banner (see the success interceptor in req.ts), so failing one
  // endpoint while its neighbours succeed would have the banner set and wiped
  // in the same second — and a test built that way would be measuring
  // something that cannot happen.
  await page.route('**/apisix/admin/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: badAdminKey,
    })
  );

  await page.goto('/ui/routes');

  // Told what happened, and told so that it is still on screen a minute later.
  // A toast auto-closes after five seconds; the loader spends about seven
  // retrying, so the only thing left by the time the page settles used to be
  // the generic "Failed to load the dashboard", which never mentions the key.
  // This is the banner the 502/504 path already uses, and its text says the
  // admin key may be wrong — with Retry and Edit instance beside it.
  await expect(page.getByText('Cannot reach')).toBeVisible({ timeout: 30000 });
  // In the gateway's own words, not a generic line.
  await expect(page.getByText('failed to check token')).toBeVisible();
  // A Link, so an anchor rather than a button.
  await expect(page.getByRole('link', { name: 'Edit instance' })).toBeVisible();
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);

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

test('a network blip while renewing does not end the session', async ({
  page,
}) => {
  // Wiring `req` to the shared refresh extended one of apiClient's habits to
  // every resource page: any failure to renew ended the session. But "the
  // backend refused this refresh token" and "the network dropped for two
  // seconds" are not the same fact. Only the first means the session is over;
  // the second means try again.
  //
  // Signing out on the second costs the operator whatever they were in the
  // middle of — the batch delete in flight, the route form half filled — to
  // recover from something that had already fixed itself.
  await failOnce(page, ROUTES, sessionExpired);
  await page.route('**/api/v1/refresh', (route) => route.abort('failed'));

  await page.goto('/ui/routes');

  // Told, rather than moved.
  await expect(
    page.getByText('Could not renew your session').first()
  ).toBeVisible({ timeout: 30000 });

  /* eslint-disable-next-line playwright/no-wait-for-timeout --
     Asserting that a redirect never starts has no state to wait for. */
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).toBe('/ui/routes');
  expect(
    await page.evaluate(() => localStorage.getItem('auth:refresh_token'))
  ).not.toBeNull();
});

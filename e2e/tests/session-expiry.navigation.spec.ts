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
 * The other half of #168. That one gave both axios clients a shared refresh,
 * so a lapsed access token is recoverable — but only where a *request*
 * discovers it. A *navigation* is decided earlier, by the router guard in
 * __root.tsx, which reads the access token's expiry and nothing else.
 *
 * Access tokens last 15 minutes and refresh tokens 7 days, so leaving a tab
 * for twenty minutes and clicking a link signed the operator out with a week
 * of session still in the browser (#174).
 */

/** Leave the session intact but make the access token look lapsed. */
const expireTheAccessToken = (page: Page) =>
  page.evaluate(() =>
    localStorage.setItem('auth:token_expiry', String(Date.now() - 1000))
  );

test('renews a lapsed token on navigation instead of signing out', async ({
  page,
}) => {
  await page.goto('/ui/routes');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });

  const before = await page.evaluate(() =>
    localStorage.getItem('auth:access_token')
  );
  await expireTheAccessToken(page);

  // The tab has been idle and the operator clicks through to another page.
  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();

  await expect(page).toHaveURL(/\/ui\/upstreams/, { timeout: 30000 });
  expect(new URL(page.url()).pathname).not.toBe('/ui/login');

  // And the session really was renewed rather than merely tolerated.
  expect(
    await page.evaluate(() => localStorage.getItem('auth:access_token'))
  ).not.toBe(before);
});

test('still signs out when the refresh token is refused', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });

  await page.route('**/api/v1/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"Invalid refresh token"}',
    })
  );
  await expireTheAccessToken(page);

  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();

  await page.waitForURL((url) => url.pathname.endsWith('/login'), {
    timeout: 30000,
  });
  expect(new URL(page.url()).pathname).toBe('/ui/login');
  // Told why, the same as every other way a session ends.
  await expect(page.getByText('Your session ended').first()).toBeVisible({
    timeout: 20000,
  });
});

test('does not sign out when the refresh merely could not be reached', async ({
  page,
}) => {
  // Same rule the request layer follows since #168: only the backend refusing
  // the refresh token ends a session. A dropped connection means try again,
  // and the requests on the page being navigated to will report it themselves.
  await page.goto('/ui/routes');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });

  await page.route('**/api/v1/refresh', (route) => route.abort('failed'));
  await expireTheAccessToken(page);

  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();

  // The positive claim, not merely the absence of a redirect: `not.toBe(
  // '/ui/login')` would also hold if the guard swallowed the navigation and
  // left us on /ui/routes, so a refresh that hung forever would pass.
  await expect(page).toHaveURL(/\/ui\/upstreams/, { timeout: 30000 });
  expect(
    await page.evaluate(() => localStorage.getItem('auth:refresh_token'))
  ).not.toBeNull();
});

test('renders the app shell after renewing on a page load', async ({ page }) => {
  // The three above expire the token after a successful load, so
  // isAuthenticatedAtom has already cached `true` and an in-tab navigation
  // keeps it. The case that matters most does not: a tab reopened after lunch
  // is a *page load* with the expiry already in the past, so the atom is
  // initialised from localStorage as false and nothing recomputes it —
  // refreshSession writes to localStorage, not to the store.
  //
  // The guard then lets the navigation through, correctly, and Root renders
  // with showAppShell false: no Header, no Navbar, no InstanceGuard, on a
  // session that was just renewed. Before this change that path redirected to
  // the login page, so the staleness was never reachable.
  await page.goto('/ui/routes');
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible({
    timeout: 30000,
  });

  await page.evaluate(() =>
    localStorage.setItem('auth:token_expiry', String(Date.now() - 1000))
  );

  await page.reload();

  await expect(page.locator('header')).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole('link', { name: 'Upstreams', exact: true })
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/ui/routes');
});

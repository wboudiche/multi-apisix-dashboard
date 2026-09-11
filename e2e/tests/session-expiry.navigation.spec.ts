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

  /* eslint-disable-next-line playwright/no-wait-for-timeout --
     Asserting that a redirect never starts has no state to wait for. */
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).not.toBe('/ui/login');
  expect(
    await page.evaluate(() => localStorage.getItem('auth:refresh_token'))
  ).not.toBeNull();
});

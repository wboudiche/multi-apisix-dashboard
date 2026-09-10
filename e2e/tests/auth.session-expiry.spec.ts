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
import { env } from '@e2e/utils/env';
import { expect, type Page, test } from '@playwright/test';

/**
 * The app is served under a base path (`BASE_PATH`, `/ui`). The router is told
 * about it once, so `navigate({ to: '/login' })` lands on `/ui/login`.
 *
 * The 401 handler in `src/apis/client.ts` does not navigate — it assigns
 * `window.location.href`, which is a raw browser URL and gets no base path
 * from anyone. Against the e2e target that is a 404 from openresty; against
 * `pnpm dev` it is Vite's "the server is configured with a base of /ui/" page.
 * Either way the session ends at a dead end instead of the login form (#163).
 *
 * Both of the handler's exits are pinned, separately, because they are two
 * literals: fixing one leaves the other.
 *
 * Own browser context throughout — these tests end their session, and the
 * shared worker fixture would carry that into every spec after them.
 */

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');
const LOGIN_PATH = '/ui/login';

const signIn = async (page: Page) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
    timeout: 20000,
  });
};

// A request that the app makes on load, so a reload is enough to drive the
// handler. Answered 401 to stand in for an access token the backend no longer
// accepts.
const expireTheAccessToken = (page: Page) =>
  page.route('**/api/v1/instances', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"token expired"}',
    })
  );

test('sends a session whose refresh is refused to the login page', async ({
  browser,
}) => {
  // The ordinary way a session ends: a tab left open past the refresh token's
  // 7 days, or a JWT_SECRET rotated under it. The access token is rejected,
  // the refresh is attempted, and the backend refuses that too.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await signIn(page);

    await expireTheAccessToken(page);
    await page.route('**/api/v1/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"invalid refresh token"}',
      })
    );

    await page.reload();

    await page.waitForURL((url) => url.pathname.endsWith('/login'), {
      timeout: 20000,
    });
    // Exact, not /\/login/: that regex matches the broken URL too, which is
    // how e2e/tests/auth.spec.ts has been green all along.
    expect(new URL(page.url()).pathname).toBe(LOGIN_PATH);
  } finally {
    await context.close();
  }
});

test('sends a session with no refresh token left to the login page', async ({
  browser,
}) => {
  // The handler's other exit: a 401 arrives and there is nothing to refresh
  // with. That is the state a half-finished logout leaves behind — the tokens
  // are gone from localStorage while requests started before it are still in
  // flight.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await signIn(page);

    await page.evaluate(() => localStorage.removeItem('auth:refresh_token'));
    await expireTheAccessToken(page);

    await page.reload();

    await page.waitForURL((url) => url.pathname.endsWith('/login'), {
      timeout: 20000,
    });
    expect(new URL(page.url()).pathname).toBe(LOGIN_PATH);
  } finally {
    await context.close();
  }
});

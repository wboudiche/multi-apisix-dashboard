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

import { BASE_PATH } from '@/config/constant';

/**
 * The app is served under a base path (`BASE_PATH`, `/ui`). The router is told
 * about it once, so `navigate({ to: '/login' })` lands on `/ui/login`.
 *
 * The interceptor in `src/apis/client.ts` does not navigate — it assigns
 * `window.location.href`, which is a raw browser URL and gets no base path
 * from anyone. Against the e2e target that is a 404 from openresty; against
 * `pnpm dev` it is Vite's "the server is configured with a base of /ui/" page.
 * Either way the session ends at a dead end instead of a form (#163).
 *
 * All three of its exits are pinned, separately, because they are three
 * literals: fixing one leaves the others.
 *
 * Own browser context throughout — these tests end their session, and the
 * shared worker fixture would carry that into every spec after them.
 */

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');

// Derived, not written out. `e2e/utils/env.ts` builds E2E_TARGET_URL from the
// same constant, so a change to BASE_PATH moves the target and would leave a
// hard-coded expectation failing for a reason that has nothing to do with the
// bug. (The unit test in src/utils/app-url.test.ts does write it out, on
// purpose: there it is the value under test.)
const LOGIN_PATH = `${BASE_PATH}/login`;
const CHANGE_PASSWORD_PATH = `${BASE_PATH}/change-password`;

const signIn = async (page: Page) => {
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
    timeout: 20000,
  });
};

/**
 * `/api/v1/instances` is fetched by the header on load, so a reload is enough
 * to drive the interceptor. Nothing else in the app calls it from the pages
 * these tests sit on, so exactly one response reaches the interceptor and a
 * second assignment to `location.href` cannot mask a half-applied fix.
 *
 * The glob stops short of `/api/v1/instances/health`, which keeps answering
 * normally.
 */
const failTheInstanceList = (page: Page, status: number, body: string) =>
  page.route('**/api/v1/instances', (route) =>
    route.fulfill({ status, contentType: 'application/json', body })
  );

const expired = '{"error":"token expired"}';

// Landing on the right URL is half of it; the point of the ticket is that the
// person gets a form back. A blank page or a failed chunk at the right path
// would still be a dead end — so both are asserted, inline, because
// playwright/expect-expect does not see through a helper.
const settleOnLogin = (page: Page) =>
  page.waitForURL((url) => url.pathname.endsWith('/login'), {
    timeout: 20000,
  });

const signInButton = (page: Page) =>
  page.getByRole('button', { name: 'Sign in' });

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

    await failTheInstanceList(page, 401, expired);
    await page.route('**/api/v1/refresh', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"invalid refresh token"}',
      })
    );

    await page.reload();

    await settleOnLogin(page);
    // Exact, not /\/login/: that regex matches the broken URL too, which is
    // how e2e/tests/auth.spec.ts has been green all along.
    expect(new URL(page.url()).pathname).toBe(LOGIN_PATH);
    await expect(signInButton(page)).toBeVisible({ timeout: 20000 });
  } finally {
    await context.close();
  }
});

test('sends a session with no refresh token left to the login page', async ({
  browser,
}) => {
  // The interceptor's other 401 exit: a 401 arrives and there is nothing to
  // refresh with. That is the state a half-finished logout leaves behind — the
  // tokens are gone from localStorage while requests started before it are
  // still in flight.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await signIn(page);

    await page.evaluate(() => localStorage.removeItem('auth:refresh_token'));
    await failTheInstanceList(page, 401, expired);

    await page.reload();

    await settleOnLogin(page);
    // Exact, not /\/login/: that regex matches the broken URL too, which is
    // how e2e/tests/auth.spec.ts has been green all along.
    expect(new URL(page.url()).pathname).toBe(LOGIN_PATH);
    await expect(signInButton(page)).toBeVisible({ timeout: 20000 });
  } finally {
    await context.close();
  }
});

test('sends an account owing a password change to the dedicated screen', async ({
  browser,
}) => {
  // The interceptor's third exit, and the one that already had the base path
  // written out by hand rather than missing — so this pins a path that was
  // working, against the refactor that moved it.
  //
  // The backend gates every endpoint behind a pending change, so any 403
  // carrying the code will do; the account itself need not owe one. Going
  // through a real must-change user would be answered by the router guard in
  // __root.tsx before a request ever left, which is the other mechanism and
  // not this one.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await signIn(page);

    await failTheInstanceList(
      page,
      403,
      '{"code":"password_change_required","error":"password change required"}'
    );

    await page.reload();

    await page.waitForURL((url) => url.pathname.endsWith('/change-password'), {
      timeout: 20000,
    });
    expect(new URL(page.url()).pathname).toBe(CHANGE_PASSWORD_PATH);
    await expect(
      page.getByRole('heading', { name: 'Choose a new password' })
    ).toBeVisible({ timeout: 20000 });
  } finally {
    await context.close();
  }
});

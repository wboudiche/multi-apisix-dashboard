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
import { test as authed } from '@e2e/utils/test';
import { expect, type Page, test } from '@playwright/test';

/**
 * A proxy that forwards /api/* to the static handler answers 200 with the SPA's
 * own index.html. axios resolves any 2xx, so it reaches the caller as success
 * and a string goes on to be mistaken for whatever was asked for.
 *
 * #150, #153 and #162 each hardened one consumer and the crash moved to the
 * next. The dashboard has three axios instances over independent paths, so
 * these drive the misroute through each of them and assert the same thing: the
 * failure is reported where it happened, naming the request, instead of
 * surfacing later as something unrelated — or not surfacing at all.
 */

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');
const HTML = '<!doctype html><html><body>index</body></html>';

const misroute = (page: Page, glob: string) =>
  page.route(glob, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: HTML })
  );

authed('names the request when a resource call is misrouted', async ({ page }) => {
  // The `req` client, which serves every APISIX resource page and had no shape
  // check of any kind. Before, the body reached the table and rendering threw
  // "Cannot read properties of undefined (reading 'map')" — an error with
  // nothing in it to act on, several frames from the cause.
  await misroute(page, '**/apisix/admin/routes*');
  await page.goto('/ui/routes');

  await expect(
    page.getByText('/api/v1/apisix/admin/routes: expected a JSON body')
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Cannot read properties')).toHaveCount(0);
});

test('refuses a login whose identity call is misrouted', async ({ browser }) => {
  // `apiClient`, at the one moment it matters most. /api/v1/user has no
  // per-endpoint check — nobody thought to give it one — so before this the
  // login *succeeded*: the dashboard stored the HTML document as the current
  // user and ran with it, which is the value usePermission reads a role out of.
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await misroute(page, '**/api/v1/user');

    await page.goto(`${BASE_URL}/login`);
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // .first(): the message lands in both the form's alert and a toast, which
    // is right — the toast auto-closes, the alert stays.
    await expect(
      page.getByText('/api/v1/user: expected a JSON body').first()
    ).toBeVisible({ timeout: 20000 });
    expect(new URL(page.url()).pathname).toBe('/ui/login');
    expect(await page.evaluate(() => localStorage.getItem('auth:user'))).toBeNull();
  } finally {
    await context.close();
  }
});

test('leaves no half-open session when the identity call is misrouted', async ({
  browser,
}) => {
  // The tokens are stored before the identity call is made, so a failure there
  // used to leave a session that `isAuthenticated()` accepts — it reads only
  // the access token — with no user behind it. Reloading walked straight into
  // the app as nobody.
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await misroute(page, '**/api/v1/user');

    await page.goto(`${BASE_URL}/login`);
    await page.getByRole('textbox', { name: 'Username' }).fill('admin');
    await page.getByPlaceholder('Enter your password').fill('admin');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // .first(): the message lands in both the form's alert and a toast, which
    // is right — the toast auto-closes, the alert stays.
    await expect(
      page.getByText('/api/v1/user: expected a JSON body').first()
    ).toBeVisible({ timeout: 20000 });

    await page.goto(`${BASE_URL}/routes`);

    await page.waitForURL((url) => url.pathname.endsWith('/login'), {
      timeout: 20000,
    });
    expect(new URL(page.url()).pathname).toBe('/ui/login');
  } finally {
    await context.close();
  }
});

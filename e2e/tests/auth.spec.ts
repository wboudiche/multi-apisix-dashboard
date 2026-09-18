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

/* eslint-disable playwright/no-wait-for-timeout */
import { env } from '@e2e/utils/env';
import { expect, test } from '@playwright/test';

const BASE_URL = env.E2E_TARGET_URL.replace(/\/$/, '');

test('redirects to login page when not authenticated', { tag: '@auth' }, async ({ page }) => {
  await page.goto(`${BASE_URL}/routes`);
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
});

test('shows the login screen on its own, session or not', { tag: '@auth' }, async ({ page }) => {
  // The root route renders the app shell everywhere except the two full-screen
  // pages, and picks them out of the pathname the router hands it - which has
  // the base path already removed (#169).
  //
  // Signed in first, deliberately: `showAppShell` is `authenticated && !login
  // && !changePassword`, so with no session the shell is gone whatever the
  // path says, and the assertion would hold for any answer. The login page is
  // reachable with a session - a bookmark, a second tab - and that is the one
  // state where this decision is the only thing between the screen and the
  // app shell.
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();

  await page.goto(`${BASE_URL}/login`);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('can login with valid credentials', { tag: '@auth' }, async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForTimeout(1000);

  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  await expect(page).toHaveURL(/\/overview/);
});

test('shows error with invalid credentials', { tag: '@auth' }, async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForTimeout(1000);

  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByPlaceholder('Enter your password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
});

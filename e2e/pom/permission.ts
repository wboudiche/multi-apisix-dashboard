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
import { expect, type Page } from '@playwright/test';

const dashboardBase = () => env.E2E_TARGET_URL.replace(/\/$/, '');

export const permission = {
  /**
   * Log in as a specific user. Clears prior session state first so a
   * worker-shared storageState (which holds an admin token) doesn't
   * leak into a non-admin assertion.
   */
  loginAs: async (page: Page, username: string, password: string) => {
    await page.context().clearCookies();
    await page.goto(`${dashboardBase()}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${dashboardBase()}/login`);

    await page
      .getByRole('textbox', { name: 'Username' })
      .fill(username);
    await page.getByPlaceholder('Enter your password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for redirect away from /login (router lands on /overview
    // for admins, or /routes for developers and viewers).
    await page.waitForURL(
      (url) => !url.pathname.includes('/login'),
      { timeout: 15000 }
    );
  },

  logout: async (page: Page) => {
    // The user menu's trigger is an UnstyledButton showing the
    // username; there's no aria-label, so we target the visible
    // username text inside the header.
    await page
      .locator('header')
      .getByRole('button')
      .filter({ hasText: /.+/ })
      .last()
      .click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await page.waitForURL((url) => url.pathname.includes('/login'));
  },

  /**
   * Switch the active APISIX instance via the header Select.
   * The Select's input shows the currently-selected instance name
   * (or the placeholder 'Select instance' if none chosen yet).
   */
  switchInstance: async (page: Page, instanceName: string) => {
    const select = page
      .locator('header')
      .getByPlaceholder('Select instance')
      .or(page.locator('header').getByRole('searchbox'))
      .first();
    await select.click();
    await page
      .getByRole('option', { name: instanceName, exact: false })
      .click();
    // Confirm the switch landed; X-Instance-ID is now wired
    // through the apiClient interceptor (src/stores/instance.ts).
    await expect(select).toHaveValue(instanceName);
  },
};

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
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page } from '@playwright/test';

const dashboardBase = () => env.E2E_TARGET_URL.replace(/\/$/, '');

/** The header's APISIX-instance Select (shared with adminPom). */
export const headerSelect = (page: Page) =>
  page
    .locator('header')
    .getByPlaceholder('Select instance')
    .or(page.locator('header').getByRole('searchbox'))
    .first();

/** Map known instance names back to the IDs written by globalSetup. */
const instanceIdByName = (name: string): string | undefined => {
  const fx = getFixtures();
  if (name === 'Local APISIX') return fx.localInstanceId;
  if (name === 'Staging APISIX') return fx.stagingInstanceId;
  return undefined;
};

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
   * Switch the active APISIX instance.
   *
   * The header Select races with the app's auto-select on first load
   * (right after loginAs() clears localStorage), so the UI click can
   * land on whichever instance the backend happens to return first.
   * When the instance name is one we provisioned in globalSetup, seed
   * `instance:current_id` in localStorage and reload — that's the same
   * key `currentInstanceIdAtom` reads on init, so the React app comes
   * up with the right instance already selected. Otherwise fall back
   * to the UI dropdown.
   */
  switchInstance: async (page: Page, instanceName: string) => {
    const id = instanceIdByName(instanceName);
    if (id) {
      // Wait for the header's auto-select to settle first — its async
      // effect captured an empty instance id at mount and would otherwise
      // overwrite the seeded value when it resolves (between our setItem
      // and the reload's localStorage read)
      await page
        .waitForFunction(() => !!localStorage.getItem('instance:current_id'), {
          timeout: 10000,
        })
        .catch(() => {
          /* no instances yet — seeding below still applies */
        });
      await page.evaluate(
        ([key, val]) => localStorage.setItem(key, val),
        ['instance:current_id', id] as const,
      );
      await page.reload();
    } else {
      const select = headerSelect(page);
      await select.click();
      await page
        .getByRole('option', { name: instanceName, exact: false })
        .click();
    }
    // Confirm the switch landed; X-Instance-ID is now wired
    // through the apiClient interceptor (src/stores/instance.ts).
    await expect(headerSelect(page)).toHaveValue(instanceName);
  },
};

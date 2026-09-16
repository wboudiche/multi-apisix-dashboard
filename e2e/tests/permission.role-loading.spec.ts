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
import { permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page, test } from '@playwright/test';

/**
 * What the interface offers while an account's role is still loading.
 *
 * usePermission reads the role for the current instance out of the account's
 * instance assignments, which the header fetches after login. Until that
 * answers, the role is not known — and an unknown role was treated as a
 * writer, so a viewer was offered the write controls of whichever page they
 * landed on until the request came back (#181). The same hook already refused
 * navigation while the role was unknown, so it answered two ways at once.
 *
 * The assignments name an instance and a role, never the account they were
 * read for, so they also have to go when a session ends: signing out does not
 * reload the tab, and the next account would start from the last one's role.
 */

// loginAs clears the session and waits for a redirect, which does not fit in
// Playwright's default 30s.
const TIMEOUT_MS = 90_000;

/** The request that carries the account's role on each instance. */
const USER_INSTANCES = /\/api\/v1\/user-access\/[^/]+\/instances$/;

/** Holds that request until the returned function is called. */
const holdUserInstances = async (page: Page) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => USER_INSTANCES.test(url.pathname),
    async (route) => {
      await released;
      await route.continue();
    }
  );
  return () => release();
};

/** The role the header names under the username, once it has read one. */
const headerRole = (page: Page, role: string) =>
  page.locator('header').getByText(role, { exact: true });

test('a viewer is offered no write control while their role is loading', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  // A context of its own: the worker's stored session belongs to the admin.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const release = await holdUserInstances(page);

  try {
    await permission.loginAs(
      page,
      fx.users.viewer.username,
      fx.users.viewer.password
    );

    // Login lands on the overview, which carries no write control. The routes
    // list does, and nothing refuses it while the role is unknown: only the
    // sidebar's links are gated on canAccessRoute, not the router.
    await page.goto('/ui/routes');
    await routesPom.isIndexPage(page);

    // The role is still on the wire: the header has no role to name yet. That
    // it is held is what this test is about, so it is asserted rather than
    // assumed — a predicate that stopped matching would hold nothing.
    await expect(headerRole(page, 'viewer')).toHaveCount(0);
    await expect(routesPom.getAddRouteBtn(page)).toHaveCount(0);

    // And once the role is known, for the reason it was always meant to be.
    const resolved = page.waitForResponse((res) =>
      USER_INSTANCES.test(new URL(res.url()).pathname)
    );
    release();
    await resolved;
    await expect(headerRole(page, 'viewer')).toBeVisible({ timeout: 30000 });
    await expect(routesPom.getAddRouteBtn(page)).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});

test('a viewer does not inherit the role of the account signed out before them', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  let release = () => {};

  try {
    // A developer first: they may create a route on this instance.
    await permission.loginAs(
      page,
      fx.users.dev.username,
      fx.users.dev.password
    );
    await page.goto('/ui/routes');
    await routesPom.isIndexPage(page);
    await expect(headerRole(page, 'developer')).toBeVisible({ timeout: 30000 });
    await expect(routesPom.getAddRouteBtn(page)).toBeVisible();

    // Signing out and back in, in the one tab, without ever reloading it: a
    // reload would build the app again and hide what this test is about.
    await permission.logout(page);
    release = await holdUserInstances(page);
    await page.getByRole('textbox', { name: 'Username' }).fill(fx.users.viewer.username);
    await page.getByPlaceholder('Enter your password').fill(fx.users.viewer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'));

    // The header names the role it holds, on whatever page the router landed
    // on, and it reads the assignments usePermission reads. Nothing is opened
    // by URL from here: a document load would build the app again and take the
    // stale assignments with it, hiding what this test is about.
    await expect(headerRole(page, 'developer')).toHaveCount(0);

    // And once the viewer's own assignments answer, that is what it names.
    const resolved = page.waitForResponse((res) =>
      USER_INSTANCES.test(new URL(res.url()).pathname)
    );
    release();
    await resolved;
    await expect(headerRole(page, 'viewer')).toBeVisible({ timeout: 30000 });
  } finally {
    release();
    await context.close();
  }
});

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
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page, test } from '@playwright/test';

/**
 * What the interface offers while an account's role is still loading.
 *
 * usePermission reads the role for the current instance out of the user's
 * instance assignments, which the header fetches after login. Until that
 * answers, the role is not known — and an unknown role was treated as a
 * writer, so a viewer was offered the write controls of whichever page they
 * landed on until the request came back (#181). The same hook already refuses
 * navigation while the role is unknown, so it answered two ways at once.
 */

// loginAs clears the session and waits for the redirect, which does not fit
// in Playwright's default 30s.
const TIMEOUT_MS = 120_000;

/** Holds the request that carries the account's role on each instance. */
const holdUserInstances = async (page: Page) => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => /\/api\/v1\/user-access\/[^/]+\/instances$/.test(url.pathname),
    async (route) => {
      await released;
      await route.continue();
    }
  );
  return () => release();
};

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

    // The role is still on the wire. The list has rendered — its own request
    // is not the one being held — so the toolbar is there to be read.
    const create = page.getByRole('button', { name: 'Create', exact: true });
    await expect(page.getByRole('heading', { name: 'Routes' })).toBeVisible({
      timeout: 30000,
    });
    await expect(create).toHaveCount(0);

    // And once the role is known, for the reason it was always meant to be.
    const resolved = page.waitForResponse((res) =>
      /\/api\/v1\/user-access\/[^/]+\/instances$/.test(new URL(res.url()).pathname)
    );
    release();
    await resolved;
    // The header names the role it read, under the username — exactly, since
    // the account itself is called viewer_user.
    await expect(
      page.locator('header').getByText('viewer', { exact: true })
    ).toBeVisible({ timeout: 30000 });
    await expect(create).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});

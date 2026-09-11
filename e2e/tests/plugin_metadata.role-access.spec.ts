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
import { adminToken, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { ensureUser, ensureUserInstanceRole } from '@e2e/utils/seed-client';
import { expect, type Page, test } from '@playwright/test';

/**
 * models.RolePermissions never mentioned plugin_metadata, and a resource
 * missing from that table fails closed. Every role but super_admin was refused
 * the page — including instance_admin, who was told "Ask an admin if you need
 * access", which is advice for someone who is not already the admin (#172).
 *
 * The Go test pins the matrix. These pin what it means on screen, which the
 * table alone cannot say.
 */

const FORBIDDEN = 'may not read plugin metadata';
const PASSWORD = 'E2e-Role!Access#1';

const signIn = async (page: Page, username: string, password: string) => {
  await page.goto('/ui/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 20000,
  });
};

/**
 * Reach the page with an instance chosen, the way a person would.
 *
 * InstanceGuard deliberately does not auto-pick one — branch (3) of
 * InstanceGuard.tsx says auto-picking can mask the wrong selection in a
 * multi-instance setup — so a freshly created account lands on "no instance
 * selected" until someone chooses from the header switcher. That is the
 * design, not a fault, and a test that skipped it would be testing a state no
 * operator is ever in.
 */
const openPluginMetadata = async (page: Page, instanceName: string) => {
  await page.goto('/ui/routes');

  const switcher = page.locator('header input[placeholder="Select instance"]');
  await expect(switcher).toBeVisible({ timeout: 30000 });
  if ((await switcher.inputValue()) === '') {
    await switcher.click();
    await page.getByRole('option', { name: instanceName }).click();
  }

  // The filter bar's Search, not Create: a viewer has no Create button, and
  // one of the roles under test here is the viewer.
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible({
    timeout: 30000,
  });
  await page.goto('/ui/plugin_metadata');
  await expect(page.getByText('Select Plugins')).toBeVisible({ timeout: 30000 });
};

/**
 * Why the refusal is watched for rather than checked once.
 *
 * The page renders its own chrome whether the read was granted or refused —
 * the refusal is an Alert above it — and this gateway has no metadata
 * configured, so there is nothing positive that only a granted read produces.
 * A bare `toHaveCount(0)` therefore resolves the instant it is asked, and
 * passes on a page whose requests are still in flight.
 *
 * The first draft of this spec did exactly that and went green against the
 * unfixed backend. Mutation testing is the only reason I know that.
 */
const REFUSAL_SAMPLES = 10;

/**
 * Longer than the 30s default, which these exceed on their own arithmetic:
 * provisioning an account, two navigations that each allow 30s, and four
 * seconds of sampling. The first draft spent a while looking like a
 * permissions failure because the timeout it hit was the test's, not a
 * locator's.
 */
const TIMEOUT_MS = 90_000;

test('an instance admin is not told to ask an admin', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  const prefix = randomId('pm-admin');
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    const token = await adminToken();
    const fx = getFixtures();

    const user = await ensureUser(token, {
      username: `${prefix}-user`,
      password: PASSWORD,
      must_change_password: false,
    });
    await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
      role: 'instance_admin',
      team_id: fx.backendTeamId,
    });

    await signIn(page, `${prefix}-user`, PASSWORD);
    await openPluginMetadata(page, 'Local APISIX');

    /* eslint-disable playwright/no-wait-for-timeout --
       Asserting that something never appears has no state to wait for. */
    for (let i = 0; i < REFUSAL_SAMPLES; i++) {
      await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
      await page.waitForTimeout(400);
    }
    /* eslint-enable playwright/no-wait-for-timeout */
  } finally {
    await context.close();
    await deleteUsersByPrefix(prefix);
  }
});

test('a viewer may read it too', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  // The same omission cost the viewer its read, while it has one on every
  // other resource in the same sidebar.
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signIn(page, fx.users.viewer.username, fx.users.viewer.password);
    await openPluginMetadata(page, 'Local APISIX');

    /* eslint-disable playwright/no-wait-for-timeout --
       Asserting that something never appears has no state to wait for. */
    for (let i = 0; i < REFUSAL_SAMPLES; i++) {
      await expect(page.getByText(FORBIDDEN)).toHaveCount(0);
      await page.waitForTimeout(400);
    }
    /* eslint-enable playwright/no-wait-for-timeout */
  } finally {
    await context.close();
  }
});

test('a developer is not offered a page that can only refuse', async ({
  browser,
}) => {
  // The backend has never granted this role plugin_metadata, and that stays:
  // it is instance-wide configuration rather than a team's own objects. What
  // was wrong was the sidebar offering it anyway, so the entry led to a page
  // that could only apologise.
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signIn(page, fx.users.dev.username, fx.users.dev.password);

    // Asserted first, so the absence below means something: it is checked
    // against a sidebar that has rendered.
    await expect(
      page.getByRole('link', { name: 'Routes', exact: true })
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole('link', { name: 'Upstreams', exact: true })
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: 'Plugin Metadata', exact: true })
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

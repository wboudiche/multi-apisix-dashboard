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
import { e2eReq } from '@e2e/utils/req';
import { expect, type Page, test } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

/**
 * #176 gave the viewer `plugin_metadata:read`, which is right — and made
 * reachable something that had been hidden behind the 403: the page renders
 * its write controls without asking the role. So a viewer on a gateway with
 * metadata configured was offered Edit and Delete on every card, and a Select
 * Plugins button, all of which the backend refuses (#178).
 *
 * Not a security problem — RBAC denies every non-GET to a viewer, pinned by
 * TestRolesKeepTheirBoundaries — but an interface offering actions it knows
 * will fail, which is what the viewer write-gating on every other resource
 * page exists to prevent.
 */

// Not syslog: plugin_metadata.crud-required-fields.spec.ts creates and deletes
// that one in its own beforeAll/afterAll, and sharing it would couple the two.
const PLUGIN = 'http-logger';
const METADATA = { log_format: { host: '$host', client_ip: '$remote_addr' } };

// loginAs, a reload to seed the instance, and a navigation that allows 30s
// do not fit in Playwright's 30s default.
const TIMEOUT_MS = 90_000;

test.beforeAll(async () => {
  await e2eReq.put(`${API_PLUGIN_METADATA}/${PLUGIN}`, METADATA);
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_PLUGIN_METADATA}/${PLUGIN}`).catch(() => {
    // Already gone is fine.
  });
});

const openAs = async (page: Page, username: string, password: string) => {
  await permission.loginAs(page, username, password);
  await permission.switchInstance(page, 'Local APISIX');
  await page.goto('/ui/plugin_metadata');
};

test('a viewer can inspect plugin metadata but is not offered writes', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAs(page, fx.users.viewer.username, fx.users.viewer.password);

    // The positive claim first. Only a granted read of a seeded entry renders
    // this card, so the absences below are checked against a page that has
    // settled rather than one still in flight.
    const card = page.getByTestId(`plugin-${PLUGIN}`);
    await expect(card).toBeVisible({ timeout: 30000 });

    await expect(card.getByRole('button', { name: 'View' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Select Plugins' })
    ).toHaveCount(0);

    // And View is somewhere to look, not a disguised editor: read-only, with
    // nothing to save.
    await card.getByRole('button', { name: 'View' }).click();
    const drawer = page.getByRole('dialog', { name: 'View Plugin' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Save' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('an admin keeps every control a viewer loses', async ({ browser }) => {
  // The counterweight: gating on the role must not hide writes from the
  // people who can make them.
  test.setTimeout(TIMEOUT_MS);
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAs(page, fx.users.admin.username, fx.users.admin.password);

    const card = page.getByTestId(`plugin-${PLUGIN}`);
    await expect(card).toBeVisible({ timeout: 30000 });

    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Select Plugins' })
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

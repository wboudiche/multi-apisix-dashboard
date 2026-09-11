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
import { adminToken, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq } from '@e2e/utils/req';
import { ensureUser, ensureUserInstanceRole } from '@e2e/utils/seed-client';
import { expect, type Page, test } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

/**
 * #176 gave the viewer `plugin_metadata:read`, which is right — and made
 * reachable something the 403 had been hiding: the page rendered its write
 * controls without asking the role. A viewer on a gateway with metadata
 * configured was offered Edit and Delete on every card, and a Select Plugins
 * button, all of which the backend refuses (#178).
 *
 * Not a security problem — RBAC denies every non-GET to a viewer, pinned by
 * TestRolesKeepTheirBoundaries — but an interface offering actions it knows
 * will fail.
 */

// A plugin no other spec touches. Not syslog (crud-required-fields) and not
// http-logger (crud-all-fields): both of those create and delete their entry
// in their own hooks, and sharing one would let either spec's cleanup pull
// the entry out from under the other.
const PLUGIN = 'udp-logger';
const METADATA = { log_format: { host: '$host', client_ip: '$remote_addr' } };
const PASSWORD = 'E2e-Role!Access#1';

// Every test reads the one seeded entry, so they run in one worker, in order:
// in fully parallel mode each worker runs its own beforeAll/afterAll, and one
// worker's cleanup could delete the entry while another's test is reading it.
test.describe.configure({ mode: 'serial' });

// loginAs, a reload to seed the instance, and a navigation that allows 30s
// do not fit in Playwright's 30s default.
const TIMEOUT_MS = 120_000;

// e2eReq is bound to the local instance. Staging gets a copy too, for the
// instance-switch test below: the page does not refetch plugin metadata when
// the instance changes, so after a switch it may still be showing staging's
// cards. Seeding both keeps that test about Edit, whichever card it lands on.
const onStaging = () => ({
  headers: { 'X-Instance-ID': getFixtures().stagingInstanceId },
});

test.beforeAll(async () => {
  await e2eReq.put(`${API_PLUGIN_METADATA}/${PLUGIN}`, METADATA);
  await e2eReq.put(`${API_PLUGIN_METADATA}/${PLUGIN}`, METADATA, onStaging());
});

test.afterAll(async () => {
  // Already gone is fine.
  await e2eReq.delete(`${API_PLUGIN_METADATA}/${PLUGIN}`).catch(() => {});
  await e2eReq
    .delete(`${API_PLUGIN_METADATA}/${PLUGIN}`, onStaging())
    .catch(() => {});
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

test('Edit still works after switching from a viewer instance to an admin one', async ({
  browser,
}) => {
  // One account, two roles — the per-instance model the dashboard is built on:
  // viewer on staging, instance_admin on local. Switching instance in the
  // header does not remount the page; only the role underneath it changes.
  //
  // PluginCardList builds its card list from a mobx observable whose
  // initializer closes over onEdit and onDelete once, at first render, and
  // resyncs only `mode` afterwards. So handlers passed conditionally on the
  // role are frozen at whatever the first role allowed: open the page as a
  // viewer, switch to where you are admin, and Edit and Delete appear — and do
  // nothing. The visibility-only assertions above cannot see that; this
  // clicks.
  test.setTimeout(TIMEOUT_MS);
  const prefix = randomId('pm-switch');
  const fx = getFixtures();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    const token = await adminToken();
    const user = await ensureUser(token, {
      username: `${prefix}-user`,
      password: PASSWORD,
    });
    await ensureUserInstanceRole(token, user.id, fx.stagingInstanceId, {
      role: 'viewer',
      team_id: fx.viewersTeamId,
    });
    await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
      role: 'instance_admin',
      team_id: fx.backendTeamId,
    });

    // Open the page where this account is only a viewer: the card is there,
    // read-only. This is the render whose handlers the list keeps.
    await permission.loginAs(page, `${prefix}-user`, PASSWORD);
    await permission.switchInstance(page, 'Staging APISIX');
    await page.goto('/ui/plugin_metadata');
    const card = page.getByTestId(`plugin-${PLUGIN}`);
    await expect(card.getByRole('button', { name: 'View' })).toBeVisible({
      timeout: 30000,
    });
    await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0);

    // Switch in the header, the way a person would — not through
    // permission.switchInstance, whose reload would remount the page and hide
    // exactly what this is here to catch.
    const switcher = page.locator('header input[placeholder="Select instance"]');
    await switcher.click();
    await page.getByRole('option', { name: 'Local APISIX' }).click();
    await expect(switcher).toHaveValue('Local APISIX');

    // Now admin: the card turns editable. The failure this is here for comes
    // after this line — Edit shown, and a click that goes nowhere.
    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 30000,
    });

    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Plugin' })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await context.close();
    await deleteUsersByPrefix(prefix);
  }
});

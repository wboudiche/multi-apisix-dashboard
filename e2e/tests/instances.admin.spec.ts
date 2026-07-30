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
/* eslint-disable playwright/expect-expect -- assertions live in the
   uiHasToastMsg helper */
import { adminPom } from '@e2e/pom/admin';
import { adminToken, deleteInstancesByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';
import axios from 'axios';

const PREFIX = randomId('adm-inst');
// Real second APISIX from e2e/server/docker-compose.yml; key from apisix_conf_2.yml.
// Read from the same env var global-setup uses: hardcoding it would silently
// decouple this spec from the instance the fixture actually registered.
const STAGING_ADMIN_URL =
  process.env['E2E_STAGING_APISIX_URL'] ?? 'http://127.0.0.1:9181';
const STAGING_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

/** Talks to the staging gateway's Admin API directly, to seed resources on it. */
const stagingReq = axios.create({
  baseURL: `${STAGING_ADMIN_URL}/apisix/admin`,
  headers: { 'X-API-KEY': STAGING_ADMIN_KEY },
});
// Ports nothing listens on, one per fixture. Only the UI-created instance is
// subject to the duplicate-Admin-API-URL check (seeded fixtures pass
// ?force=true, see ensureInstance), but distinct URLs also keep each test's row
// unambiguous and stop one fixture's connectivity state describing another's.
const DEAD_URLS = {
  connectionTest: 'http://127.0.0.1:1',
  status: 'http://127.0.0.1:2',
  saveWarning: 'http://127.0.0.1:3',
} as const;

test.afterAll(async () => {
  await deleteInstancesByPrefix(PREFIX);
});

test('creates an instance via the Add Instance modal', async ({ page }) => {
  const name = `${PREFIX}-created`;
  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await page.getByRole('button', { name: 'Add Instance' }).click();
  await expect(page.getByText('Add New Instance')).toBeVisible();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('created by instances.admin e2e');
  await page.getByLabel('Admin API URL').fill(STAGING_ADMIN_URL);
  await page.getByLabel('Admin Key').fill(STAGING_ADMIN_KEY);
  await page.getByRole('button', { name: 'Create Instance' }).click();

  // The global fixture already registered this gateway, so the duplicate-URL
  // warning fires. Sharing a gateway is allowed once explicitly confirmed.
  await expect(page.getByText('Admin API URL already in use')).toBeVisible();
  await page.getByRole('button', { name: 'Save anyway' }).click();

  await expect(adminPom.rowByText(page, name)).toBeVisible();
});

test('rejects an instance whose name is already taken', async ({ page }) => {
  const name = `${PREFIX}-dup-name`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await page.getByRole('button', { name: 'Add Instance' }).click();
  // Different case: names must collide case-insensitively, so the list can never
  // show two rows that look identical.
  await page.getByLabel('Name').fill(name.toUpperCase());
  await page.getByLabel('Admin API URL').fill('http://127.0.0.1:9999');
  await page.getByLabel('Admin Key').fill('irrelevant');
  await page.getByRole('button', { name: 'Create Instance' }).click();

  await expect(page.getByText(/already exists/)).toBeVisible();
  // Rejected, not silently created: the modal is still open and the name still
  // matches exactly one row. (hasText matches case-insensitively, so counting
  // the uppercase spelling would find the original row and prove nothing.)
  await expect(page.getByText('Add New Instance')).toBeVisible();
  await expect(adminPom.rowByText(page, name)).toHaveCount(1);
});

test('shows an unreachable instance as Unreachable, not Active', async ({ page }) => {
  const name = `${PREFIX}-status`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: DEAD_URLS.status,
    admin_key: 'irrelevant',
    is_active: true,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  const row = adminPom.rowByText(page, name);
  // is_active is an admin flag and stays Enabled; connectivity is measured
  // separately and must not report a dead gateway as healthy.
  await expect(row.getByText('Enabled')).toBeVisible();
  await expect(row.getByText('Unreachable')).toBeVisible();
  await expect(row.getByText('Connected')).toHaveCount(0);
});

test('warns that saving an unreachable instance did not connect', async ({ page }) => {
  const name = `${PREFIX}-warn`;
  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await page.getByRole('button', { name: 'Add Instance' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Admin API URL').fill(DEAD_URLS.saveWarning);
  await page.getByLabel('Admin Key').fill('irrelevant');
  await page.getByRole('button', { name: 'Create Instance' }).click();

  // Saved, but never reported as a clean success.
  await uiHasToastMsg(page, { hasText: 'Saved, but unreachable' });
  await expect(adminPom.rowByText(page, name)).toBeVisible();
});

test('lists attached resources before deleting an instance', async ({ page }) => {
  const name = `${PREFIX}-deps`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  // Seed the resource this test asserts on rather than relying on whatever
  // another spec happened to leave on the shared gateway: run this file alone
  // and the gateway is empty, so the dialog would show its "nothing attached"
  // branch and the assertion below would fail for the wrong reason.
  const routeId = `${PREFIX}-attached-route`;
  await stagingReq.put(`/routes/${routeId}`, {
    name: routeId,
    uri: `/${routeId}`,
    upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
  });

  try {
    await adminPom.toInstances(page);
    await adminPom.isInstancesPage(page);
    await adminPom.rowByText(page, name).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(`Delete instance "${name}"?`)).toBeVisible();
    await expect(page.getByText(/stay live on the APISIX gateway/)).toBeVisible();

    // Dismissing must leave the instance alone.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(adminPom.rowByText(page, name)).toBeVisible();
  } finally {
    await stagingReq.delete(`/routes/${routeId}`);
  }
});

test('Connection test succeeds against a reachable instance', async ({ page }) => {
  const name = `${PREFIX}-reachable`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  await adminPom
    .rowByText(page, name)
    .getByRole('button', { name: 'Test Connection' })
    .click();

  await uiHasToastMsg(page, { hasText: 'Connection Successful' });
});

test('Connection test fails against an unreachable instance', async ({ page }) => {
  const name = `${PREFIX}-unreachable`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: DEAD_URLS.connectionTest,
    admin_key: 'irrelevant',
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);
  await adminPom
    .rowByText(page, name)
    .getByRole('button', { name: 'Test Connection' })
    .click();

  await uiHasToastMsg(page, { hasText: 'Connection Failed' });
});

test('edits and deletes an instance', async ({ page }) => {
  const name = `${PREFIX}-lifecycle`;
  const renamed = `${name}-renamed`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: STAGING_ADMIN_URL,
    admin_key: STAGING_ADMIN_KEY,
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await adminPom.rowByText(page, name).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('Edit Instance')).toBeVisible();
  await page.getByLabel('Name').fill(renamed);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(adminPom.rowByText(page, renamed)).toBeVisible();

  await adminPom
    .rowByText(page, renamed)
    .getByRole('button', { name: 'Delete' })
    .click();
  // Deletion is confirmed in a modal that spells out what it would orphan,
  // no longer a bare native confirm().
  await expect(page.getByText(`Delete instance "${renamed}"?`)).toBeVisible();
  await page.getByRole('button', { name: 'Delete anyway' }).click();

  await uiHasToastMsg(page, { hasText: 'Instance deleted successfully' });
  await expect(adminPom.rowByText(page, renamed)).toHaveCount(0);
});

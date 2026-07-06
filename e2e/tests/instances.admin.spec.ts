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

const PREFIX = randomId('adm-inst');
// Real second APISIX from e2e/server/docker-compose.yml; key from apisix_conf_2.yml.
const STAGING_ADMIN_URL = 'http://127.0.0.1:9181';
const STAGING_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

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

  await expect(adminPom.rowByText(page, name)).toBeVisible();
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
    admin_api_url: 'http://127.0.0.1:1',
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

  page.on('dialog', (dialog) => void dialog.accept());
  await adminPom
    .rowByText(page, renamed)
    .getByRole('button', { name: 'Delete' })
    .click();
  await uiHasToastMsg(page, { hasText: 'Instance deleted successfully' });
  await expect(adminPom.rowByText(page, renamed)).toHaveCount(0);
});

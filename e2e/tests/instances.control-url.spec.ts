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
import { adminPom } from '@e2e/pom/admin';
import { adminToken, deleteInstancesByPrefix, listInstances } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * An instance can record where its gateway serves APISIX's Control API, which
 * is where upstream health is reported (#281).
 *
 * It is optional and usually empty: APISIX binds that API to loopback unless
 * the deployment says otherwise, and it carries no authentication of its own.
 * A gateway without one is a gateway whose health this dashboard cannot know,
 * which is a different thing from a gateway that is unwell - so the field has
 * to be as easy to take away as it is to set.
 */
const PREFIX = randomId('ctrl-url');
const CONTROL_URL = 'http://127.0.0.1:9090';
// Nothing listens on either; this spec is about the record, not about reaching
// it. One per test, so that the second instance does not trip the
// duplicate-Admin-API-URL confirmation the first one's address would raise.
const DEAD_ADMIN_URLS = {
  edited: 'http://127.0.0.1:4',
  created: 'http://127.0.0.1:5',
  seeded: 'http://127.0.0.1:6',
} as const;

const instanceByName = async (name: string) =>
  (await listInstances()).find((i) => i.name === name);

test.afterAll(async () => {
  await deleteInstancesByPrefix(PREFIX);
});

test('keeps a control API address, and lets it be taken away again', async ({
  page,
}) => {
  const name = `${PREFIX}-edited`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: DEAD_ADMIN_URLS.edited,
    admin_key: 'unused-by-this-spec',
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  // Set one.
  await adminPom.rowByText(page, name).getByRole('button', { name: 'Edit' }).click();
  const field = page.getByLabel('Control API URL');
  await expect(field).toHaveValue('');
  await field.fill(CONTROL_URL);
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect
    .poll(async () => (await instanceByName(name))?.control_api_url)
    .toBe(CONTROL_URL);

  // Reloaded first: the row the modal fills from is the one the browser holds,
  // and polling the API says nothing about whether it has been refetched.
  await page.reload();
  await adminPom.isInstancesPage(page);

  // It comes back into the form, rather than being written once and forgotten.
  await adminPom.rowByText(page, name).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Control API URL')).toHaveValue(CONTROL_URL);

  // And take it away: a gateway can stop exposing that port, and the record
  // has to be able to say so. An empty field that meant "leave it alone" would
  // strand the old address there for good.
  await page.getByLabel('Control API URL').fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect.poll(async () => (await instanceByName(name))?.control_api_url).toBe('');
});

test('an instance seeded with an address keeps it', async () => {
  // Through the same helper the fixtures use, which is the path that matters:
  // it dropped the field on the way to the API, so the local gateway was
  // registered without one and nothing failed - the health column would simply
  // have read "unknown" everywhere, CI included (#281).
  const name = `${PREFIX}-seeded`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: DEAD_ADMIN_URLS.seeded,
    admin_key: 'unused-by-this-spec',
    control_api_url: CONTROL_URL,
  });

  expect((await instanceByName(name))?.control_api_url).toBe(CONTROL_URL);
});

test('creates an instance without one, which is the ordinary case', async ({ page }) => {
  const name = `${PREFIX}-created`;
  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  await page.getByRole('button', { name: 'Add Instance' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Admin API URL').fill(DEAD_ADMIN_URLS.created);
  await page.getByLabel('Admin Key').fill('unused-by-this-spec');
  await page.getByRole('button', { name: 'Create Instance' }).click();

  await expect(adminPom.rowByText(page, name)).toBeVisible();
  await expect.poll(async () => (await instanceByName(name))?.control_api_url).toBe('');
});

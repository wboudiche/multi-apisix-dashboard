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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * Every column in the Column Display panel could be switched off, including all
 * of them at once, which left rows of action buttons with nothing identifying
 * the route they belonged to.
 */

const PROXY = '/api/v1/apisix/admin';
const NAMED_ID = 'e2e-columns-named';
const NAMELESS_ID = 'e2e-columns-unnamed';
const ROUTE_NAME = 'e2e-columns-named-route';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const seed = async (id: string, body: Record<string, unknown>) => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
      ...body,
    },
  });
};

test.beforeEach(async () => {
  await seed(NAMED_ID, { uri: '/e2e-columns-named', name: ROUTE_NAME });
  // APISIX does not require a name, so the pinned column has to cope with one
  // that has none.
  await seed(NAMELESS_ID, { uri: '/path-with-no-name' });
});

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const id of [NAMED_ID, NAMELESS_ID]) {
    await apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => null);
  }
});

test('keeps rows identifiable with every optional column switched off', async ({
  page,
}) => {
  await page.goto('/ui/routes');
  await expect(page.getByText(ROUTE_NAME)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Column Display' }).click();

  // Switch off every column that can be switched off. Addressed by label
  // rather than by index: the panel re-renders on each change, so positions
  // shift under a loop that counts.
  const optional = [
    // Name is attempted too: it is what used to be switchable, and being
    // refused here is the whole point. Without it this test would pass just as
    // well against the old behaviour.
    'Name',
    'ID',
    'Host',
    'Path',
    'Description',
    'Labels',
    'Version',
    'Status',
    'Update Time',
    'Plugin',
    'Team',
    'Operation',
  ];
  /* eslint-disable playwright/no-conditional-in-test --
     The branches here are setup, not assertions: the loop deliberately tries
     every column, including the pinned one, and depends on that one refusing.
     Skipping it up front would make this test pass against the old behaviour. */
  for (const label of optional) {
    const box = page.getByRole('checkbox', { name: label, exact: true });
    if (await box.isDisabled()) continue;
    if (await box.isChecked()) await box.uncheck();
  }
  /* eslint-enable playwright/no-conditional-in-test */

  // Name cannot be switched off, so it is still there to identify the row.
  await expect(page.getByText(ROUTE_NAME)).toBeVisible();

  // And a route with no name falls back to its id rather than a bare dash,
  // which would leave that row just as unidentifiable as before.
  await expect(page.getByText(NAMELESS_ID)).toBeVisible();
});

test('offers Name as a fixed column that cannot be unchecked', async ({ page }) => {
  await page.goto('/ui/routes');
  await expect(page.getByText(ROUTE_NAME)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Column Display' }).click();

  const nameBox = page.getByRole('checkbox', { name: 'Name' });
  await expect(nameBox).toBeChecked();
  await expect(nameBox).toBeDisabled();
});

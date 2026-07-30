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
import { expect, type Page } from '@playwright/test';

/**
 * Plugin Config ID was a free-text field, so attaching one meant knowing an
 * opaque id by heart. It is a dropdown now — but a developer has no
 * plugin_configs permission at all, so the field has to survive not being able
 * to list them rather than taking the route form down with it.
 */

const PROXY = '/api/v1/apisix/admin';
const CONFIG_ID = 'e2e-plugin-config-pick';
const CONFIG_NAME = 'e2e Rate Limiting Bundle';
const ROUTE_ID = 'e2e-plugin-config-route';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

/**
 * Opens the plugins step of a route's detail form, in edit mode.
 *
 * Order matters: the wizard only lets a step be clicked freely while the form
 * is read-only. Once editing, jumping forward re-validates every step in
 * between and silently stays put if any of them objects. So move to the step
 * first, then switch to editing — which leaves the active step alone.
 */
const openPluginsStep = async (page: Page) => {
  await page.goto(`/ui/routes/detail/${ROUTE_ID}`);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    ROUTE_ID,
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: 'Plugins Config' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
};

test.beforeEach(async () => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/plugin_configs/${CONFIG_ID}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      name: CONFIG_NAME,
      desc: 'limits and echoes',
      plugins: { 'limit-count': { count: 2, time_window: 60, rejected_code: 503 } },
    },
  });
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      uri: '/e2e-plugin-config',
      name: ROUTE_ID,
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
    },
  });
  // Owned, so the developer in the second test can open it at all.
  await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: { team_id: fx().backendTeamId },
  });
});

test.afterEach(async () => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
    method: 'DELETE',
    headers: onInstance(),
  }).catch(() => null);
  await apiFetch(`${PROXY}/plugin_configs/${CONFIG_ID}`, token, {
    method: 'DELETE',
    headers: onInstance(),
  }).catch(() => null);
});

test('picks a plugin config by name instead of typing its id', async ({ page }) => {
  await openPluginsStep(page);

  const field = page.getByRole('textbox', { name: 'Plugin Config ID' });
  await expect(field).toBeVisible({ timeout: 15000 });
  await field.click();

  // The option is identified by its name, with what it bundles underneath —
  // neither of which the old free-text input could show.
  const option = page.getByRole('option', { name: new RegExp(CONFIG_NAME) });
  await expect(option).toBeVisible();
  await expect(option).toContainText('limits and echoes');

  await option.click();
  await expect(field).toHaveValue(CONFIG_NAME);
});

test('still lets a developer set the id when the list cannot be read', async ({
  browser,
}) => {
  // A developer has no plugin_configs entry in RolePermissions, so listing them
  // 403s. The field must fall back to free text rather than leaving them with
  // an empty dropdown and no way to set it at all.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto('/ui/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(fx().users.dev.username);
    await page.getByPlaceholder('Enter your password').fill(fx().users.dev.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

    await openPluginsStep(page);

    const field = page.getByRole('textbox', { name: 'Plugin Config ID' });
    await expect(field).toBeVisible({ timeout: 15000 });

    // A searchable Select would also accept typing, so that alone proves
    // nothing. What distinguishes the fallback is that no dropdown opens at
    // all: the Select always renders one, even if only to say it is empty.
    await field.click();
    await expect(
      page.getByText('No plugin configs on this gateway yet')
    ).toHaveCount(0);

    await field.fill('some-known-config-id');
    await expect(field).toHaveValue('some-known-config-id');
  } finally {
    await context.close();
  }
});

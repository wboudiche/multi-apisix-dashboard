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
 * The Reassign Team dialog could only move a route between teams. Detaching it
 * is a separate outcome with a consequence worth stating, so the dialog warns
 * before it happens.
 */

const PROXY = '/api/v1/apisix/admin';
const ROUTE_ID = 'e2e-unassign-ui-route';
const fx = () => getFixtures();
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

const ownerOf = async (token: string): Promise<string> => {
  const res = (await apiFetch(`${PROXY}/routes`, token, {
    headers: onInstance(),
  })) as { list: { value: { id: string; __team_id?: string } }[] };
  return res.list.find((r) => r.value.id === ROUTE_ID)?.value.__team_id ?? '';
};

test.beforeEach(async () => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: {
      uri: '/e2e-unassign-ui',
      name: 'e2e-unassign-ui',
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
    },
  });
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
});

test('warns before detaching a route, then leaves it owned by no team', async ({
  page,
}) => {
  const token = await loginAdmin();
  expect(await ownerOf(token)).toBe(fx().backendTeamId);

  await page.goto(`/ui/routes/detail/${ROUTE_ID}`);
  await page.getByRole('button', { name: 'Reassign Team' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Nothing has changed yet, so the confirm button stays disabled.
  await expect(dialog.getByRole('button', { name: 'Reassign' })).toBeDisabled();

  // Choosing "No team" is what asks for a detach.
  await dialog.getByRole('textbox', { name: 'Select team' }).click();
  await page.getByRole('option', { name: 'No team' }).click();

  await expect(
    dialog.getByText(
      'Removing the team leaves this route owned by no team. It disappears from every non-admin list until an admin assigns it again.'
    )
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Remove team' }).click();
  await expect(dialog).toBeHidden();

  expect(await ownerOf(token)).toBe('');
});

test('a developer is not offered the reassign action at all', async ({ browser }) => {
  // The backend refuses reassignment from anyone but an admin, so offering the
  // button to a developer could only ever produce a 403.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto('/ui/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(fx().users.dev.username);
    await page.getByPlaceholder('Enter your password').fill(fx().users.dev.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

    await page.goto(`/ui/routes/detail/${ROUTE_ID}`);
    // Wait for the page to settle on something the developer can see.
    await expect(page.getByRole('button', { name: 'View JSON' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'Reassign Team' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

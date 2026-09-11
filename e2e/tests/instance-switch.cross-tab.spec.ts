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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, type Page, test } from '@playwright/test';

/**
 * Two tabs, one origin, one localStorage. The instance each tab works on is
 * its own — the header's atom — but the dashboard's own client, apiClient,
 * addressed every request from localStorage, which the last tab to switch
 * wrote. So a tab on local, after another tab switched to staging, sent its
 * writes to staging: the Reassign Team dialog on local's route changed the
 * ownership of that route id on staging, and the refetch, from local, showed
 * nothing had changed (#193).
 */

const PROXY = '/api/v1/apisix/admin';
const ROUTE_ID = randomId('e2e-cross-tab');
const fx = () => getFixtures();
const onLocal = () => ({ 'X-Instance-ID': fx().localInstanceId });

const ownerOnLocal = async (token: string): Promise<string> => {
  const res = (await apiFetch(`${PROXY}/routes`, token, {
    headers: onLocal(),
  })) as { list: { value: { id: string; __team_id?: string } }[] };
  return res.list.find((r) => r.value.id === ROUTE_ID)?.value.__team_id ?? '';
};

test.beforeAll(async () => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: {
      uri: `/${ROUTE_ID}`,
      name: ROUTE_ID,
      upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
    },
  });
  await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { team_id: fx().backendTeamId },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, token, {
    method: 'DELETE',
    headers: onLocal(),
  }).catch(() => null);
});

const switcher = (page: Page) =>
  page.locator('header input[placeholder="Select instance"]');

/**
 * In the header, the way a person would — not permission.switchInstance,
 * whose reload rebuilds the tab and hides exactly this.
 */
const switchInHeader = async (page: Page, instance: string) => {
  await switcher(page).click();
  await page.getByRole('option', { name: instance }).click();
  await expect(switcher(page)).toHaveValue(instance);
};

test('a tab keeps writing to its own instance after another tab switches', async ({
  browser,
}) => {
  // loginAs, a reload to pick the instance and two tabs' loads do not fit in
  // Playwright's 30s default.
  test.setTimeout(120_000);
  const token = await loginAdmin();
  expect(await ownerOnLocal(token)).toBe(fx().backendTeamId);

  const context = await browser.newContext({ storageState: undefined });
  try {
    const mine = await context.newPage();
    await permission.loginAs(mine, fx().users.admin.username, fx().users.admin.password);
    await permission.switchInstance(mine, 'Local APISIX');
    await mine.goto(`/ui/routes/detail/${ROUTE_ID}`);
    await expect(mine.getByRole('button', { name: 'Reassign Team' })).toBeVisible({
      timeout: 30000,
    });

    // Another tab of the same session switches to staging. It shares this
    // tab's localStorage, and writes it.
    const other = await context.newPage();
    await other.goto('/ui/routes');
    await switchInHeader(other, 'Staging APISIX');

    // This tab was not asked to switch, and says so.
    await expect(switcher(mine)).toHaveValue('Local APISIX');

    // Detach the route from its team, here, on local.
    await mine.getByRole('button', { name: 'Reassign Team' }).click();
    const dialog = mine.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Select team' }).click();
    await mine.getByRole('option', { name: 'No team' }).click();

    const write = mine.waitForRequest(
      (r) =>
        r.method() === 'PUT' &&
        r.url().includes(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`)
    );
    await dialog.getByRole('button', { name: 'Remove team' }).click();

    // Addressed to the instance this tab shows, and landed there.
    expect((await write).headers()['x-instance-id']).toBe(fx().localInstanceId);
    await expect(dialog).toBeHidden();
    await expect.poll(() => ownerOnLocal(token)).toBe('');
  } finally {
    await context.close();
  }
});

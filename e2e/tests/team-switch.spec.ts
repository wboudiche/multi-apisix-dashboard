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
import { consumerGroupsPom } from '@e2e/pom/consumer_groups';
import { permission } from '@e2e/pom/permission';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { uiFillMonacoEditor, uiGetMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

/**
 * The team an admin works with decides who owns what they create: for an
 * admin, the proxy takes X-Team-ID as the owner of a new resource. The header's
 * team switcher showed an atom derived from the instance alone, so picking a
 * team — which wrote localStorage and changed nothing the atom depended on —
 * left it showing the previous team. And both request clients read the team
 * from localStorage on every request, where the last tab to pick one had put
 * its own: a tab showing one team created resources owned by another (#195).
 */

const PROXY = '/api/v1/apisix/admin';
const GROUP_ID = randomId('e2e-team-tab');
const fx = () => getFixtures();
const onLocal = () => ({ 'X-Instance-ID': fx().localInstanceId });

const ownerOnLocal = async (token: string): Promise<string> => {
  const res = (await apiFetch(`${PROXY}/consumer_groups`, token, {
    headers: onLocal(),
  })) as { list: { value: { id: string; __team_id?: string } }[] };
  return res.list.find((r) => r.value.id === GROUP_ID)?.value.__team_id ?? '';
};

// The second test creates a consumer group; the first creates nothing.
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  const token = await loginAdmin();
  // The ownership record first: deleting the group does not remove it.
  await apiFetch(`/api/v1/apisix/ownership/consumer_groups/${GROUP_ID}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { team_id: '' },
  }).catch(() => null);
  await apiFetch(`${PROXY}/consumer_groups/${GROUP_ID}`, token, {
    method: 'DELETE',
    headers: onLocal(),
  }).catch(() => null);
});

// loginAs, a reload to pick the instance and the pages' own loads do not fit
// in Playwright's 30s default.
const TIMEOUT_MS = 120_000;

const teamSwitcher = (page: Page) =>
  page.locator('header input[placeholder="All Teams"]');

const pickTeam = async (page: Page, team: string) => {
  await teamSwitcher(page).click();
  await page.getByRole('option', { name: team, exact: true }).click();
};

const openAsAdminOnLocal = async (page: Page, path: string) => {
  await permission.loginAs(page, fx().users.admin.username, fx().users.admin.password);
  await permission.switchInstance(page, 'Local APISIX');
  await page.goto(path);
  await expect(teamSwitcher(page)).toBeVisible({ timeout: 30000 });
};

test('the header shows the team just picked', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAsAdminOnLocal(page, '/ui/routes');

    await pickTeam(page, 'Backend Team');
    await expect(teamSwitcher(page)).toHaveValue('Backend Team');
  } finally {
    await context.close();
  }
});

test('a resource created in one tab goes to that tab’s team, whatever another tab picks', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const token = await loginAdmin();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const mine = await context.newPage();
    await openAsAdminOnLocal(mine, '/ui/consumer_groups');
    await pickTeam(mine, 'Backend Team');

    // Another tab of the same session picks another team. It shares this
    // tab's localStorage, and writes it.
    const other = await context.newPage();
    await other.goto('/ui/routes');
    await expect(teamSwitcher(other)).toBeVisible({ timeout: 30000 });
    await pickTeam(other, 'Frontend Team');

    // Back here, create a consumer group — reached client-side: a reload
    // would start this tab over from the team every tab shares.
    await consumerGroupsPom.getAddConsumerGroupBtn(mine).click();
    await consumerGroupsPom.isAddPage(mine);
    await mine.getByRole('textbox', { name: 'ID', exact: true }).fill(GROUP_ID);

    // The form asks for at least one plugin.
    await mine.getByRole('button', { name: 'Select Plugins' }).click();
    const picker = mine.getByRole('dialog', { name: 'Select Plugins' });
    await picker.getByPlaceholder('Search').fill('basic-auth');
    await picker
      .getByTestId('plugin-basic-auth')
      .getByRole('button', { name: 'Add' })
      .click();
    const addPlugin = mine.getByRole('dialog', { name: 'Add Plugin' });
    await addPlugin.locator('label:has-text("JSON")').click();
    const editor = await uiGetMonacoEditor(mine, addPlugin);
    await uiFillMonacoEditor(mine, editor, '{"hide_credentials": true}');
    await addPlugin.getByRole('button', { name: 'Add' }).click();
    await expect(addPlugin).toBeHidden();

    const created = mine.waitForRequest(
      (r) =>
        r.method() === 'PUT' &&
        r.url().includes(`/apisix/admin/consumer_groups/${GROUP_ID}`)
    );
    await consumerGroupsPom.getAddBtn(mine).click();

    // Sent with this tab's team, and owned by it.
    expect((await created).headers()['x-team-id']).toBe(fx().backendTeamId);
    await consumerGroupsPom.isDetailPage(mine);
    await expect.poll(() => ownerOnLocal(token)).toBe(fx().backendTeamId);
  } finally {
    await context.close();
  }
});

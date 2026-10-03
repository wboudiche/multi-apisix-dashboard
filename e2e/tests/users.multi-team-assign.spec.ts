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
import { headerTeamSelect, permission } from '@e2e/pom/permission';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  HttpError,
  loginAdmin,
  type Team,
  type User,
  type UserInstance,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { roleText } from '@e2e/utils/ui/roles';
import { expect, type Page } from '@playwright/test';

/**
 * Giving a user several teams on one instance, as an admin does it: from no
 * access at all, through the Permissions modal, to what the user then sees.
 * The other multi-team specs start from an assignment written through the
 * API; this one writes it the way an admin does, and checks what the backend
 * refuses to store.
 */
const PREFIX = randomId('e2e-assign-teams');
const PASSWORD = 'e2e-Ass1gn-teams!';
const fx = () => getFixtures();

// One account, assigned in the first test and edited by the next ones.
test.describe.configure({ mode: 'serial' });

let teams: Team[];
let bob: User;

test.beforeAll(async () => {
  const admin = await loginAdmin();
  teams = [];
  for (const n of [1, 2, 3, 4]) {
    teams.push(await ensureTeam(admin, { name: `${PREFIX}-t${n}` }));
  }
  bob = await ensureUser(admin, { username: `${PREFIX}-bob`, password: PASSWORD });
});

test.afterAll(async () => {
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

const assignmentOf = async (user: User): Promise<UserInstance | undefined> => {
  const all = (await apiFetch(
    `/api/v1/user-access/${user.id}/instances`,
    await loginAdmin()
  )) as UserInstance[];
  return all.find((a) => a.instance_id === fx().localInstanceId);
};

const localInstanceCard = (page: Page) =>
  page
    .getByRole('dialog')
    .locator('.mantine-Paper-root')
    .filter({ hasText: 'Local APISIX' })
    .first();

// By role: once a team is picked the field has a "Clear teams" button, which
// a lookup by the label "Teams" matches as well.
const teamsField = (page: Page) =>
  localInstanceCard(page).getByRole('textbox', { name: 'Teams' });

const roleIn = (page: Page, team: Team) =>
  page
    .getByTestId(`team-roles-${fx().localInstanceId}`)
    .getByRole('radiogroup', { name: `Role in ${team.name}` });

const openPermissions = async (page: Page, user: User) => {
  await adminPom.toUsers(page);
  await adminPom
    .rowByText(page, user.username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
};

const pickRole = async (page: Page, role: 'developer' | 'viewer') => {
  await localInstanceCard(page).getByLabel('Role', { exact: true }).click();
  await page.getByRole('option', { name: roleText(role), exact: true }).click();
};

const pickTeams = async (page: Page, picked: Team[]) => {
  await teamsField(page).click();
  for (const team of picked) {
    await page.getByRole('option', { name: team.name, exact: true }).click();
  }
  // The list stays open for the next team, over the Save button. Escape
  // closes the list, not the dialog.
  await page.keyboard.press('Escape');
};

const save = async (page: Page) => {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);
};

const refusal = async (request: Promise<unknown>): Promise<HttpError | undefined> => {
  try {
    await request;
    return undefined;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
};

test('an admin gives a user three teams and a role in each, and the user can choose between them', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const [t1, t2, t3] = teams;
  expect(await assignmentOf(bob)).toBeUndefined();

  await openPermissions(page, bob);
  await pickRole(page, 'developer');
  // Not in the catalogue's order: the assignment keeps the order of the clicks.
  await pickTeams(page, [t3, t1, t2]);
  // Each new team takes the role field's.
  for (const team of [t1, t2, t3]) {
    await expect(roleIn(page, team).getByRole('radio', { name: roleText('developer') })).toBeChecked();
  }
  await roleIn(page, t2).getByText(roleText('viewer'), { exact: true }).click();
  await save(page);

  const stored = await assignmentOf(bob);
  expect(stored?.team_ids).toEqual([t3.id, t1.id, t2.id]);
  expect(stored?.team_roles).toEqual({
    [t1.id]: 'developer',
    [t2.id]: 'viewer',
    [t3.id]: 'developer',
  });
  // The strongest of them, for every check that does not know the team.
  expect(stored?.role).toBe('developer');

  const row = adminPom.rowByText(page, bob.username);
  for (const [team, role] of [
    [t1, 'developer'],
    [t2, 'viewer'],
    [t3, 'developer'],
  ] as const) {
    await expect(row.getByText(`${team.name} · ${roleText(role)}`, { exact: true })).toBeVisible();
  }

  // And the user, signed in, is offered those three teams and no other.
  const context = await browser.newContext({ storageState: undefined });
  try {
    const own = await context.newPage();
    await permission.loginAs(own, bob.username, PASSWORD);
    await permission.switchInstance(own, 'Local APISIX');
    await own.goto('/ui/routes');
    await expect(headerTeamSelect(own)).toBeVisible({ timeout: 30000 });
    await headerTeamSelect(own).click();
    await expect(own.getByRole('option')).toHaveText([
      i18n.t('header.allMyTeams'),
      `${t3.name} · ${roleText('developer')}`,
      `${t1.name} · ${roleText('developer')}`,
      `${t2.name} · ${roleText('viewer')}`,
    ]);
  } finally {
    await context.close();
  }
});

test('a team added later takes the role field’s, and changing that field sets every team to it', async ({
  page,
}) => {
  const [t1, t2, t3, t4] = teams;
  await openPermissions(page, bob);

  await pickTeams(page, [t4]);
  // The role field shows the strongest team role, developer, and a new team
  // takes it; the teams already there keep theirs.
  await expect(roleIn(page, t4).getByRole('radio', { name: roleText('developer') })).toBeChecked();
  await expect(roleIn(page, t2).getByRole('radio', { name: roleText('viewer') })).toBeChecked();
  await expect(roleIn(page, t1).getByRole('radio', { name: roleText('developer') })).toBeChecked();

  // The role field speaks for every team.
  await pickRole(page, 'viewer');
  for (const team of [t1, t2, t3, t4]) {
    await expect(roleIn(page, team).getByRole('radio', { name: roleText('viewer') })).toBeChecked();
  }
  await save(page);

  const stored = await assignmentOf(bob);
  expect(stored?.team_ids).toEqual([t3.id, t1.id, t2.id, t4.id]);
  expect(stored?.team_roles).toEqual({
    [t1.id]: 'viewer',
    [t2.id]: 'viewer',
    [t3.id]: 'viewer',
    [t4.id]: 'viewer',
  });
  expect(stored?.role).toBe('viewer');
});

test('a developer with no team is not saved', async ({ page }) => {
  const admin = await loginAdmin();
  const carol = await ensureUser(admin, { username: `${PREFIX}-carol`, password: PASSWORD });

  await openPermissions(page, carol);
  await pickRole(page, 'developer');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await uiHasToastMsg(page, { hasText: i18n.t('users.teamRequired') });
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  expect(await assignmentOf(carol)).toBeUndefined();
});

test('the backend refuses an assignment whose teams and roles do not add up, and keeps the one it had', async () => {
  const [t1, t2] = teams;
  const admin = await loginAdmin();
  const before = await assignmentOf(bob);
  expect(before?.team_ids).toHaveLength(4);

  const assign = (json: Record<string, unknown>) =>
    refusal(
      apiFetch(`/api/v1/user-access/${bob.id}/instances/${fx().localInstanceId}/role`, admin, {
        method: 'POST',
        json,
      })
    );

  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      'a role in a team the assignment does not hold',
      { role: 'developer', team_ids: [t1.id], team_roles: { [t2.id]: 'developer' } },
      /not one of the assignment's teams/,
    ],
    [
      'a role a team cannot hold',
      { role: 'developer', team_ids: [t1.id, t2.id], team_roles: { [t2.id]: 'instance_admin' } },
      /must be developer or viewer/,
    ],
    [
      'a team that does not exist, among teams that do',
      { role: 'developer', team_ids: [t1.id, `${PREFIX}-no-such-team`] },
      /Invalid team: .+ not found/,
    ],
    [
      'roles per team for an instance admin',
      { role: 'instance_admin', team_ids: [t1.id], team_roles: { [t1.id]: 'viewer' } },
      /not an instance admin/,
    ],
    ['a developer with no team', { role: 'developer', team_ids: [] }, /at least one team is required/],
  ];
  for (const [what, json, said] of cases) {
    const refused = await assign(json);
    expect(refused?.status, what).toBe(400);
    expect(refused?.message, what).toMatch(said);
    expect(await assignmentOf(bob), what).toEqual(before);
  }
});

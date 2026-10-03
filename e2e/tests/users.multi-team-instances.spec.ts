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
import { i18n } from '@e2e/utils/ui/i18n';
import { roleText } from '@e2e/utils/ui/roles';
import { expect, type Page } from '@playwright/test';

/**
 * One user, several teams, two instances. Teams are the dashboard's, not an
 * instance's, so the same team can be held on both with a different role, and
 * a team held on one instance is nothing on the other:
 *
 *        Local       Staging
 *   A    developer   viewer
 *   B    viewer      -
 *   C    -           developer
 *
 * users.multi-team-assign.spec.ts covers several teams on one instance; this
 * covers what a second instance changes, from the Permissions modal to the
 * proxy and the header.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-teams-inst');
const PASSWORD = 'e2e-Teams-1nst!pass';
const fx = () => getFixtures();
const LOCAL = 'Local APISIX';
const STAGING = 'Staging APISIX';
const on = (instanceId: string, team?: string) => ({
  'X-Instance-ID': instanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});
type Row = { value: { id: string; __team_id?: string } };

// One account, assigned in the first test and edited by the last.
test.describe.configure({ mode: 'serial' });

let a: Team;
let b: Team;
let c: Team;
let dana: User;
const danaToken = () => loginAdmin(`${PREFIX}-dana`, PASSWORD);
const local = () => fx().localInstanceId;
const staging = () => fx().stagingInstanceId;
// A route of each team on each instance, owned as an admin names it.
const routeOf = (instanceId: string, team: Team) =>
  `${PREFIX}-${instanceId === local() ? 'l' : 's'}-${team.name.slice(-1)}`;

test.beforeAll(async () => {
  const admin = await loginAdmin();
  a = await ensureTeam(admin, { name: `${PREFIX}-a` });
  b = await ensureTeam(admin, { name: `${PREFIX}-b` });
  c = await ensureTeam(admin, { name: `${PREFIX}-c` });
  dana = await ensureUser(admin, { username: `${PREFIX}-dana`, password: PASSWORD });
  for (const instanceId of [local(), staging()]) {
    for (const team of [a, b, c]) {
      const id = routeOf(instanceId, team);
      await apiFetch(`${PROXY}/routes/${id}`, admin, {
        method: 'PUT',
        headers: on(instanceId, team.id),
        json: route(id),
      });
    }
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  // What the teams own first: a team that still owns something cannot be deleted.
  for (const instanceId of [local(), staging()]) {
    for (const id of Object.keys(await listed(admin, on(instanceId)))) {
      await apiFetch(`${PROXY}/routes/${id}`, admin, {
        method: 'DELETE',
        headers: on(instanceId),
      }).catch(() => undefined);
    }
  }
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

const listed = async (token: string, headers: Record<string, string>) => {
  const res = (await apiFetch(`${PROXY}/routes?name=${PREFIX}&page_size=50`, token, {
    headers,
  })) as { list: Row[] };
  return Object.fromEntries(res.list.map((r) => [r.value.id, r.value.__team_id]));
};

const assignments = async (user: User) => {
  const all = (await apiFetch(
    `/api/v1/user-access/${user.id}/instances`,
    await loginAdmin()
  )) as UserInstance[];
  return Object.fromEntries(all.map((x) => [x.instance_id, x]));
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

const card = (page: Page, instance: string) =>
  page
    .getByRole('dialog')
    .locator('.mantine-Paper-root')
    .filter({ hasText: instance })
    .first();

// By role: once a team is picked the field has a "Clear teams" button, which
// a lookup by the label "Teams" matches as well.
const teamsField = (page: Page, instance: string) =>
  card(page, instance).getByRole('textbox', { name: 'Teams' });

const setRoleIn = async (page: Page, instanceId: string, team: Team, role: 'developer' | 'viewer') =>
  page
    .getByTestId(`team-roles-${instanceId}`)
    .getByRole('radiogroup', { name: `Role in ${team.name}` })
    .getByText(roleText(role), { exact: true })
    .click();

const openPermissions = async (page: Page) => {
  await adminPom.toUsers(page);
  await adminPom
    .rowByText(page, dana.username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
};

const assign = async (page: Page, instance: string, teams: Team[]) => {
  await card(page, instance).getByLabel('Role', { exact: true }).click();
  await page.getByRole('option', { name: roleText('developer'), exact: true }).click();
  await addTeams(page, instance, teams);
};

const addTeams = async (page: Page, instance: string, teams: Team[]) => {
  await teamsField(page, instance).click();
  for (const team of teams) {
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

test('an admin gives a user teams on two instances in one save, a role in each', async ({
  page,
}) => {
  await openPermissions(page);
  await assign(page, LOCAL, [a, b]);
  await setRoleIn(page, local(), b, 'viewer');
  await assign(page, STAGING, [a, c]);
  await setRoleIn(page, staging(), a, 'viewer');
  await save(page);

  const stored = await assignments(dana);
  expect(stored[local()]).toMatchObject({
    team_ids: [a.id, b.id],
    team_roles: { [a.id]: 'developer', [b.id]: 'viewer' },
    role: 'developer',
  });
  expect(stored[staging()]).toMatchObject({
    team_ids: [a.id, c.id],
    team_roles: { [a.id]: 'viewer', [c.id]: 'developer' },
    role: 'developer',
  });

  // The same team twice in the row, under the role it has on each instance.
  const row = adminPom.rowByText(page, dana.username);
  for (const chip of [
    `${a.name} · ${roleText('developer')}`,
    `${b.name} · ${roleText('viewer')}`,
    `${a.name} · ${roleText('viewer')}`,
    `${c.name} · ${roleText('developer')}`,
  ]) {
    await expect(row.getByText(chip, { exact: true })).toBeVisible();
  }
});

test('each instance answers for the teams held on it, with the role held on it', async () => {
  const token = await danaToken();

  // Lists: the teams held on that instance, whatever the role.
  expect(Object.keys(await listed(token, on(local()))).sort()).toEqual(
    [routeOf(local(), a), routeOf(local(), b)].sort()
  );
  expect(Object.keys(await listed(token, on(staging()))).sort()).toEqual(
    [routeOf(staging(), a), routeOf(staging(), c)].sort()
  );

  // A: a developer on Local, a viewer on Staging.
  const put = (instanceId: string, id: string, team?: string) =>
    apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'PUT',
      headers: on(instanceId, team),
      json: { ...route(id), desc: 'changed' },
    });
  expect(await refusal(put(local(), routeOf(local(), a)))).toBeUndefined();
  const readOnly = await refusal(put(staging(), routeOf(staging(), a)));
  expect(readOnly?.status).toBe(403);
  expect(readOnly?.message).toContain('team_read_only');
  // C is a developer team on Staging.
  expect(await refusal(put(staging(), routeOf(staging(), c)))).toBeUndefined();

  // A team held on the other instance only is not theirs to name here.
  const notHereC = await refusal(listed(token, on(local(), c.id)));
  expect(notHereC?.status).toBe(403);
  expect(notHereC?.message).toContain('team_not_assigned');
  const notHereB = await refusal(put(staging(), `${PREFIX}-s-new-b`, b.id));
  expect(notHereB?.status).toBe(403);
  expect(notHereB?.message).toContain('team_not_assigned');

  // With no team named, a create goes to the one team they develop in on that
  // instance: A on Local, C on Staging.
  await put(local(), `${PREFIX}-l-new`);
  await put(staging(), `${PREFIX}-s-new`);
  const admin = await loginAdmin();
  expect((await listed(admin, on(local())))[`${PREFIX}-l-new`]).toBe(a.id);
  expect((await listed(admin, on(staging())))[`${PREFIX}-s-new`]).toBe(c.id);
});

test('the header offers each instance’s teams, and keeps a pick per instance', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: undefined });
  const as = (team: Team, role: 'developer' | 'viewer') => `${team.name} · ${roleText(role)}`;
  try {
    const page = await context.newPage();
    const pick = async (option: string) => {
      await headerTeamSelect(page).click();
      await page.getByRole('option', { name: option, exact: true }).click();
      await expect(headerTeamSelect(page)).toHaveValue(option);
    };
    const offered = async (options: string[]) => {
      await headerTeamSelect(page).click();
      await expect(page.getByRole('option')).toHaveText([i18n.t('header.allMyTeams'), ...options]);
      await page.keyboard.press('Escape');
    };
    const addUpstream = page.getByRole('button', { name: 'Add Upstream', exact: true });

    await permission.loginAs(page, dana.username, PASSWORD);
    await permission.switchInstance(page, LOCAL);
    await page.goto(`${new URL(page.url()).origin}/ui/upstreams`);
    await expect(headerTeamSelect(page)).toBeVisible({ timeout: 30000 });
    await offered([as(a, 'developer'), as(b, 'viewer')]);
    await pick(as(b, 'viewer'));
    await expect(addUpstream).toHaveCount(0);

    // Staging: its own teams, and no pick carried over from Local.
    await permission.switchInstance(page, STAGING);
    await expect(headerTeamSelect(page)).toHaveValue(i18n.t('header.allMyTeams'), {
      timeout: 30000,
    });
    await offered([as(a, 'viewer'), as(c, 'developer')]);
    await pick(as(a, 'viewer'));
    await expect(addUpstream).toHaveCount(0);
    await pick(as(c, 'developer'));
    await expect(addUpstream).toBeVisible();

    // Back on Local, the pick made there.
    await permission.switchInstance(page, LOCAL);
    await expect(headerTeamSelect(page)).toHaveValue(as(b, 'viewer'), { timeout: 30000 });
  } finally {
    await context.close();
  }
});

test('editing one instance’s access leaves the other’s as it was', async ({ page }) => {
  const before = (await assignments(dana))[local()];

  // A team added on Staging only.
  await openPermissions(page);
  await addTeams(page, STAGING, [b]);
  await save(page);
  let stored = await assignments(dana);
  expect(stored[staging()]?.team_ids).toEqual([a.id, c.id, b.id]);
  expect(stored[local()]).toEqual(before);

  // Staging's access taken away: Local's stays, and Staging is no longer one
  // of theirs.
  await openPermissions(page);
  await card(page, STAGING).getByRole('button', { name: 'Clear role' }).click();
  await save(page);
  stored = await assignments(dana);
  expect(Object.keys(stored)).toEqual([local()]);
  expect(stored[local()]).toEqual(before);

  const instances = (await apiFetch('/api/v1/instances', await danaToken())) as { name: string }[];
  expect(instances.map((i) => i.name)).toEqual([LOCAL]);
});

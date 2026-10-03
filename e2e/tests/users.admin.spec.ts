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
/* eslint-disable playwright/no-wait-for-timeout -- matches auth.spec.ts's
   pattern for the post-login-attempt settle wait */
import { adminPom } from '@e2e/pom/admin';
import { permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import {
  adminToken,
  deleteTeamsByPrefix,
  deleteUsersByPrefix,
} from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { env } from '@e2e/utils/env';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  HttpError,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { globalRoleText, roleText } from '@e2e/utils/ui/roles';
import { expect, type Page } from '@playwright/test';

const PREFIX = randomId('adm-user');
const PASSWORD = 'e2e-Adm1n-pages!';
let teamName: string;
let teamId: string;

test.beforeAll(async () => {
  teamName = `${PREFIX}-team`;
  const team = await ensureTeam(await adminToken(), { name: teamName });
  teamId = team.id;
});

test.afterAll(async () => {
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

// The per-instance assignment card for Local APISIX inside the
// "Edit User & Permissions" modal.
const localInstanceCard = (page: Page) =>
  page
    .getByRole('dialog')
    .locator('.mantine-Paper-root')
    .filter({ hasText: 'Local APISIX' })
    .first();

// The Teams field of that card. By role: once a team is picked the field has
// a "Clear teams" button, which a lookup by the label "Teams" matches as well.
const teamsField = (page: Page) =>
  localInstanceCard(page).getByRole('textbox', { name: 'Teams' });

test('creates a user via the Add User modal', async ({ page }) => {
  const username = `${PREFIX}-created`;
  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);

  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.com`);
  // Targeted by placeholder: the page now also renders a "Temporary password"
  // field for the reset flow, so a label match on 'Password' finds both, and
  // this one is marked required so its label renders as "Password *".
  await page.getByPlaceholder('Enter secure password').fill(PASSWORD);
  // Global Role defaults to "User (Assign per-instance roles below)".
  await page.getByRole('button', { name: 'Create User' }).click();

  await expect(adminPom.rowByText(page, username)).toBeVisible();
});

test('assigns a per-instance viewer role through the Permissions modal', async ({
  page,
}) => {
  const username = `${PREFIX}-assign`;
  await ensureUser(await adminToken(), { username, password: PASSWORD });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await adminPom
    .rowByText(page, username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();

  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const card = localInstanceCard(page);
  await card.getByLabel('Role', { exact: true }).click();
  await page.getByRole('option', { name: 'Viewer', exact: true }).click();
  await teamsField(page).click();
  await page.getByRole('option', { name: teamName, exact: true }).click();
  // The field takes several teams (#301), so its list stays open for the next
  // one - over the button below. Escape closes the list, not the dialog.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  // The users table row now shows the assignment.
  const row = adminPom.rowByText(page, username);
  await expect(row.getByText('Local APISIX')).toBeVisible();
  await expect(row.getByText(`(${roleText('viewer')})`, { exact: true })).toBeVisible();
});

test('clearing a role removes the assignment, rather than reporting success and keeping it', async ({
  page,
}) => {
  // The Role select has always been clearable, and clearing it did nothing:
  // the save loop skips an entry with no role, so the dialog closed on
  // "Permissions updated successfully" with the access still in place. An
  // admin taking someone's access away was told it had worked.
  const username = `${PREFIX}-clear`;
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  const row = adminPom.rowByText(page, username);
  await expect(row.getByText(`(${roleText('viewer')})`, { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Permissions' }).click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const card = localInstanceCard(page);
  // By name: the clear button is the only way to take an access away here, so
  // it carries an aria-label rather than Mantine's aria-hidden default.
  await card.getByRole('button', { name: 'Clear role' }).click();
  await expect(card.getByLabel('Role', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  // The row says so — asserted on a row that is there, since an absent row
  // would satisfy the count on its own.
  const savedRow = adminPom.rowByText(page, username);
  await expect(savedRow).toBeVisible();
  await expect(savedRow.getByText(`(${roleText('viewer')})`, { exact: true })).toHaveCount(0);

  // …and so does the backend, which is the part that decides what this
  // account may do.
  const assignments = (await apiFetch(
    `/api/v1/user-access/${user.id}/instances`,
    token
  )) as unknown[];
  expect(assignments).toHaveLength(0);
});

test('creating a user after editing one grants the new account nothing', async ({
  page,
}) => {
  // The dialog is seeded from state that Add User did not clear, so opening it
  // on someone with a viewer role and then creating an account wrote that role
  // to the new account - on the Instance Access tab, which the dialog opens
  // behind. A silent grant, on the screen that exists to decide who may do
  // what.
  const existing = `${PREFIX}-seeded`;
  const created = `${PREFIX}-fresh`;
  const token = await adminToken();
  const user = await ensureUser(token, { username: existing, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  // The role has to be on the row before the dialog is opened: the table
  // renders before the per-user assignment reads land, and a dialog opened in
  // that window is seeded from nothing - which is the state this test is
  // supposed to find carried over.
  const seededRow = adminPom.rowByText(page, existing);
  await expect(seededRow.getByText(`(${roleText('viewer')})`, { exact: true })).toBeVisible();
  await seededRow.getByRole('button', { name: 'Permissions' }).click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();
  await page.getByLabel('Username').fill(created);
  await page.getByPlaceholder('Enter secure password').fill(PASSWORD);

  // Nothing carried over on the tab the operator does not see…
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  await expect(localInstanceCard(page).getByLabel('Role', { exact: true })).toHaveValue('');

  await page.getByRole('tab', { name: 'Basic Info' }).click();
  await page.getByRole('button', { name: 'Create User' }).click();
  await expect(adminPom.rowByText(page, created)).toBeVisible();

  // …and nothing was written for the new account either, which is the part
  // that decides what it may do.
  const users = (await apiFetch('/api/v1/users', token)) as { id: string; username: string }[];
  const fresh = users.find((u) => u.username === created);
  expect(fresh).toBeDefined();
  const assignments = (await apiFetch(
    `/api/v1/user-access/${fresh!.id}/instances`,
    token
  )) as unknown[];
  expect(assignments).toEqual([]);
});

test('saving a dialog opened before the assignments arrived removes nothing', async ({
  page,
}) => {
  // The table renders as soon as the users are read; the per-user assignment
  // reads follow. The Permissions button works in that window, and the dialog
  // it opens is seeded from what has arrived - nothing. Deciding removals
  // against the list as it stands at Save time instead, every role the form
  // does not show reads as one the admin cleared, and an e-mail change takes
  // the account's access away with a success toast on top.
  const username = `${PREFIX}-inflight`;
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  const roleWrites: string[] = [];
  await page.route('**/api/v1/user-access/*/instances/*/role', (route) => {
    roleWrites.push(route.request().method());
    return route.fallback();
  });
  // Held long enough for the dialog to be opened before they land - and they
  // do land, before the save: that is the shape of the race. A dialog seeded
  // from nothing, saved against a list that has since filled in.
  await page.route('**/api/v1/user-access/*/instances', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return route.fallback();
  });

  await adminPom.toUsers(page);
  await adminPom
    .rowByText(page, username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await expect(page.getByText('Edit User & Permissions')).toBeVisible();

  // The assignments arrive while the dialog sits open on an empty form.
  await expect(adminPom.rowByText(page, username).getByText(`(${roleText('viewer')})`, { exact: true })).toBeVisible({
    timeout: 20000,
  });

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);

  expect(roleWrites).toEqual([]);
  const assignments = (await apiFetch(
    `/api/v1/user-access/${user.id}/instances`,
    token
  )) as unknown[];
  expect(assignments).toHaveLength(1);
});

test('shows every team of an assignment, keeps them on a save, and takes one away when asked', async ({
  page,
}) => {
  // An assignment can hold several teams (#301). The form writes every
  // assignment back on any save, so while it showed one team, saving a user
  // rewrote [first, second] as [first]: a team lost to an edit that never
  // touched it. It shows the list and sends the list.
  const username = `${PREFIX}-two-teams`;
  const token = await adminToken();
  const second = await ensureTeam(token, { name: `${PREFIX}-team-2` });
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
    role: 'developer',
    team_ids: [teamId, second.id],
  });
  const stored = async () => {
    const assignments = (await apiFetch(`/api/v1/user-access/${user.id}/instances`, token)) as {
      team_ids: string[];
    }[];
    return assignments[0]?.team_ids;
  };
  const openPermissions = async () => {
    await adminPom.toUsers(page);
    const row = adminPom.rowByText(page, username);
    // Seeded from the assignment, not from the list before it arrived.
    await expect(row.getByText(`(${roleText('developer')})`, { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await row.getByRole('button', { name: 'Permissions' }).click();
    await expect(page.getByText('Edit User & Permissions')).toBeVisible();
  };

  // Both in the table...
  await adminPom.toUsers(page);
  const row = adminPom.rowByText(page, username);
  await expect(row.getByText(`${teamName} · ${roleText('developer')}`, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(
    row.getByText(`${PREFIX}-team-2 · ${roleText('developer')}`, { exact: true })
  ).toBeVisible();

  // ...and both in the form, which a save with nothing changed leaves alone.
  await openPermissions();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  // The MultiSelect's pills; the per-team role block names them too.
  const card = localInstanceCard(page);
  await expect(card.getByRole('button', { name: 'Clear teams' })).toBeVisible();
  await expect(card.getByText(teamName, { exact: true })).toHaveCount(2);
  await expect(card.getByText(`${PREFIX}-team-2`, { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);
  expect(await stored()).toEqual([teamId, second.id]);

  // Nor does unticking the first team and ticking it again: the first team of
  // the list is still the one the rest of the dashboard reads as the user's,
  // and the field alone would have moved it behind the second.
  await openPermissions();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  await teamsField(page).click();
  await page.getByRole('option', { name: teamName, exact: true }).click();
  await page.getByRole('option', { name: teamName, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);
  expect(await stored()).toEqual([teamId, second.id]);

  // Taking one team away takes that one, and leaves the other.
  await openPermissions();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  await teamsField(page).click();
  await page.getByRole('option', { name: teamName, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);
  expect(await stored()).toEqual([second.id]);

  // And giving it back adds it to the one that is there.
  await openPermissions();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  await teamsField(page).click();
  await page.getByRole('option', { name: teamName, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);
  // Behind the one that was there: what the assignment held stays where it
  // was, and what is added goes after it.
  expect(await stored()).toEqual([second.id, teamId]);
});

test('a viewer assignment takes effect: one instance, no create button', async ({
  page,
}) => {
  const username = `${PREFIX}-effect`;
  const fx = getFixtures();
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  await permission.loginAs(page, username, PASSWORD);

  // Only the assigned instance is offered.
  const select = adminPom.headerInstanceSelect(page);
  await expect(select).toHaveValue('Local APISIX');
  await select.click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Viewer write-gating: the routes page has no Create button
  // (ToAddPageBtn renders null when canCreate is false).
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await expect(routesPom.getAddRouteBtn(page)).toHaveCount(0);
});

test('upgrading the role to instance admin restores write access', async ({
  page,
}) => {
  const username = `${PREFIX}-upgrade`;
  const fx = getFixtures();
  const token = await adminToken();
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, fx.localInstanceId, {
    role: 'viewer',
    team_id: teamId,
  });

  // Upgrade via the UI as admin.
  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await adminPom
    .rowByText(page, username)
    .getByRole('button', { name: 'Permissions' })
    .click();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const card = localInstanceCard(page);
  await card.getByLabel('Role', { exact: true }).click();
  await page
    .getByRole('option', { name: roleText('instance_admin'), exact: true })
    .click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    adminPom
      .rowByText(page, username)
      .getByText(`(${roleText('instance_admin')})`, { exact: true })
  ).toBeVisible();

  // The upgrade is effective for the user.
  await permission.loginAs(page, username, PASSWORD);
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await expect(routesPom.getAddRouteBtn(page)).toBeVisible();
});

test('a deleted user can no longer log in', async ({ page }) => {
  const username = `${PREFIX}-deleted`;
  await ensureUser(await adminToken(), { username, password: PASSWORD });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  const row = adminPom.rowByText(page, username);
  await expect(row).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(adminPom.rowByText(page, username)).toHaveCount(0);

  // A login attempt with the deleted credentials stays on /login
  // (same assertion pattern as auth.spec.ts's invalid-credentials test).
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${env.E2E_TARGET_URL}login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/login/);
});

test('a deleted user leaves no assignment, and no team membership, behind', async () => {
  // Deleting a user removed its record and nothing else. Its instance
  // assignments — a role and a team each — stayed in etcd, and the team went
  // on listing as a member a user that no longer exists (#206).
  const fx = getFixtures();
  const token = await adminToken();
  const user = await ensureUser(token, {
    username: `${PREFIX}-leaves`,
    password: PASSWORD,
  });
  for (const instanceId of [fx.localInstanceId, fx.stagingInstanceId]) {
    await ensureUserInstanceRole(token, user.id, instanceId, {
      role: 'viewer',
      team_id: teamId,
    });
  }
  // `list` is null for a team with no members at all.
  const membershipsOfUser = async () => {
    const res = (await apiFetch(`/api/v1/teams/${teamId}/members`, token)) as {
      list: { user_id: string }[] | null;
    };
    return (res.list ?? []).filter((m) => m.user_id === user.id).length;
  };
  // Asserted first, so the absence below is not read off a list that never
  // had the user in it.
  expect(await membershipsOfUser()).toBe(2);

  await apiFetch(`/api/v1/users/${user.id}`, token, { method: 'DELETE' });

  expect(await membershipsOfUser()).toBe(0);
  expect(
    await apiFetch(`/api/v1/user-access/${user.id}/instances`, token)
  ).toEqual([]);
});

test('deleting a user nobody has is answered as not found', async () => {
  // etcd's delete of a missing key succeeds, so a stale or mistyped id was
  // answered "User deleted" (#210).
  const failure = await apiFetch(
    `/api/v1/users/${PREFIX}-nobody`,
    await adminToken(),
    { method: 'DELETE' }
  ).catch((e: unknown) => e);

  expect(failure).toBeInstanceOf(HttpError);
  expect((failure as HttpError).status).toBe(404);
});

test('a delete the backend refuses is reported, and the user stays listed', async ({
  page,
}) => {
  // The page read only a success: a refused delete closed the confirmation
  // and said nothing, the row still there as though the click had missed
  // (#210).
  const username = `${PREFIX}-refused`;
  const user = await ensureUser(await adminToken(), {
    username,
    password: PASSWORD,
  });
  // Refused here rather than by the backend. The refusal a real account can
  // provoke is deleting the last super admin, and against a backend without
  // the guard, trying it would take the suite's admin with it.
  const refusal = 'This is the only super admin. Promote another user before deleting this account.';
  await page.route(`**/api/v1/users/${user.id}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: refusal }),
        })
      : route.fallback()
  );

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  const row = adminPom.rowByText(page, username);
  await expect(row).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();

  await expect(
    page.locator('.mantine-Notification-root').filter({ hasText: refusal })
  ).toBeVisible({ timeout: 10000 });
  await expect(adminPom.rowByText(page, username)).toBeVisible();
});

/** The index of a column, found by the header the page gives it. */
const columnIndex = async (page: Page, header: string) => {
  // Waited for first: count() does not retry, so a table that has not mounted
  // yet would make this throw "no such column" at a page that still has one.
  await expect(
    page.getByRole('columnheader', { name: header, exact: true })
  ).toBeVisible();
  const headers = page.getByRole('columnheader');
  const count = await headers.count();
  for (let i = 0; i < count; i += 1) {
    if (((await headers.nth(i).textContent()) ?? '').trim() === header) return i;
  }
  throw new Error(`the users table has no "${header}" column`);
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the table dates an account and names its role', async ({ page }) => {
  // Nothing dated a user record: accounts created here and the bootstrap admin
  // alike were stored with Go's zero time, and the page formatted it as a real
  // date - every account created on 01/01/1. The Role cell, meanwhile, rendered
  // the global role verbatim, which is empty for every account whose access
  // comes from its per-instance assignments: a badge with a shield and no text
  // (#300).
  const plain = `${PREFIX}-dated`;
  const superAdmin = `${PREFIX}-super`;
  const token = await adminToken();

  // The stamp lands between these two readings, so a run that crosses local
  // midnight has two acceptable dates rather than one wrong one.
  const before = Date.now();
  await ensureUser(token, { username: plain, password: PASSWORD });
  await ensureUser(token, {
    username: superAdmin,
    password: PASSWORD,
    role: 'super_admin',
  });
  const after = Date.now();

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);

  // Formatted in the browser, so the assertion is in the locale the cell
  // formats for rather than the one this process happens to run in.
  const days = await page.evaluate(
    (bounds) => bounds.map((ms) => new Date(ms).toLocaleDateString()),
    [before, after]
  );
  const dated = new RegExp(`^(${[...new Set(days)].map(escapeRegExp).join('|')})$`);
  const zeroTime = await page.evaluate(() =>
    new Date('0001-01-01T00:00:00Z').toLocaleDateString()
  );

  const role = await columnIndex(page, 'Role');
  const created = await columnIndex(page, 'Created');
  const cells = (username: string) =>
    adminPom.rowByText(page, username).getByRole('cell');

  await expect(cells(plain).nth(role)).toHaveText(globalRoleText());
  await expect(cells(plain).nth(created)).toHaveText(dated);
  await expect(cells(superAdmin).nth(role)).toHaveText(roleText('super_admin'));
  await expect(cells(superAdmin).nth(created)).toHaveText(dated);

  // And no row anywhere claims the zero time as a date, whatever the locale
  // renders it as - including accounts stored before anything stamped them,
  // whose real date is gone and is now left unknown.
  await expect(page.getByText(zeroTime, { exact: true })).toHaveCount(0);
});

test('an account stored before the dates existed reads as unknown', async ({
  page,
}) => {
  // The accounts already in etcd carry no dates at all, and their real ones
  // are gone. They unmarshal to Go's zero time, which the page formatted like
  // any other date and showed as 01/01/1 (#300). Nothing here backfills them:
  // a date nobody set, shown as though someone had, is worse than saying so.
  const username = `${PREFIX}-undated`;

  // Added to the response rather than written to etcd: what this test is about
  // is the shape - a record with no dates, which Go serializes as the zero
  // time - and fabricating it here keeps the spec off an etcd of its own, the
  // way the refused-delete test above fabricates its refusal.
  await page.route(/\/api\/v1\/users(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const users = (await response.json()) as unknown[];
    return route.fulfill({
      response,
      json: [
        ...users,
        {
          id: `${PREFIX}-undated-id`,
          username,
          email: `${username}@example.com`,
          role: '',
          created_at: '0001-01-01T00:00:00Z',
          updated_at: '0001-01-01T00:00:00Z',
        },
      ],
    });
  });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  // By header, not by position: this row renders the same dash in Instances,
  // in Teams and in Created, so an index off by one would still read one.
  const created = await columnIndex(page, 'Created');
  const cells = adminPom.rowByText(page, username).getByRole('cell');
  await expect(cells.nth(created)).toHaveText('—');
});

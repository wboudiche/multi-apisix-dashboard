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
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
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

test('creates a user via the Add User modal', async ({ page }) => {
  const username = `${PREFIX}-created`;
  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);

  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.com`);
  await page.getByLabel('Password').fill(PASSWORD);
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
  await card.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Viewer', exact: true }).click();
  await card.getByLabel('Team').click();
  await page.getByRole('option', { name: teamName }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();

  // The users table row now shows the assignment.
  const row = adminPom.rowByText(page, username);
  await expect(row.getByText('Local APISIX')).toBeVisible();
  await expect(row.getByText('(viewer)')).toBeVisible();
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
  await card.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Instance Admin', exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    adminPom.rowByText(page, username).getByText('(instance admin)')
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

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
import { adminToken, deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  HttpError,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

const PREFIX = randomId('adm-team');

test.afterAll(async () => {
  // Users first: a team an assignment names is not deleted.
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

test('creates a team via the Add Team modal', async ({ page }) => {
  const teamName = `${PREFIX}-created`;
  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);

  await page.getByRole('button', { name: 'Add Team' }).click();
  await expect(page.getByText('Add New Team')).toBeVisible();
  await page.getByLabel('Team Name').fill(teamName);
  await page.getByLabel('Description').fill('created by teams.admin e2e');
  await page.getByRole('button', { name: 'Create Team' }).click();

  await uiHasToastMsg(page, { hasText: 'Team created successfully' });
  await expect(adminPom.rowByText(page, teamName)).toBeVisible();
});

test('deletes a team from the table', async ({ page }) => {
  const teamName = `${PREFIX}-to-delete`;
  await ensureTeam(await adminToken(), { name: teamName });

  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);
  const row = adminPom.rowByText(page, teamName);
  await expect(row).toBeVisible();

  // Teams page uses native confirm() for deletion.
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();

  await uiHasToastMsg(page, { hasText: 'Team deleted successfully' });
  await expect(adminPom.rowByText(page, teamName)).toHaveCount(0);
});

test('rejects creating a team with an empty name', async ({ page }) => {
  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);

  await page.getByRole('button', { name: 'Add Team' }).click();
  await expect(page.getByText('Add New Team')).toBeVisible();
  // Name left empty on purpose.
  await page.getByRole('button', { name: 'Create Team' }).click();

  await uiHasToastMsg(page, { hasText: 'Team name is required' });
  // The modal stays open — nothing was created.
  await expect(page.getByText('Add New Team')).toBeVisible();
});

test('a team an assignment names is not deleted, and the page says why', async ({ page }) => {
  // Deleting a team looked at what it owned and at nothing else, so the
  // assignments that named it went on naming it once it was gone: an account
  // that saw nothing, or - with several teams - one told to choose a team its
  // header no longer offered (#375).
  const teamName = `${PREFIX}-has-member`;
  const token = await adminToken();
  const team = await ensureTeam(token, { name: teamName });
  const other = await ensureTeam(token, { name: `${PREFIX}-other` });
  const user = await ensureUser(token, {
    username: `${PREFIX}-member`,
    password: 'e2e-Team-m3mber!pass',
  });
  const assign = (teamIds: string[]) =>
    ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
      role: 'developer',
      team_ids: teamIds,
    });
  await assign([team.id, other.id]);

  // The API refuses it, and says which refusal it is and who stands in the
  // way.
  let refused: HttpError | undefined;
  await apiFetch(`/api/v1/teams/${team.id}`, token, { method: 'DELETE' }).catch((err) => {
    refused = err as HttpError;
  });
  expect(refused?.status).toBe(409);
  expect(refused?.message).toContain('"code":"team_has_members"');
  expect(refused?.message).toContain('"count":1');
  expect(refused?.message).toContain(`"users":["${PREFIX}-member"]`);

  await adminPom.toTeams(page);
  await adminPom.isTeamsPage(page);
  const row = adminPom.rowByText(page, teamName);
  await expect(row).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();

  // In the reader's language, naming who, with what to do - not "Failed to
  // delete team".
  await uiHasToastMsg(page, {
    hasText: i18n.t('teams.deleteHasMembers', { users: `${PREFIX}-member` }),
  });
  await expect(adminPom.rowByText(page, teamName)).toBeVisible();

  // The operator moves the user off the team; then it goes.
  await assign([other.id]);
  await row.getByRole('button', { name: 'Delete' }).click();
  await uiHasToastMsg(page, { hasText: 'Team deleted successfully' });
  await expect(adminPom.rowByText(page, teamName)).toHaveCount(0);
});

test('an assignment nobody can be asked to move does not keep a team, nor go on naming it', async () => {
  // A super admin's assignments are never read - the role is global - and the
  // Users page does not offer them for editing. Counted, one made the team
  // undeletable behind "move those users first"; skipped, it went on naming
  // the team after it was gone, and came back to life the day the account was
  // demoted. The delete takes the team out of it.
  const token = await adminToken();
  const team = await ensureTeam(token, { name: `${PREFIX}-released` });
  const kept = await ensureTeam(token, { name: `${PREFIX}-released-kept` });
  const user = await ensureUser(token, {
    username: `${PREFIX}-root`,
    password: 'e2e-Team-r00t!pass',
    role: 'super_admin',
  });
  await ensureUserInstanceRole(token, user.id, getFixtures().localInstanceId, {
    role: 'developer',
    team_ids: [team.id, kept.id],
  });

  await apiFetch(`/api/v1/teams/${team.id}`, token, { method: 'DELETE' });

  const assignments = (await apiFetch(`/api/v1/user-access/${user.id}/instances`, token)) as {
    team_ids: string[];
  }[];
  expect(assignments).toHaveLength(1);
  expect(assignments[0].team_ids).toEqual([kept.id]);
});

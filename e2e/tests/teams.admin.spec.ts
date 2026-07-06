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
import { adminToken, deleteTeamsByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureTeam } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

const PREFIX = randomId('adm-team');

test.afterAll(async () => {
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

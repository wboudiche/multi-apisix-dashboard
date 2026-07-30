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
import { randomId } from '@e2e/utils/common';
import { apiFetch, loginAdmin, type Team } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The Teams screen could only create and delete. These cover the Edit action
 * end to end, in the browser, since a modal that fails to render type-checks
 * perfectly well.
 */

const gotoTeams = async (page: import('@playwright/test').Page) => {
  await page.goto('/ui/teams');
  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
};

const rowFor = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

test('edits a team name and description from the Teams screen', async ({ page }) => {
  const token = await loginAdmin();
  const original = randomId('e2e-ui-team');
  const created = (await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: { name: original, description: 'before' },
  })) as Team;

  // Deliberately not derived from `original`: hasText matches substrings, so a
  // name containing the old one would still match the pre-rename row.
  const renamed = randomId('e2e-ui-after');

  try {
    await gotoTeams(page);
    await expect(rowFor(page, original)).toHaveCount(1);

    await rowFor(page, original).getByRole('button', { name: 'Edit' }).click();

    // The modal opens in edit mode, prefilled with the team being edited.
    await expect(page.getByRole('heading', { name: 'Edit Team' })).toBeVisible();
    const nameField = page.getByLabel('Team Name');
    await expect(nameField).toHaveValue(original);

    await nameField.fill(renamed);
    await page.getByLabel('Description').fill('after');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(rowFor(page, renamed)).toHaveCount(1);
    await expect(rowFor(page, renamed)).toContainText('after');
    await expect(rowFor(page, original)).toHaveCount(0);
  } finally {
    await apiFetch(`/api/v1/teams/${created.id}`, token, { method: 'DELETE' }).catch(
      () => null
    );
  }
});

test('the Add modal is still a create, not an edit of the last team opened', async ({
  page,
}) => {
  const token = await loginAdmin();
  const existing = randomId('e2e-ui-reset');
  const created = (await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: { name: existing, description: 'untouched' },
  })) as Team;

  try {
    await gotoTeams(page);

    // Open Edit, dismiss it, then open Add: the form must come back empty and
    // in create mode rather than still pointing at the team just opened.
    await rowFor(page, existing).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add Team' }).click();

    await expect(page.getByRole('heading', { name: 'Add New Team' })).toBeVisible();
    await expect(page.getByLabel('Team Name')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible();
  } finally {
    await apiFetch(`/api/v1/teams/${created.id}`, token, { method: 'DELETE' }).catch(
      () => null
    );
  }
});

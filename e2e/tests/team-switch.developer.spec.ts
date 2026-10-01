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
import { consumersPom } from '@e2e/pom/consumers';
import { headerTeamSelect, permission } from '@e2e/pom/permission';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
  type Team,
} from '@e2e/utils/seed-client';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page, test } from '@playwright/test';

/**
 * A developer can work for several teams on one instance (#301), and the
 * backend reads their X-Team-ID as which of those teams a request is for. The
 * header had nothing to say it with: the team switcher was an admin's, fed by
 * a catalogue everyone else is refused. So a developer with two teams saw both
 * teams' resources and could create nothing - a new resource has one owner,
 * and they had no way to name it.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-dev-teams');
const PASSWORD = 'e2e-Dev-t3ams!pass';
// A consumer's name takes letters, digits and underscores.
const CONSUMER = `e2e_dev_teams_${Date.now().toString(36)}`;
const fx = () => getFixtures();
const onLocal = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});

// loginAs, a reload to pick the instance and the pages' own loads do not fit
// in Playwright's 30s default.
const TIMEOUT_MS = 120_000;

// One account, signed in for each test; the last one writes.
test.describe.configure({ mode: 'serial' });

let first: Team;
let second: Team;
const routeOf = { first: `${PREFIX}-a`, second: `${PREFIX}-b` };

test.beforeAll(async () => {
  const admin = await loginAdmin();
  first = await ensureTeam(admin, { name: `${PREFIX}-a-team` });
  second = await ensureTeam(admin, { name: `${PREFIX}-b-team` });
  const user = await ensureUser(admin, { username: `${PREFIX}-dev`, password: PASSWORD });
  await ensureUserInstanceRole(admin, user.id, fx().localInstanceId, {
    role: 'developer',
    team_ids: [first.id, second.id],
  });
  // One route for each team: for an admin, X-Team-ID is the owner a write records.
  await apiFetch(`${PROXY}/routes/${routeOf.first}`, admin, {
    method: 'PUT',
    headers: onLocal(first.id),
    json: route(routeOf.first),
  });
  await apiFetch(`${PROXY}/routes/${routeOf.second}`, admin, {
    method: 'PUT',
    headers: onLocal(second.id),
    json: route(routeOf.second),
  });
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  // What the teams own first: a team that still owns something cannot be deleted.
  for (const path of [`routes/${routeOf.first}`, `routes/${routeOf.second}`, `consumers/${CONSUMER}`]) {
    await apiFetch(`${PROXY}/${path}`, admin, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
  await deleteUsersByPrefix(PREFIX);
  await deleteTeamsByPrefix(PREFIX);
});

const openAsDeveloper = async (page: Page, path: string) => {
  await permission.loginAs(page, `${PREFIX}-dev`, PASSWORD);
  await permission.switchInstance(page, 'Local APISIX');
  await page.goto(path);
  await expect(headerTeamSelect(page)).toBeVisible({ timeout: 30000 });
};

const pickTeam = async (page: Page, team: string) => {
  await headerTeamSelect(page).click();
  await page.getByRole('option', { name: team, exact: true }).click();
};

const ownerOf = async (consumer: string): Promise<string | undefined> => {
  const res = (await apiFetch(`${PROXY}/consumers/${consumer}`, await loginAdmin(), {
    headers: onLocal(),
  })) as { value: { __team_id?: string } };
  return res.value.__team_id;
};

test('a developer with several teams chooses between their own, and the lists follow', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAsDeveloper(page, `/ui/routes?name=${PREFIX}`);

    // None picked: everything that is theirs, each under its team's name -
    // which the list could not show them before, the catalogue being an
    // admin's.
    await expect(headerTeamSelect(page)).toHaveValue(i18n.t('header.allMyTeams'));
    const rowOf = (id: string) => page.getByRole('row').filter({ hasText: id });
    await expect(rowOf(routeOf.first)).toBeVisible({ timeout: 30000 });
    await expect(rowOf(routeOf.second)).toBeVisible();
    await expect(rowOf(routeOf.first).getByText(first.name, { exact: true })).toBeVisible();
    await expect(rowOf(routeOf.second).getByText(second.name, { exact: true })).toBeVisible();

    // Their two teams and "all of them" - not the catalogue.
    await headerTeamSelect(page).click();
    await expect(page.getByRole('option')).toHaveText([
      i18n.t('header.allMyTeams'),
      first.name,
      second.name,
    ]);
    await page.getByRole('option', { name: second.name, exact: true }).click();

    await expect(headerTeamSelect(page)).toHaveValue(second.name);
    await expect(rowOf(routeOf.second)).toBeVisible();
    await expect(rowOf(routeOf.first)).toBeHidden();

    // And after a reload. The pick is in storage at once; the teams it is
    // checked against arrive with the header, after the list was first asked
    // for. The list is asked again when they do - or the header would read
    // the second team over both teams' routes.
    await page.reload();
    await expect(headerTeamSelect(page)).toHaveValue(second.name, { timeout: 30000 });
    await expect(rowOf(routeOf.second)).toBeVisible({ timeout: 30000 });
    await expect(rowOf(routeOf.first)).toBeHidden();
  } finally {
    await context.close();
  }
});

test('creating with no team picked asks for one, and with one picked the resource is that team’s', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAsDeveloper(page, '/ui/consumers/add');
    await consumersPom.isAddPage(page);
    await page.getByRole('textbox', { name: 'Username' }).fill(CONSUMER);

    // A new resource has one owner, and they have not said which team.
    // Refused before the gateway, and told in their own language where to
    // say it - not in the backend's English.
    await consumersPom.getAddBtn(page).click();
    await uiHasToastMsg(page, { hasText: i18n.t('error.teamRequired') });
    await consumersPom.isAddPage(page);

    // Said, in the header, with the form as they left it.
    await pickTeam(page, second.name);
    await expect(page.getByRole('textbox', { name: 'Username' })).toHaveValue(CONSUMER);
    await consumersPom.getAddBtn(page).click();
    await consumersPom.isDetailPage(page);

    expect(await ownerOf(CONSUMER)).toBe(second.id);
  } finally {
    await context.close();
  }
});

test('a developer with one team is shown its name, and has nothing to choose', async ({
  browser,
}) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await permission.loginAs(page, fx().users.dev.username, fx().users.dev.password);
    await permission.switchInstance(page, 'Local APISIX');
    await page.goto('/ui/routes');

    await expect(page.locator('header').getByTestId('team-badge')).toHaveText('Backend Team', {
      timeout: 30000,
    });
    await expect(headerTeamSelect(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a developer whose other team was deleted can still create, for the team that is left', async ({
  browser,
}) => {
  // Deleting a team does not look at the assignments that name it (#375). To
  // the backend this account still has two teams, and a create has to say
  // which; to the header it has one, and nothing to choose. The one that is
  // left is sent, or every create would be refused with "choose a team" under
  // a header offering none.
  test.setTimeout(TIMEOUT_MS);
  const admin = await loginAdmin();
  const prefix = randomId('e2e-dev-gone');
  const kept = await ensureTeam(admin, { name: `${prefix}-kept` });
  const gone = await ensureTeam(admin, { name: `${prefix}-gone` });
  const user = await ensureUser(admin, { username: `${prefix}-dev`, password: PASSWORD });
  await ensureUserInstanceRole(admin, user.id, fx().localInstanceId, {
    role: 'developer',
    team_ids: [gone.id, kept.id],
  });
  await apiFetch(`/api/v1/teams/${gone.id}`, admin, { method: 'DELETE' });
  const consumer = `e2e_dev_gone_${Date.now().toString(36)}`;
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await permission.loginAs(page, `${prefix}-dev`, PASSWORD);
    await permission.switchInstance(page, 'Local APISIX');
    await page.goto('/ui/consumers/add');
    await expect(page.locator('header').getByTestId('team-badge')).toHaveText(kept.name, {
      timeout: 30000,
    });

    await consumersPom.isAddPage(page);
    await page.getByRole('textbox', { name: 'Username' }).fill(consumer);
    await consumersPom.getAddBtn(page).click();
    await consumersPom.isDetailPage(page);
    expect(await ownerOf(consumer)).toBe(kept.id);
  } finally {
    await context.close();
    await apiFetch(`${PROXY}/consumers/${consumer}`, admin, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
    await deleteUsersByPrefix(prefix);
    await deleteTeamsByPrefix(prefix);
  }
});

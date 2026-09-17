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
import { adminToken, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
} from '@e2e/utils/seed-client';
import { uiFillMonacoEditor, uiGetMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

/**
 * The team an admin works with decides who owns what they create: for an
 * admin, the proxy records X-Team-ID as the owner of a new resource (#260).
 * The header's team switcher showed an atom derived from the instance alone,
 * so picking a team — which wrote localStorage and changed nothing the atom
 * depended on — left it showing the previous team. And both request clients
 * read the team from localStorage on every request, where the last tab to
 * pick one had put its own: a tab showing one team created resources owned by
 * another (#195). An account with no switcher still sent a team, and a pick
 * outlived the account that made it (#203). And a tab left open kept the
 * account it had opened with after another tab signed in as someone else
 * (#205).
 */

const PROXY = '/api/v1/apisix/admin';
const GROUP_TWO_TABS = randomId('e2e-team-tab');
const GROUP_INSTANCE_ADMIN = randomId('e2e-team-iadmin');
const GROUP_IDLE_TAB = randomId('e2e-team-idle');
const fx = () => getFixtures();
const onLocal = () => ({ 'X-Instance-ID': fx().localInstanceId });
const PASSWORD = 'E2e-Team!Admin#1';

// undefined when the group is not listed at all, so that "no owner" cannot
// be read off a group that is not there.
const ownerOnLocal = async (
  token: string,
  id: string
): Promise<string | undefined> => {
  const res = (await apiFetch(`${PROXY}/consumer_groups`, token, {
    headers: onLocal(),
  })) as { list: { value: { id: string; __team_id?: string } }[] };
  const row = res.list.find((r) => r.value.id === id);
  return row ? (row.value.__team_id ?? '') : undefined;
};

// The tests create consumer groups and sign in and out; one at a time.
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const id of [GROUP_TWO_TABS, GROUP_INSTANCE_ADMIN, GROUP_IDLE_TAB]) {
    // Its ownership record goes with it (#248).
    await apiFetch(`${PROXY}/consumer_groups/${id}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => null);
  }
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

/**
 * Sign in from the login form this tab is already on, after a sign-out from
 * the header menu: no reload and no cleared storage — permission.loginAs does
 * both, and would hide exactly what these tests are about.
 */
const signInHere = async (page: Page, username: string, password: string) => {
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 15000,
  });
};

/** From the consumer groups list, create one with a minimal plugin. */
const createConsumerGroup = async (page: Page, id: string) => {
  await consumerGroupsPom.getAddConsumerGroupBtn(page).click();
  await consumerGroupsPom.isAddPage(page);
  await page.getByRole('textbox', { name: 'ID', exact: true }).fill(id);

  // The form asks for at least one plugin.
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const picker = page.getByRole('dialog', { name: 'Select Plugins' });
  await picker.getByPlaceholder('Search').fill('basic-auth');
  await picker
    .getByTestId('plugin-basic-auth')
    .getByRole('button', { name: 'Add' })
    .click();
  const addPlugin = page.getByRole('dialog', { name: 'Add Plugin' });
  await addPlugin.locator('label:has-text("JSON")').click();
  const editor = await uiGetMonacoEditor(page, addPlugin);
  await uiFillMonacoEditor(page, editor, '{"hide_credentials": true}');
  await addPlugin.getByRole('button', { name: 'Add' }).click();
  await expect(addPlugin).toBeHidden();

  const created = page.waitForRequest(
    (r) =>
      r.method() === 'PUT' &&
      r.url().includes(`/apisix/admin/consumer_groups/${id}`)
  );
  await consumerGroupsPom.getAddBtn(page).click();
  const request = await created;
  await consumerGroupsPom.isDetailPage(page);
  return request;
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
    const created = await createConsumerGroup(mine, GROUP_TWO_TABS);

    // Sent with this tab's team, and owned by it.
    expect(created.headers()['x-team-id']).toBe(fx().backendTeamId);
    await expect
      .poll(() => ownerOnLocal(token, GROUP_TWO_TABS))
      .toBe(fx().backendTeamId);
  } finally {
    await context.close();
  }
});

test('a new session in the same tab starts with no team picked', async ({
  browser,
}) => {
  // A pick belongs to the account that made it. Signing out from the header
  // menu and back in happens in one tab, without a reload, and the pick —
  // this tab's, and the one it stored — carried over into the next session
  // (#203).
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAsAdminOnLocal(page, '/ui/routes');
    await pickTeam(page, 'Frontend Team');
    await expect(teamSwitcher(page)).toHaveValue('Frontend Team');

    await permission.logout(page);
    await signInHere(page, fx().users.admin.username, fx().users.admin.password);

    await expect(teamSwitcher(page)).toHaveValue('All Teams', { timeout: 30000 });
  } finally {
    await context.close();
  }
});

test('an instance admin, who has no team switcher, sends no team', async ({
  browser,
}) => {
  // The proxy treats an instance admin as an admin and records its
  // X-Team-ID as the owner of what it creates; but only a super admin gets the
  // teams list, and so a switcher. Here a super admin picks Frontend and signs
  // out, and an instance admin signs in, in the same tab, and creates a
  // consumer group: it went to Frontend, under a header showing no team at
  // all (#203).
  test.setTimeout(TIMEOUT_MS);
  const prefix = randomId('e2e-team-iadmin-user');
  const setup = await adminToken();
  const user = await ensureUser(setup, {
    username: `${prefix}-user`,
    password: PASSWORD,
  });
  await ensureUserInstanceRole(setup, user.id, fx().localInstanceId, {
    role: 'instance_admin',
    team_id: fx().backendTeamId,
  });
  const token = await loginAdmin();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await openAsAdminOnLocal(page, '/ui/routes');
    await pickTeam(page, 'Frontend Team');
    await expect(teamSwitcher(page)).toHaveValue('Frontend Team');

    await permission.logout(page);
    await signInHere(page, `${prefix}-user`, PASSWORD);

    // Reached client-side, still the same tab.
    await consumerGroupsPom.getConsumerGroupNavBtn(page).click();
    await consumerGroupsPom.isIndexPage(page);

    const created = await createConsumerGroup(page, GROUP_INSTANCE_ADMIN);

    // No team sent, so none recorded: what the header shows, which is none.
    expect(created.headers()['x-team-id']).toBeUndefined();
    await expect.poll(() => ownerOnLocal(token, GROUP_INSTANCE_ADMIN)).toBe('');
  } finally {
    await context.close();
    await deleteUsersByPrefix(prefix);
  }
});

test('a tab left open follows another tab signing in as someone else', async ({
  browser,
}) => {
  // Every tab sends the token localStorage holds, but each kept its own idea
  // of who is signed in: the auth atoms read localStorage once, when the page
  // loads. A super admin's idle tab, after another tab signed in as an
  // instance admin, went on as the super admin — sending the instance
  // admin's token with the super admin's role and team pick, so the proxy
  // recorded that team as the owner of what it wrote (#205).
  test.setTimeout(TIMEOUT_MS);
  const prefix = randomId('e2e-tab-sync-user');
  const setup = await adminToken();
  const user = await ensureUser(setup, {
    username: `${prefix}-user`,
    password: PASSWORD,
  });
  await ensureUserInstanceRole(setup, user.id, fx().localInstanceId, {
    role: 'instance_admin',
    team_id: fx().backendTeamId,
  });
  const token = await loginAdmin();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const idle = await context.newPage();
    await openAsAdminOnLocal(idle, '/ui/consumer_groups');
    await pickTeam(idle, 'Frontend Team');

    // Another tab of the same browser signs out and in as someone else.
    const other = await context.newPage();
    await other.goto('/ui/routes');
    await expect(teamSwitcher(other)).toBeVisible({ timeout: 30000 });
    await permission.logout(other);
    await signInHere(other, `${prefix}-user`, PASSWORD);

    // The idle tab says who is signed in now.
    await idle.bringToFront();
    await expect(
      idle.locator('header').getByText(`${prefix}-user`, { exact: true })
    ).toBeVisible({ timeout: 30000 });

    // And writes as that account: no team sent, none recorded.
    await consumerGroupsPom.getConsumerGroupNavBtn(idle).click();
    await consumerGroupsPom.isIndexPage(idle);
    const created = await createConsumerGroup(idle, GROUP_IDLE_TAB);
    expect(created.headers()['x-team-id']).toBeUndefined();
    await expect.poll(() => ownerOnLocal(token, GROUP_IDLE_TAB)).toBe('');
  } finally {
    await context.close();
    await deleteUsersByPrefix(prefix);
  }
});

test('a tab left open does not go on as its account while another tab signs in', async ({
  browser,
}) => {
  // The login form is reachable while signed in, and signing in from it
  // stores the new account's tokens before asking whose they are; the account
  // itself is stored only once that answer is back. In between, a tab left
  // open had nothing to follow and sent the new tokens as the old account,
  // with its role and team pick (#205).
  test.setTimeout(TIMEOUT_MS);
  const prefix = randomId('e2e-tab-relogin-user');
  const setup = await adminToken();
  const user = await ensureUser(setup, {
    username: `${prefix}-user`,
    password: PASSWORD,
  });
  await ensureUserInstanceRole(setup, user.id, fx().localInstanceId, {
    role: 'instance_admin',
    team_id: fx().backendTeamId,
  });
  const context = await browser.newContext({ storageState: undefined });
  let release = () => {};

  try {
    const idle = await context.newPage();
    await openAsAdminOnLocal(idle, '/ui/routes');
    await pickTeam(idle, 'Frontend Team');
    const signedIn = (username: string) =>
      idle.locator('header').getByText(username, { exact: true });
    await expect(signedIn(fx().users.admin.username)).toBeVisible();

    // Another tab signs in as someone else from the login form, with no
    // sign-out first, and its question of who that is gets no answer yet.
    const other = await context.newPage();
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = () => {};
    const identityAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    await other.route('**/api/v1/user', async (route) => {
      asked();
      await released;
      await route.continue();
    });
    await other.goto('/ui/login');
    await other.getByRole('textbox', { name: 'Username' }).fill(`${prefix}-user`);
    await other.getByPlaceholder('Enter your password').fill(PASSWORD);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await identityAsked;

    // Its tokens are stored by now. The idle tab no longer goes on as the
    // super admin.
    await idle.bringToFront();
    await expect(signedIn(fx().users.admin.username)).toHaveCount(0, {
      timeout: 30000,
    });

    // And once the other tab knows who signed in, so does this one.
    release();
    await expect(signedIn(`${prefix}-user`)).toBeVisible({ timeout: 30000 });
  } finally {
    release();
    await context.close();
    await deleteUsersByPrefix(prefix);
  }
});

test('a tab left open stays put when another tab signs in again as the same account', async ({
  browser,
}) => {
  // A sign-in from the login form drops the account signed in before, so the
  // other tabs start over (#205) — when it is another account. The same one
  // again changes nothing they depend on, and starting them over would cost
  // whatever they had open, for nothing.
  test.setTimeout(TIMEOUT_MS);
  const fixtures = fx();
  const context = await browser.newContext({ storageState: undefined });

  try {
    const idle = await context.newPage();
    await openAsAdminOnLocal(idle, '/ui/routes');
    // Gone if the page is loaded again.
    await idle.evaluate(() => {
      (window as { stayed?: boolean }).stayed = true;
    });

    const other = await context.newPage();
    await other.goto('/ui/login');
    await signInHere(other, fixtures.users.admin.username, fixtures.users.admin.password);
    // In, with its account stored: the other tabs have heard all of it.
    await expect(
      other.locator('header').getByText(fixtures.users.admin.username, { exact: true })
    ).toBeVisible({ timeout: 30000 });

    expect(
      await idle.evaluate(() => (window as { stayed?: boolean }).stayed)
    ).toBe(true);
  } finally {
    await context.close();
  }
});

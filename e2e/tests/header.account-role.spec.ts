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
import { env } from '@e2e/utils/env';
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Page, test } from '@playwright/test';

/**
 * The account dropdown used to read the role off User.role, which the backend
 * reserves for super_admin and leaves empty for everyone else (see
 * isAssignableGlobalRole in api/internal/handlers/auth.go). A developer
 * therefore saw their role beside their username but an empty "Role:" line in
 * the dropdown — the two were populated in exactly complementary cases.
 *
 * These tests use the base Playwright `test`, not @e2e/utils/test, so they get
 * a clean context instead of the worker-scoped admin session.
 */

const signIn = async (page: Page, username: string, password: string) => {
  await page.goto(env.E2E_TARGET_URL);
  await page.waitForURL((url) => url.pathname.includes('/login'), {
    timeout: 10000,
  });
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 15000,
  });
};

const openAccountMenu = async (page: Page, username: string) => {
  await page.getByText(username, { exact: true }).click();
};

test('shows a developer their per-instance role in the account dropdown', async ({
  page,
}) => {
  const dev = getFixtures().users.dev;
  await signIn(page, dev.username, dev.password);

  // Wait for the role beside the username, which only renders once the
  // instance list and the user's assignment for it have loaded. Asserting it
  // first keeps the dropdown check below from racing that fetch.
  await expect(page.getByText('developer', { exact: true })).toBeVisible({
    timeout: 15000,
  });

  await openAccountMenu(page, dev.username);

  // The dropdown must agree with the header rather than leaving Role: blank.
  await expect(page.getByText('Role: developer')).toBeVisible({
    timeout: 10000,
  });
});

test('shows a super admin their global role in the account dropdown', async ({
  page,
}) => {
  // A super_admin has no user_instances row, so the header renders no role
  // text at all for them — the dropdown is the only place they see it, which
  // is why the field cannot simply be dropped.
  const admin = getFixtures().users.admin;
  await signIn(page, admin.username, admin.password);

  await openAccountMenu(page, admin.username);

  await expect(page.getByText('Role: super admin')).toBeVisible({
    timeout: 10000,
  });
});

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
import { adminToken } from '@e2e/utils/admin-api';
import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086';

const TEMP_PASSWORD = 'Temp0rary!Pass#1';
const NEW_PASSWORD = 'Brand-New!Pass#2';

async function deleteUserByName(token: string, username: string) {
  const res = await fetch(`${API}/api/v1/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const users = (await res.json()) as { id: string; username: string }[];
  const match = users.find((u) => u.username === username);
  if (match) {
    await fetch(`${API}/api/v1/users/${match.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

// Each test provisions its own uniquely-named account (the two tests may run
// in parallel workers, so they must not share state). The admin creates it
// without opting out of the forced change: must_change_password defaults on.
async function createMustChangeUser(username: string) {
  const token = await adminToken();
  await deleteUserByName(token, username);
  const res = await fetch(`${API}/api/v1/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ username, password: TEMP_PASSWORD }),
  });
  expect(res.status).toBe(201);
}

test('the API gates a must-change user until the password is changed', async () => {
  const TEST_USER = 'e2e-forcechange-api';
  await createMustChangeUser(TEST_USER);

  const loginRes = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEMP_PASSWORD }),
  });
  expect(loginRes.status).toBe(200);
  const login = (await loginRes.json()) as {
    access_token: string;
    must_change_password: boolean;
  };
  expect(login.must_change_password).toBe(true);
  const auth = { Authorization: `Bearer ${login.access_token}` };

  // Any regular endpoint is rejected with the dedicated code…
  const gated = await fetch(`${API}/api/v1/overview`, { headers: auth });
  expect(gated.status).toBe(403);
  expect(((await gated.json()) as { code: string }).code).toBe(
    'password_change_required'
  );

  // …while the endpoints needed to perform the change stay reachable.
  const self = await fetch(`${API}/api/v1/user`, { headers: auth });
  expect(self.status).toBe(200);

  const change = await fetch(`${API}/api/v1/user/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      old_password: TEMP_PASSWORD,
      new_password: NEW_PASSWORD,
    }),
  });
  expect(change.status).toBe(200);

  // The gate lifts without needing new tokens.
  const ungated = await fetch(`${API}/api/v1/overview`, { headers: auth });
  expect(ungated.status).toBe(200);

  // And the next login no longer carries the flag.
  const relogin = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: NEW_PASSWORD }),
  });
  expect(relogin.status).toBe(200);
  expect(
    ((await relogin.json()) as { must_change_password: boolean })
      .must_change_password
  ).toBe(false);

  await deleteUserByName(await adminToken(), TEST_USER);
});

test('the UI walks a must-change user through the dedicated screen', async ({
  page,
}) => {
  const TEST_USER = 'e2e-forcechange-ui';
  await createMustChangeUser(TEST_USER);

  const base = process.env.E2E_TARGET_URL ?? 'http://localhost:9180/ui/';
  await page.goto(`${base.replace(/\/$/, '')}/login`);
  await page.getByRole('textbox', { name: 'Username' }).fill(TEST_USER);
  await page.getByPlaceholder('Enter your password').fill(TEMP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Landed on the forced-change screen, not the app.
  await expect(
    page.getByRole('heading', { name: 'Choose a new password' })
  ).toBeVisible();

  // Trying to escape to another page bounces back.
  await page.goto(`${base.replace(/\/$/, '')}/overview`);
  await expect(
    page.getByRole('heading', { name: 'Choose a new password' })
  ).toBeVisible();

  await page
    .getByRole('textbox', { name: 'Current password' })
    .fill(TEMP_PASSWORD);
  await page
    .getByRole('textbox', { name: 'New password', exact: true })
    .fill(NEW_PASSWORD);
  await page
    .getByRole('textbox', { name: 'Confirm new password' })
    .fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Update password' }).click();

  // Through to the app.
  await expect(page).toHaveURL(/\/(overview)?$/);

  await deleteUserByName(await adminToken(), TEST_USER);
});

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

// Each test provisions its own uniquely-named account (the tests may run in
// parallel workers, so they must not share state). Unless opted out, the
// admin-created account defaults to must_change_password on.
async function createUser(
  username: string,
  opts: { mustChange?: boolean } = {}
): Promise<{ id: string }> {
  const token = await adminToken();
  await deleteUserByName(token, username);
  const body: Record<string, unknown> = { username, password: TEMP_PASSWORD };
  if (opts.mustChange === false) {
    body.must_change_password = false;
  }
  const res = await fetch(`${API}/api/v1/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

test('the API gates a must-change user until the password is changed', async () => {
  const TEST_USER = 'e2e-forcechange-api';
  await createUser(TEST_USER);

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
  await createUser(TEST_USER);

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

test('an admin password reset re-arms the forced change', async () => {
  const TEST_USER = 'e2e-forcechange-reset';
  const RESET_PASSWORD = 'Reset-By!Admin#3';
  const { id } = await createUser(TEST_USER, { mustChange: false });
  const admin = await adminToken();

  // Fresh account without the flag uses the API freely.
  const login = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEMP_PASSWORD }),
  });
  expect(
    ((await login.json()) as { must_change_password: boolean })
      .must_change_password
  ).toBe(false);

  // The reset endpoint enforces the password policy…
  const weak = await fetch(`${API}/api/v1/users/${id}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${admin}`,
    },
    body: JSON.stringify({ password: 'weak' }),
  });
  expect(weak.status).toBe(422);

  // …and a compliant temporary password lands with the flag re-armed.
  const reset = await fetch(`${API}/api/v1/users/${id}/password`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${admin}`,
    },
    body: JSON.stringify({ password: RESET_PASSWORD }),
  });
  expect(reset.status).toBe(200);

  // The old password is dead, the temporary one carries the forced change.
  const oldLogin = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: TEMP_PASSWORD }),
  });
  expect(oldLogin.status).toBe(401);

  const newLogin = await fetch(`${API}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USER, password: RESET_PASSWORD }),
  });
  expect(newLogin.status).toBe(200);
  const fresh = (await newLogin.json()) as {
    access_token: string;
    must_change_password: boolean;
  };
  expect(fresh.must_change_password).toBe(true);

  const gated = await fetch(`${API}/api/v1/overview`, {
    headers: { Authorization: `Bearer ${fresh.access_token}` },
  });
  expect(gated.status).toBe(403);

  await deleteUserByName(await adminToken(), TEST_USER);
});

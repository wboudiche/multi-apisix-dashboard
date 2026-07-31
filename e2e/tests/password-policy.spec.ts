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
import { adminToken } from '@e2e/utils/admin-api';
import { test } from '@e2e/utils/test';
import { uiGoto, uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

import type { PasswordPolicy } from '@/apis/policy';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086';

const TEST_USER = 'e2e-pwpolicy-user';

// A deterministic complexity policy the create-user tests rely on, independent
// of whatever the checklist test or other specs left behind: min 12 with every
// character class required; history/expiry/lockout disabled (inert in phase 1).
const KNOWN_POLICY: PasswordPolicy = {
  min_length: 12,
  max_length: 72,
  require_uppercase: true,
  require_lowercase: true,
  require_digit: true,
  require_symbol: true,
  history_depth: 0,
  expiry_days: 0,
  lockout_threshold: 0,
  lockout_window_minutes: 0,
};

async function getPolicy(token: string): Promise<PasswordPolicy> {
  const res = await fetch(`${API}/api/v1/settings/password-policy`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()) as PasswordPolicy;
}

async function setPolicy(token: string, policy: PasswordPolicy) {
  await fetch(`${API}/api/v1/settings/password-policy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(policy),
  });
}

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

// The policy is a single global record (not per-instance/per-team), so this
// spec restores whatever was in place before it ran to avoid bleeding a
// stricter policy into other specs that create users concurrently.
let originalPolicy: PasswordPolicy;

test.beforeAll(async () => {
  const token = await adminToken();
  originalPolicy = await getPolicy(token);
  // Clean up any leftover test user from a previous interrupted run.
  await deleteUserByName(token, TEST_USER);
});

test.afterAll(async () => {
  const token = await adminToken();
  await deleteUserByName(token, TEST_USER);
  await setPolicy(token, originalPolicy);
});

test('raising the min length in Settings is reflected live in the create-user checklist', async ({
  page,
}) => {
  await uiGoto(page, '/settings');
  await expect(
    page.getByRole('heading', { name: 'Password policy' })
  ).toBeVisible();

  await page.getByLabel('Minimum length', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await uiHasToastMsg(page, { hasText: 'Password policy saved' });

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();

  // A weak (too-short) password: the checklist renders the unmet
  // min-length rule mirroring the policy just saved above.
  const minLengthRule = page
    .locator('[data-met]')
    .filter({ hasText: 'Be at least 20 characters' });
  await page.getByRole('textbox', { name: 'Password' }).fill('abc');
  await expect(minLengthRule).toHaveAttribute('data-met', 'false');

  // Satisfying the length requirement flips that rule to met.
  await page.getByRole('textbox', { name: 'Password' }).fill('a'.repeat(20));
  await expect(minLengthRule).toHaveAttribute('data-met', 'true');

  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('the create-user form rejects a policy-violating password and accepts a compliant one', async ({
  page,
}) => {
  // Pin a known policy so this test is deterministic regardless of order.
  await setPolicy(await adminToken(), KNOWN_POLICY);

  await adminPom.toUsers(page);
  await adminPom.isUsersPage(page);
  await page.getByRole('button', { name: 'Add User' }).click();
  await expect(page.getByText('Add New User')).toBeVisible();

  await page.getByLabel('Username').fill(TEST_USER);
  await page.getByLabel('Email').fill('e2e-pwpolicy@example.com');

  // Weak password (too short, missing classes) -> server rejects with 422,
  // the form surfaces the policy error and does NOT create the user.
  await page.getByRole('textbox', { name: 'Password' }).fill('weak');
  await page.getByRole('button', { name: 'Create User' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Password does not meet policy' })
  ).toBeVisible();
  // Modal is still open (creation was blocked).
  await expect(page.getByText('Add New User')).toBeVisible();

  // Compliant password -> user is created. Assert the durable outcome (modal
  // closes, the row appears) rather than the transient success toast.
  await page.getByRole('textbox', { name: 'Password' }).fill('Abcdef123!xyz');
  await page.getByRole('button', { name: 'Create User' }).click();
  await expect(page.getByText('Add New User')).toBeHidden();
  // The username cell's accessible name also includes the email, so match the
  // username as a substring rather than exactly.
  await expect(page.getByRole('cell', { name: TEST_USER })).toBeVisible();
});

test('a saved policy persists across a Settings page reload', async ({ page }) => {
  await uiGoto(page, '/settings');
  await expect(
    page.getByRole('heading', { name: 'Password policy' })
  ).toBeVisible();

  await page.getByLabel('Minimum length', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await uiHasToastMsg(page, { hasText: 'Password policy saved' });

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Password policy' })
  ).toBeVisible();
  await expect(
    page.getByLabel('Minimum length', { exact: true })
  ).toHaveValue('15');
});

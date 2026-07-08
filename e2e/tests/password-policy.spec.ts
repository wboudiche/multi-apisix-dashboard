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

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086';

type PasswordPolicy = {
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  history_depth: number;
  expiry_days: number;
  lockout_threshold: number;
  lockout_window_minutes: number;
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

// The policy is a single global record (not per-instance/per-team), so this
// spec restores whatever was in place before it ran to avoid bleeding a
// stricter policy into other specs that create users concurrently.
let originalPolicy: PasswordPolicy;

test.beforeAll(async () => {
  originalPolicy = await getPolicy(await adminToken());
});

test.afterAll(async () => {
  await setPolicy(await adminToken(), originalPolicy);
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
  await page.getByLabel('Password').fill('abc');
  await expect(page.getByText('Be at least 20 characters')).toBeVisible();

  // Satisfying the length requirement flips that rule to met.
  await page.getByLabel('Password').fill('a'.repeat(20));
  await expect(page.getByText('Be at least 20 characters')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
});

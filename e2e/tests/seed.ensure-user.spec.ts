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
import { deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { API_URL, apiFetch, ensureUser, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * The seed's own promise: after ensureUser, the fixture can log in as that
 * account. It used to return an account it found without looking, so one left
 * by an older revision of the fixtures, or reset by hand, made every spec that
 * logs in as it fail on a timeout that named the spec, not the seed (#149).
 *
 * CI never saw it: it starts from an empty etcd. Only long-lived local stacks
 * did - the ones people debug on.
 */
const PASSWORD = 'Seeded-User123!';
const OTHER_PASSWORD = 'Another-User123!';

const PREFIX = 'e2e_seed_user';
const usernames: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  const users = (await apiFetch('/api/v1/users', token)) as { id: string; username: string }[];
  for (const username of usernames.splice(0)) {
    const user = users.find((u) => u.username === username);
    if (!user) continue;
    // Demoted first: a super_admin the backend will not delete would otherwise
    // stay here, with a password written in this file.
    await apiFetch(`/api/v1/users/${user.id}`, token, {
      method: 'PUT',
      json: { email: '', role: '' },
    });
    await apiFetch(`/api/v1/users/${user.id}`, token, { method: 'DELETE' });
  }
});

// Whatever a run that died mid-test left behind, so the next one starts clean.
test.afterAll(() => deleteUsersByPrefix(PREFIX));

/** A username this test owns, torn down even when it fails. */
const owned = () => {
  const username = randomId(PREFIX).replace(/-/g, '_');
  usernames.push(username);
  return username;
};

test('an account whose password is not the fixture ones is made to be', async () => {
  const token = await loginAdmin();
  const username = owned();
  await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: {
      username,
      password: OTHER_PASSWORD,
      email: '',
      role: '',
      must_change_password: false,
    },
  });

  await ensureUser(token, { username, password: PASSWORD });

  // The point of the seed: this password works afterwards.
  await expect(loginAdmin(username, PASSWORD)).resolves.toBeTruthy();
});

test('an account that must change its password is made ready to use', async () => {
  const token = await loginAdmin();
  const username = owned();
  // The default for an admin-created account, and the state a password reset
  // leaves behind: it logs in, and then goes nowhere but the change screen.
  await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: { username, password: PASSWORD, email: '', role: '' },
  });

  await ensureUser(token, { username, password: PASSWORD });

  const res = await fetch(`${API_URL}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(res.ok).toBe(true);
  expect(await res.json()).toMatchObject({ must_change_password: false });
});

test('a super_admin it cannot sign in as is left for someone to sort out', async () => {
  const token = await loginAdmin();
  const username = owned();
  await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: {
      username,
      password: OTHER_PASSWORD,
      email: '',
      role: 'super_admin',
      must_change_password: false,
    },
  });

  // Deleting it is what the backend refuses for the last super_admin, and what
  // would take the seed's own account with it.
  await expect(ensureUser(token, { username, password: PASSWORD })).rejects.toThrow(
    /will not delete/
  );
  await expect(loginAdmin(username, OTHER_PASSWORD)).resolves.toBeTruthy();
});

test('an account the fixture can already use is left alone', async () => {
  const token = await loginAdmin();
  const username = owned();
  const created = await ensureUser(token, { username, password: PASSWORD });

  const again = await ensureUser(token, { username, password: PASSWORD });

  // Same account, not a fresh one: its id is what every assignment points at.
  expect(again.id).toBe(created.id);
});

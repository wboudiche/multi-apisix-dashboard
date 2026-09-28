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
import { etcdDelete, etcdPut } from '@e2e/utils/etcd';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
// The plain test, not @e2e/utils/test: this needs no browser, no SPA login and
// no dev server, as the two maintenance specs that write to etcd do not.
import { expect, test } from '@playwright/test';

/**
 * What the API answers about a record it has no date for.
 *
 * #300 stamped user records on write and taught the Users page to read Go's zero
 * time as unknown. The API went on serving "0001-01-01T00:00:00Z", so every
 * other consumer had the same trap to learn - a sort, an export, a script (#321).
 *
 * Straight to etcd, because that is the only way to produce the record this is
 * about: nothing the API offers writes a user without dates any more.
 */

const PREFIX = randomId('undated');

type ApiUser = {
  id: string;
  username: string;
  created_at: string | null;
  updated_at: string | null;
};

const usersFromApi = async () => {
  const token = await loginAdmin();
  return (await apiFetch('/api/v1/users', token)) as ApiUser[];
};

test('a record with no dates is answered as null, not as the year 1', async () => {
  const id = `${PREFIX}-id`;
  const username = `${PREFIX}-account`;
  // Exactly what a record written before #300 holds: the zero time, from when
  // the fields were values rather than pointers.
  await etcdPut(`/users/${id}`, {
    id,
    username,
    email: `${username}@example.com`,
    role: '',
    password_hash: '',
    created_at: '0001-01-01T00:00:00Z',
    updated_at: '0001-01-01T00:00:00Z',
  });

  try {
    const listed = (await usersFromApi()).find((u) => u.username === username);
    expect(listed).toBeDefined();
    expect(listed!.created_at).toBeNull();
    expect(listed!.updated_at).toBeNull();
  } finally {
    await etcdDelete(`/users/${id}`);
  }
});

test('an account the dashboard created carries its dates', async () => {
  const username = `${PREFIX}-created`;
  const token = await loginAdmin();
  const created = (await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: { username, password: 'e2e-Und4ted!pass', email: `${username}@example.com` },
  })) as ApiUser;

  try {
    expect(created.created_at).not.toBeNull();
    expect(created.updated_at).not.toBeNull();
    // A date, and this year's: the field used to be answered as the year 1.
    expect(new Date(created.created_at!).getUTCFullYear()).toBeGreaterThan(2000);
  } finally {
    await apiFetch(`/api/v1/users/${created.id}`, token, { method: 'DELETE' }).catch(
      () => undefined
    );
  }
});

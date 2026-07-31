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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

// APISIX's PUT is an upsert, so every Add form built on it silently replaced an
// existing record and still reported "Add ... Successfully" — the only trace
// being a changed update_time on a row the user believed they had just created.
// Add flows now send If-None-Match: *; Edit flows deliberately do not.
const PROXY = '/api/v1/apisix/admin';
const CREATE_ONLY = { 'If-None-Match': '*' };

const onInstance = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

// Paths created during a test, torn down even when an assertion fails. Without
// this a failed run leaks records — and APISIX allows a given plugin in only one
// global rule, so a single leaked global_rule breaks every later run.
const created: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  await Promise.all(
    created.splice(0).map((path) =>
      apiFetch(path, token, { method: 'DELETE', headers: onInstance() }).catch(() => undefined)
    )
  );
});

const limitCount = {
  plugins: { 'limit-count': { count: 2, time_window: 60, rejected_code: 503 } },
};

/** One case per resource the issue named, each addressed by a caller-chosen id. */
const RESOURCES = [
  {
    name: 'consumer',
    path: (id: string) => `${PROXY}/consumers/${id}`,
    original: (id: string) => ({ username: id, desc: 'original' }),
    overwrite: (id: string) => ({ username: id, desc: 'overwritten' }),
  },
  {
    name: 'consumer_group',
    path: (id: string) => `${PROXY}/consumer_groups/${id}`,
    original: () => ({ ...limitCount, desc: 'original' }),
    overwrite: () => ({ ...limitCount, desc: 'overwritten' }),
  },
  {
    name: 'global_rule',
    path: (id: string) => `${PROXY}/global_rules/${id}`,
    original: () => ({ ...limitCount }),
    overwrite: () => ({ ...limitCount }),
  },
  {
    name: 'plugin_config',
    path: (id: string) => `${PROXY}/plugin_configs/${id}`,
    original: () => ({ ...limitCount, desc: 'original' }),
    overwrite: () => ({ ...limitCount, desc: 'overwritten' }),
  },
  {
    name: 'secret',
    // Addressed as /secrets/{manager}/{id}, so this also pins that the guard
    // reads the whole path rather than the parsed resource id.
    path: (id: string) => `${PROXY}/secrets/vault/${id}`,
    original: () => ({ uri: 'https://vault.example.com', prefix: '/apisix', token: 'original' }),
    overwrite: () => ({ uri: 'https://vault.example.com', prefix: '/apisix', token: 'overwritten' }),
  },
] as const;

for (const resource of RESOURCES) {
  test(`adding a ${resource.name} twice is refused instead of overwriting`, async () => {
    const token = await loginAdmin();
    const id = randomId('dupe').replace(/-/g, '_');
    const headers = { ...onInstance(), ...CREATE_ONLY };

    created.push(resource.path(id));
    await apiFetch(resource.path(id), token, {
      method: 'PUT',
      headers,
      json: resource.original(id),
    });

    const secondAdd = apiFetch(resource.path(id), token, {
      method: 'PUT',
      headers,
      json: resource.overwrite(id),
    });
    await expect(secondAdd).rejects.toMatchObject({ status: 409 });
    await expect(secondAdd).rejects.toThrow(/already exists/);

    // The record the user already had must be exactly as they left it. A
    // refused create that still mutated would be the original bug wearing a
    // different status code.
    const stored = (await apiFetch(resource.path(id), token, { headers: onInstance() })) as {
      value: Record<string, unknown>;
    };
    expect(JSON.stringify(stored.value)).not.toContain('overwritten');
  });
}

// Editing is overwriting — the guard must not touch it.
test('editing an existing record still replaces it', async () => {
  const token = await loginAdmin();
  const id = randomId('edit').replace(/-/g, '_');

  created.push(`${PROXY}/consumers/${id}`);
  await apiFetch(`${PROXY}/consumers/${id}`, token, {
    method: 'PUT',
    headers: { ...onInstance(), ...CREATE_ONLY },
    json: { username: id, desc: 'original' },
  });

  // No If-None-Match: this is the Edit flow.
  await apiFetch(`${PROXY}/consumers/${id}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: { username: id, desc: 'edited on purpose' },
  });

  const stored = (await apiFetch(`${PROXY}/consumers/${id}`, token, {
    headers: onInstance(),
  })) as { value: { desc: string } };
  expect(stored.value.desc).toBe('edited on purpose');
});

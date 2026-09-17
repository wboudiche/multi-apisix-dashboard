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
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * A credential lives beneath its consumer, at
 * consumers/<username>/credentials/<id>, and the proxy reads that path as the
 * consumer. Its check for a resource with no team looked at the credential,
 * which does not exist before it is added, so the write passed; the ownership
 * written after it then went to the consumer (#250).
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const devToken = () => loginAdmin(fx().users.dev.username, fx().users.dev.password);
const credential = () => ({ plugins: { 'key-auth': { key: randomId('key') } } });

// Consumers a test made, torn down even when it fails.
const consumers: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const username of consumers.splice(0)) {
    await apiFetch(`${PROXY}/consumers/${username}`, token, {
      method: 'DELETE',
      headers: onInstance(),
    }).catch(() => undefined);
  }
});

/** Creates a consumer, as an admin with no team (so it has none) or as `token`. */
const createConsumer = async (token: string, headers: Record<string, string>) => {
  const username = randomId('e2e_cred_own').replace(/-/g, '_');
  consumers.push(username);
  await apiFetch(`${PROXY}/consumers`, token, {
    method: 'PUT',
    headers: { ...headers, 'If-None-Match': '*' },
    json: { username },
  });
  return username;
};

/** The consumer's team, as an admin reads it. */
const teamOf = async (username: string) => {
  const res = (await apiFetch(`${PROXY}/consumers/${username}`, await loginAdmin(), {
    headers: onInstance(),
  })) as { value: { __team_id?: string } };
  return res.value.__team_id ?? '';
};

test('a developer cannot give a consumer with no team a team by adding a credential', async () => {
  const username = await createConsumer(await loginAdmin(), onInstance());
  expect(await teamOf(username)).toBe('');

  const write = apiFetch(
    `${PROXY}/consumers/${username}/credentials/${randomId('cred')}`,
    await devToken(),
    { method: 'PUT', headers: onInstance(), json: credential() }
  );

  // Refused as a write to the consumer, which only an admin may change while
  // it has no team.
  await expect(write).rejects.toBeInstanceOf(HttpError);
  await expect(write).rejects.toHaveProperty('status', 403);
  expect(await teamOf(username)).toBe('');
});

test('an admin with a team selected adds a credential without moving the consumer', async () => {
  const username = await createConsumer(await devToken(), onInstance());
  expect(await teamOf(username)).toBe(fx().backendTeamId);

  await apiFetch(
    `${PROXY}/consumers/${username}/credentials/${randomId('cred')}`,
    await loginAdmin(),
    { method: 'PUT', headers: onInstance(fx().frontendTeamId), json: credential() }
  );

  expect(await teamOf(username)).toBe(fx().backendTeamId);
});

test('a developer still adds a credential to its own consumer', async () => {
  const dev = await devToken();
  const username = await createConsumer(dev, onInstance());

  const res = (await apiFetch(
    `${PROXY}/consumers/${username}/credentials/${randomId('cred')}`,
    dev,
    { method: 'PUT', headers: onInstance(), json: credential() }
  )) as { value: { plugins?: Record<string, unknown> } };

  expect(res.value.plugins).toHaveProperty('key-auth');
  expect(await teamOf(username)).toBe(fx().backendTeamId);
});

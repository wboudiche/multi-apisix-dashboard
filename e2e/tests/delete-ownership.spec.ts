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

/**
 * Deleting a resource through the proxy left its ownership record behind. A
 * team whose resources were all deleted still counted them and could not be
 * deleted, and another team could not create a resource under an id that no
 * longer existed (#248).
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onInstance = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});

const devToken = () => loginAdmin(fx().users.dev.username, fx().users.dev.password);

// Paths under the proxy, and teams, a test made; torn down even when it fails.
const resources: string[] = [];
const teams: string[] = [];

test.afterEach(async () => {
  const token = await loginAdmin();
  for (const path of resources.splice(0).reverse()) {
    await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers: onInstance() }).catch(
      () => undefined
    );
  }
  for (const id of teams.splice(0)) {
    await apiFetch(`/api/v1/teams/${id}`, token, { method: 'DELETE' }).catch(() => undefined);
  }
});

test('a team whose routes were all deleted can be deleted', async () => {
  const token = await loginAdmin();
  const team = (await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: { name: randomId('e2e-del-own'), description: '' },
  })) as { id: string };
  teams.push(team.id);

  const id = randomId('e2e-del-own');
  resources.push(`routes/${id}`);
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(team.id),
    json: route(id),
  });
  await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers: onInstance() });

  // It owns nothing now. Refused with 409 "it owns 1 resources" while the
  // deleted route's record was still counted.
  await expect(apiFetch(`/api/v1/teams/${team.id}`, token, { method: 'DELETE' })).resolves.toBeNull();
  teams.splice(teams.indexOf(team.id), 1);
});

test("another team can create a resource under a deleted resource's id", async () => {
  const admin = await loginAdmin();
  const id = randomId('e2e-del-own');
  resources.push(`routes/${id}`);
  await apiFetch(`${PROXY}/routes/${id}`, admin, {
    method: 'PUT',
    headers: onInstance(fx().frontendTeamId),
    json: route(id),
  });
  await apiFetch(`${PROXY}/routes/${id}`, admin, { method: 'DELETE', headers: onInstance() });

  // The developer is on Backend Team. Refused with 403 "Resource owned by
  // another team" while the deleted route's record still named Frontend Team.
  const res = (await apiFetch(`${PROXY}/routes/${id}`, await devToken(), {
    method: 'PUT',
    headers: onInstance(),
    json: route(id),
  })) as { value: { id: string } };
  expect(res.value.id).toBe(id);
});

test("deleting a consumer's credential leaves the consumer's owner in place", async () => {
  // A credential is deleted under its consumer's path, which names the
  // consumer, and the consumer is still there: its record has to stay.
  const dev = await devToken();
  const username = randomId('e2e_del_own').replace(/-/g, '_');
  resources.push(`consumers/${username}`);
  await apiFetch(`${PROXY}/consumers`, dev, {
    method: 'PUT',
    headers: { ...onInstance(), 'If-None-Match': '*' },
    json: { username },
  });
  const credential = `consumers/${username}/credentials/${randomId('cred')}`;
  await apiFetch(`${PROXY}/${credential}`, dev, {
    method: 'PUT',
    headers: onInstance(),
    json: { plugins: { 'key-auth': { key: randomId('key') } } },
  });

  await apiFetch(`${PROXY}/${credential}`, dev, { method: 'DELETE', headers: onInstance() });

  // Still the developer's: without its record, the consumer would be refused.
  const res = (await apiFetch(`${PROXY}/consumers/${username}`, dev, {
    headers: onInstance(),
  })) as { value: { __team_id?: string } };
  expect(res.value.__team_id).toBe(fx().backendTeamId);
});

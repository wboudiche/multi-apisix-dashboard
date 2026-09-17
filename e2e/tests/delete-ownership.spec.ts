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
    // Detached first, which a backend without the fix needs: there, deleting
    // leaves the record, and with it a team this spec could never delete. The
    // record is keyed by the first two segments, as the proxy reads them.
    const [type, id] = path.split('/');
    await apiFetch(`/api/v1/apisix/ownership/${type}/${id}`, token, {
      method: 'PUT',
      headers: onInstance(),
      json: { team_id: '' },
    }).catch(() => undefined);
    await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers: onInstance() }).catch(
      () => undefined
    );
  }
  for (const id of teams.splice(0)) {
    await apiFetch(`/api/v1/teams/${id}`, token, { method: 'DELETE' }).catch(() => undefined);
  }
});

const createTeam = async (token: string) => {
  const team = (await apiFetch('/api/v1/teams', token, {
    method: 'POST',
    json: { name: randomId('e2e-del-own'), description: '' },
  })) as { id: string };
  teams.push(team.id);
  return team.id;
};

/** Deletes a team, and stops tracking it for the teardown once it is gone. */
const deleteTeam = async (token: string, id: string) => {
  const res = await apiFetch(`/api/v1/teams/${id}`, token, { method: 'DELETE' });
  teams.splice(teams.indexOf(id), 1);
  return res;
};

test('a team whose routes were all deleted can be deleted', async () => {
  const token = await loginAdmin();
  const team = await createTeam(token);

  const id = randomId('e2e-del-own');
  resources.push(`routes/${id}`);
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onInstance(team),
    json: route(id),
  });
  await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers: onInstance() });

  // It owns nothing now. Refused with 409 "it owns 1 resources" while the
  // deleted route's record was still counted.
  await expect(deleteTeam(token, team)).resolves.toBeNull();
});

test('a secret written with a team selected does not keep that team from being deleted', async () => {
  // An admin with a team selected sends it on every write. For a secret, the
  // path /secrets/<manager>/<id> read as the manager's id, so the record stood
  // for the whole manager, and no delete of one secret could remove it.
  const token = await loginAdmin();
  const team = await createTeam(token);

  const path = `secrets/vault/${randomId('e2e-del-own')}`;
  resources.push(path);
  await apiFetch(`${PROXY}/${path}`, token, {
    method: 'PUT',
    headers: onInstance(team),
    json: { uri: 'https://vault.example.com', prefix: '/apisix', token: 'e2e' },
  });
  await apiFetch(`${PROXY}/${path}`, token, { method: 'DELETE', headers: onInstance() });

  await expect(deleteTeam(token, team)).resolves.toBeNull();
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

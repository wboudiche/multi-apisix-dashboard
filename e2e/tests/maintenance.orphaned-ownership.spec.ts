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
import { etcdDelete, etcdExists, etcdPut } from '@e2e/utils/etcd';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { expect, test } from '@playwright/test';

/**
 * Deleting a resource removes its ownership record since #249. The records left
 * before that still count against their team, which cannot be deleted, and
 * reserve their id (#248). The API no longer leaves one behind, so these tests
 * write them straight to etcd, as the older version did.
 */
const PROXY = '/api/v1/apisix/admin';
const fx = () => getFixtures();
const onLocal = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});

// Keys a test wrote to etcd, routes and instances it created: removed even
// when it fails.
const seeded: string[] = [];
const routes: string[] = [];
const instances: string[] = [];

test.afterEach(async () => {
  for (const key of seeded.splice(0)) {
    await etcdDelete(key).catch(() => undefined);
  }
  const token = await loginAdmin();
  for (const id of routes.splice(0)) {
    await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
  for (const id of instances.splice(0)) {
    await apiFetch(`/api/v1/instances/${id}?force=true`, token, { method: 'DELETE' }).catch(
      () => undefined
    );
  }
});

/** A record for the backend team, as the older version left it. */
const seedRecord = async (instanceId: string, type: string, id: string) => {
  const key = `/ownership/${instanceId}/${type}/${id}`;
  seeded.push(key);
  await etcdPut(key, fx().backendTeamId);
  return key;
};

type Orphans = {
  ownership: { key: string; reason: string; team_id?: string }[];
  unchecked_instances: { instance_id: string; resource_type?: string; reason: string }[];
};
type Purge = {
  ownership: { deleted: string[]; skipped: Record<string, string>; failed: Record<string, string> };
};

const list = async (token: string) =>
  (await apiFetch('/api/v1/maintenance/orphans', token)) as Orphans;
const purge = async (token: string, keys: string[]) =>
  (await apiFetch('/api/v1/maintenance/orphans/purge', token, {
    method: 'POST',
    json: { ownership: keys },
  })) as Purge;

test('lists the records with nothing to own, and purges only the keys it is sent', async () => {
  const token = await loginAdmin();
  const local = fx().localInstanceId;
  const resourceGone = await seedRecord(local, 'routes', randomId('e2e-gone-route'));
  const notShared = await seedRecord(local, 'ssls', randomId('e2e-ssl'));
  const instanceGone = await seedRecord(randomId('e2e-gone-instance'), 'routes', 'r1');

  // A record the proxy writes for a route that exists.
  const id = randomId('e2e-owned-route');
  routes.push(id);
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onLocal(fx().backendTeamId),
    json: { uri: `/${id}`, upstream: { type: 'roundrobin', nodes: { '127.0.0.1:80': 1 } } },
  });
  const living = `/ownership/${local}/routes/${id}`;
  expect(await etcdExists(living)).toBe(true);

  const orphans = (await list(token)).ownership;
  const reason = (key: string) => orphans.find((o) => o.key === key)?.reason;
  expect(reason(resourceGone)).toBe('resource_gone');
  expect(reason(notShared)).toBe('type_not_team_scoped');
  expect(reason(instanceGone)).toBe('instance_gone');
  expect(reason(living)).toBeUndefined();
  expect(orphans.find((o) => o.key === resourceGone)?.team_id).toBe(fx().backendTeamId);

  const res = await purge(token, [resourceGone, notShared, instanceGone, living]);
  expect(res.ownership.deleted).toEqual([resourceGone, notShared, instanceGone]);
  expect(res.ownership.skipped).toEqual({ [living]: 'its resource exists' });

  for (const key of [resourceGone, notShared, instanceGone]) {
    expect(await etcdExists(key)).toBe(false);
  }
  expect(await etcdExists(living)).toBe(true);
});

test('does not judge the records of an instance whose gateway cannot be reached', async () => {
  const token = await loginAdmin();
  // Nothing listens on port 9, so the gateway refuses at once.
  const instance = (await apiFetch('/api/v1/instances?force=true', token, {
    method: 'POST',
    json: {
      name: randomId('e2e-unreachable'),
      description: '',
      admin_api_url: `http://127.0.0.1:9/${randomId('e2e')}`,
      admin_key: 'irrelevant',
      gateway_url: '',
      is_active: true,
    },
  })) as { id: string };
  instances.push(instance.id);
  const record = await seedRecord(instance.id, 'routes', randomId('e2e-route'));

  const report = await list(token);
  expect(report.ownership.map((o) => o.key)).not.toContain(record);
  expect(report.unchecked_instances.map((u) => u.instance_id)).toContain(instance.id);

  const res = await purge(token, [record]);
  expect(res.ownership.deleted).toEqual([]);
  expect(res.ownership.skipped).toEqual({ [record]: 'its instance could not be checked' });
  expect(await etcdExists(record)).toBe(true);
});

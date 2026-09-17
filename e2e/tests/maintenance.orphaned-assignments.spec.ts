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
 * Deleting a user removes its instance assignments since #206. The ones left
 * by deletions before that still put their users on teams, and only etcd holds
 * them (#209). The API cannot make one any more, so these tests write one
 * straight to etcd, as an old deletion left it.
 */
const fx = () => getFixtures();

// Keys a test wrote to etcd, and users it created, removed even when it fails.
const seeded: string[] = [];
const users: string[] = [];

/** An assignment for a user that does not exist, as an old deletion left it. */
const seedOrphan = async () => {
  const userId = randomId('e2e-gone-user');
  const key = `/user_instances/${userId}/${fx().localInstanceId}`;
  seeded.push(key);
  await etcdPut(key, {
    user_id: userId,
    instance_id: fx().localInstanceId,
    team_id: fx().backendTeamId,
    role: 'developer',
  });
  return key;
};

test.afterEach(async () => {
  for (const key of seeded.splice(0)) {
    await etcdDelete(key).catch(() => undefined);
  }
  const token = await loginAdmin();
  for (const id of users.splice(0)) {
    // Its assignments go with it.
    await apiFetch(`/api/v1/users/${id}`, token, { method: 'DELETE' }).catch(() => undefined);
  }
});

/** A user of this test's own, assigned to the local instance: a living assignment. */
const livingAssignment = async (token: string) => {
  const user = (await apiFetch('/api/v1/users', token, {
    method: 'POST',
    json: {
      username: randomId('e2e_living'),
      password: 'Living-User123!',
      email: '',
      role: '',
      must_change_password: false,
    },
  })) as { id: string };
  users.push(user.id);
  await apiFetch(`/api/v1/user-access/${user.id}/instances/${fx().localInstanceId}/role`, token, {
    method: 'POST',
    json: { role: 'developer', team_id: fx().backendTeamId },
  });
  return `/user_instances/${user.id}/${fx().localInstanceId}`;
};

type Orphans = { user_instances: { key: string; instance_id: string; role?: string; team_id?: string }[] };
type Purge = {
  user_instances: { deleted: string[]; skipped: Record<string, string>; failed: Record<string, string> };
};

test('lists the assignments whose user is gone, and purges only the keys it is sent', async () => {
  const token = await loginAdmin();
  const purged = await seedOrphan();
  const kept = await seedOrphan();
  const living = await livingAssignment(token);

  const listed = (await apiFetch('/api/v1/maintenance/orphans', token)) as Orphans;
  const keys = listed.user_instances.map((o) => o.key);
  expect(keys).toEqual(expect.arrayContaining([purged, kept]));
  expect(keys).not.toContain(living);
  expect(listed.user_instances.find((o) => o.key === purged)).toMatchObject({
    instance_id: fx().localInstanceId,
    role: 'developer',
    team_id: fx().backendTeamId,
  });

  // A living user's assignment is named too, and is refused rather than taken;
  // the orphan named twice goes once.
  const purge = (keys: string[]) =>
    apiFetch('/api/v1/maintenance/orphans/purge', token, {
      method: 'POST',
      json: { user_instances: keys },
    }) as Promise<Purge>;
  const res = await purge([purged, living, purged]);
  expect(res.user_instances.deleted).toEqual([purged]);
  expect(res.user_instances.skipped).toEqual({ [living]: 'its user exists' });

  // Named again once it is gone, it is not mistaken for a living user's.
  const again = await purge([purged]);
  expect(again.user_instances.deleted).toEqual([]);
  expect(again.user_instances.skipped).toEqual({ [purged]: 'no such instance assignment' });

  expect(await etcdExists(purged)).toBe(false);
  expect(await etcdExists(kept)).toBe(true);
  expect(await etcdExists(living)).toBe(true);
});

test('a purge has to name its keys', async () => {
  const token = await loginAdmin();
  const orphan = await seedOrphan();

  const res = apiFetch('/api/v1/maintenance/orphans/purge', token, { method: 'POST', json: {} });
  await expect(res).rejects.toHaveProperty('status', 400);
  expect(await etcdExists(orphan)).toBe(true);
});

test('only a super_admin can list or purge', async () => {
  const dev = await loginAdmin(fx().users.dev.username, fx().users.dev.password);
  const orphan = await seedOrphan();

  await expect(apiFetch('/api/v1/maintenance/orphans', dev)).rejects.toHaveProperty('status', 403);
  await expect(
    apiFetch('/api/v1/maintenance/orphans/purge', dev, {
      method: 'POST',
      json: { user_instances: [orphan] },
    })
  ).rejects.toHaveProperty('status', 403);
  expect(await etcdExists(orphan)).toBe(true);
});

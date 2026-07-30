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

// A resource with no team is administrative territory: invisible and unwritable
// to non-admins until an admin assigns it. Before this rule a developer could
// overwrite and delete resources that never appeared in their own list — the
// write guard allowed what the read filter hid.
const ROUTE_ID = randomId('unowned').replace(/-/g, '_');
const PROXY = '/api/v1/apisix/admin';

const fx = () => getFixtures();

/** The proxy resolves the target gateway from this header. */
const onInstance = () => ({ 'X-Instance-ID': fx().localInstanceId });

/** Writes straight to the gateway, so the route exists with no ownership record. */
const seedUnownedRoute = async (adminToken: string) =>
  apiFetch(`${PROXY}/routes/${ROUTE_ID}`, adminToken, {
    headers: onInstance(),
    method: 'PUT',
    json: {
      name: ROUTE_ID,
      uri: `/${ROUTE_ID}`,
      upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
    },
  });

test.beforeEach(async () => {
  // Seeded by a super_admin with no team selected, which records no ownership.
  await seedUnownedRoute(await loginAdmin());
});

test.afterEach(async () => {
  await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, await loginAdmin(), { method: 'DELETE', headers: onInstance() }).catch(
    () => undefined
  );
});

test('a developer cannot write to a route that belongs to no team', async () => {
  const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  const overwrite = apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, {
    headers: onInstance(),
    method: 'PUT',
    json: { uri: '/hijacked', upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] } },
  });
  await expect(overwrite).rejects.toMatchObject({ status: 403 });

  const remove = apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, { method: 'DELETE', headers: onInstance() });
  await expect(remove).rejects.toMatchObject({ status: 403 });

  // The route must still be intact — a refused write is not a partial write.
  const asAdmin = (await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, await loginAdmin(), { headers: onInstance() })) as {
    value: { uri: string };
  };
  expect(asAdmin.value.uri).toBe(`/${ROUTE_ID}`);
});

test('the refusal explains the resource has no team, not that another team owns it', async () => {
  const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  const refused = apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, {
    method: 'DELETE',
    headers: onInstance(),
  });

  // Pointing at a team that does not exist would send the operator hunting.
  await expect(refused).rejects.toThrow(/not assigned to a team/);
});

// Creating is not the same as touching someone else's unassigned resource:
// consumers and consumer_groups are created by PUT with a caller-supplied id,
// and that has to keep working for a developer.
test('a developer can still create a resource with a PUT to a new id', async () => {
  const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);
  const username = randomId('consumer').replace(/-/g, '_');

  const created = await apiFetch(`${PROXY}/consumers/${username}`, devToken, {
    headers: onInstance(),
    method: 'PUT',
    json: { username, desc: 'created by routes.unowned-access e2e' },
  });
  expect(created).toBeTruthy();

  // And having created it, they own it and can edit it.
  const edited = await apiFetch(`${PROXY}/consumers/${username}`, devToken, {
    headers: onInstance(),
    method: 'PUT',
    json: { username, desc: 'edited by its owner' },
  });
  expect(edited).toBeTruthy();

  await apiFetch(`${PROXY}/consumers/${username}`, devToken, { method: 'DELETE', headers: onInstance() });
});

test('an admin can assign the route, after which the developer may edit it', async () => {
  const adminToken = await loginAdmin();
  const devToken = await loginAdmin(fx().users.dev.username, fx().users.dev.password);

  await apiFetch(`/api/v1/apisix/ownership/routes/${ROUTE_ID}`, adminToken, {
    headers: onInstance(),
    method: 'PUT',
    json: { team_id: fx().backendTeamId },
  });

  const edited = await apiFetch(`${PROXY}/routes/${ROUTE_ID}`, devToken, {
    headers: onInstance(),
    method: 'PUT',
    json: {
      name: ROUTE_ID,
      uri: `/${ROUTE_ID}`,
      upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
    },
  });
  expect(edited).toBeTruthy();
});

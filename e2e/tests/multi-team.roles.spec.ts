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
import { permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { etcdPut } from '@e2e/utils/etcd';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  HttpError,
  loginAdmin,
  type Team,
  type User,
  type UserInstance,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { roleText } from '@e2e/utils/ui/roles';
import { expect } from '@playwright/test';

/**
 * A role per team (#394): viewer in one team and developer in
 * another on the same instance, and independent roles on another instance.
 * multi-team.spec.ts covers a developer in several teams; this covers what a
 * viewer team changes.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-team-roles');
const PASSWORD = 'e2e-Team-r0les!pass';
const fx = () => getFixtures();
const on = (instanceId: string, team?: string) => ({
  'X-Instance-ID': instanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const local = (team?: string) => on(fx().localInstanceId, team);
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});
type Row = { value: { id: string; __team_id?: string } };

test.describe.configure({ mode: 'serial' });

let viewed: Team; // alice is a viewer in it
let developed: Team; // alice is a developer in it
let foreign: Team; // not hers
let staged: Team; // on staging
let alice: User;
const ROUTE = `${PREFIX}-route`;
const routeOf = {
  viewed: `${ROUTE}-1`,
  developed: `${ROUTE}-2`,
  foreign: `${ROUTE}-4`,
  staged: `${ROUTE}-3`,
};
const aliceToken = () => loginAdmin(`${PREFIX}-alice`, PASSWORD);

const refusal = async (request: Promise<unknown>): Promise<HttpError | undefined> => {
  try {
    await request;
    return undefined;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
};

const listed = async (token: string, headers: Record<string, string>) => {
  const res = (await apiFetch(`${PROXY}/routes?name=${ROUTE}&page_size=50`, token, {
    headers,
  })) as { list: Row[] };
  return Object.fromEntries(res.list.map((r) => [r.value.id, r.value.__team_id]));
};

const assignMixed = (admin: string) =>
  ensureUserInstanceRole(admin, alice.id, fx().localInstanceId, {
    role: 'viewer',
    team_ids: [viewed.id, developed.id],
    team_roles: { [developed.id]: 'developer' },
  });

test.beforeAll(async () => {
  const admin = await loginAdmin();
  viewed = await ensureTeam(admin, { name: `${PREFIX}-t1` });
  developed = await ensureTeam(admin, { name: `${PREFIX}-t2` });
  foreign = await ensureTeam(admin, { name: `${PREFIX}-t4` });
  staged = await ensureTeam(admin, { name: `${PREFIX}-t3` });
  alice = await ensureUser(admin, { username: `${PREFIX}-alice`, password: PASSWORD });
  await assignMixed(admin);
  for (const [id, team] of [
    [routeOf.viewed, viewed.id],
    [routeOf.developed, developed.id],
    [routeOf.foreign, foreign.id],
  ]) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, {
      method: 'PUT',
      headers: local(team),
      json: route(id),
    });
  }
  await apiFetch(`${PROXY}/routes/${routeOf.staged}`, admin, {
    method: 'PUT',
    headers: on(fx().stagingInstanceId, staged.id),
    json: route(routeOf.staged),
  });
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  try {
    for (const instanceId of [fx().localInstanceId, fx().stagingInstanceId]) {
      for (const id of Object.keys(await listed(admin, on(instanceId)))) {
        await apiFetch(`${PROXY}/routes/${id}`, admin, {
          method: 'DELETE',
          headers: on(instanceId),
        }).catch(() => undefined);
      }
    }
  } finally {
    // Then the user, whose assignment names the teams, and the teams.
    await deleteUsersByPrefix(PREFIX);
    await deleteTeamsByPrefix(PREFIX);
  }
});

test('the assignment holds a role per team, and says it back', async () => {
  const stored = await assignMixed(await loginAdmin());
  expect(stored.role).toBe('developer');
  expect(stored.team_roles).toEqual({ [viewed.id]: 'viewer', [developed.id]: 'developer' });
  const own = (await apiFetch(
    `/api/v1/user-access/${alice.id}/instances`,
    await aliceToken()
  )) as (UserInstance & { teams?: { id: string; role?: string }[] })[];
  expect(own[0].teams).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: viewed.id, role: 'viewer' }),
      expect.objectContaining({ id: developed.id, role: 'developer' }),
    ])
  );
});

test('reads every team of hers, whatever the role, and no other', async () => {
  const rows = await listed(await aliceToken(), local());
  expect(rows[routeOf.viewed]).toBe(viewed.id);
  expect(rows[routeOf.developed]).toBe(developed.id);
  expect(rows).not.toHaveProperty(routeOf.foreign);
});

test('changes a route of the team she develops in, and not one of the team she views', async () => {
  const token = await aliceToken();
  await apiFetch(`${PROXY}/routes/${routeOf.developed}`, token, {
    method: 'PUT',
    headers: local(),
    json: { ...route(routeOf.developed), desc: 'hers' },
  });
  const refused = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.viewed}`, token, {
      method: 'PUT',
      headers: local(),
      json: { ...route(routeOf.viewed), desc: 'not hers' },
    })
  );
  expect(refused?.status).toBe(403);
  expect(refused?.message).toContain('team_read_only');
  const del = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.viewed}`, token, {
      method: 'DELETE',
      headers: local(),
    })
  );
  expect(del?.status).toBe(403);
  expect(del?.message).toContain('team_read_only');
});

test('a create with no team named goes to the one team she develops in', async () => {
  const id = `${ROUTE}-created`;
  await apiFetch(`${PROXY}/routes/${id}`, await aliceToken(), {
    method: 'PUT',
    headers: local(),
    json: route(id),
  });
  expect((await listed(await loginAdmin(), local()))[id]).toBe(developed.id);
});

test('naming the team she views narrows her list and refuses a create in it', async () => {
  const token = await aliceToken();
  const rows = await listed(token, local(viewed.id));
  expect(Object.values(rows)).toEqual([viewed.id]);
  const id = `${ROUTE}-refused`;
  const refused = await refusal(
    apiFetch(`${PROXY}/routes/${id}`, token, {
      method: 'PUT',
      headers: local(viewed.id),
      json: route(id),
    })
  );
  expect(refused?.status).toBe(403);
  expect(refused?.message).toContain('team_read_only');
});

test('tests a route of the team she develops in, and not of the team she views', async () => {
  const token = await aliceToken();
  const status = async (routeId: string) => {
    const err = await refusal(
      apiFetch('/api/v1/test-route', token, {
        method: 'POST',
        headers: local(),
        json: { route_id: routeId, method: 'GET', path: `/${routeId}` },
      })
    );
    return err ?? { status: 200, message: '' };
  };
  const viewedAnswer = await status(routeOf.viewed);
  expect(viewedAnswer.status).toBe(403);
  expect(viewedAnswer.message).toContain('team_read_only');
  // Allowed: whatever the gateway answers, the dashboard did not refuse it.
  expect([200, 502]).toContain((await status(routeOf.developed)).status);
});

test('the routes page offers a write only on the team she develops in', async ({ page }) => {
  await permission.loginAs(page, `${PREFIX}-alice`, PASSWORD);
  await permission.switchInstance(page, 'Local APISIX');
  await page.goto(`${new URL(page.url()).origin}/ui/routes?name=${ROUTE}`);
  const rowOf = (id: string) => routesPom.rowByName(page, id);
  // The developer team's row is offered Configure and Offline; the viewer
  // team's only View.
  await expect(rowOf(routeOf.developed).getByRole('button', { name: 'Configure' })).toBeVisible({
    timeout: 20000,
  });
  await expect(rowOf(routeOf.viewed).getByRole('button', { name: 'View' })).toBeVisible();
  await expect(rowOf(routeOf.viewed).getByRole('button', { name: 'Configure' })).toHaveCount(0);
  await expect(rowOf(routeOf.viewed).getByRole('button', { name: 'Offline' })).toHaveCount(0);
  // Nor is Delete behind its More menu.
  await rowOf(routeOf.viewed).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
});

test('the admin gives a role per team in the Permissions modal, and the table names them', async ({
  page,
}) => {
  // Reset to one role for both, then make the second developer through the UI.
  await ensureUserInstanceRole(await loginAdmin(), alice.id, fx().localInstanceId, {
    role: 'viewer',
    team_ids: [viewed.id, developed.id],
  });
  await adminPom.toUsers(page);
  const row = adminPom.rowByText(page, `${PREFIX}-alice`);
  await row.getByRole('button', { name: 'Permissions' }).click();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const roles = page.getByTestId(`team-roles-${fx().localInstanceId}`);
  await roles
    .getByRole('radiogroup', { name: `Role in ${developed.name}` })
    .getByText(roleText('developer'), { exact: true })
    .click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);

  const stored = (await apiFetch(
    `/api/v1/user-access/${alice.id}/instances`,
    await loginAdmin()
  )) as UserInstance[];
  expect(stored.find((a) => a.instance_id === fx().localInstanceId)?.team_roles).toEqual({
    [viewed.id]: 'viewer',
    [developed.id]: 'developer',
  });
  await expect(row.getByText(`${viewed.name} · ${roleText('viewer')}`)).toBeVisible();
  await expect(row.getByText(`${developed.name} · ${roleText('developer')}`)).toBeVisible();
});

test('roles on another instance are its own', async () => {
  await ensureUserInstanceRole(await loginAdmin(), alice.id, fx().stagingInstanceId, {
    role: 'viewer',
    team_ids: [staged.id],
  });
  const token = await aliceToken();
  // Developer on local, in the team she develops in...
  await apiFetch(`${PROXY}/routes/${routeOf.developed}`, token, {
    method: 'PUT',
    headers: local(),
    json: { ...route(routeOf.developed), desc: 'local' },
  });
  // ...viewer on staging: reads its team, writes nothing, stopped at the door.
  const staging = on(fx().stagingInstanceId);
  expect((await listed(token, staging))[routeOf.staged]).toBe(staged.id);
  const refused = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.staged}`, token, {
      method: 'PUT',
      headers: staging,
      json: { ...route(routeOf.staged), desc: 'staging' },
    })
  );
  expect(refused?.status).toBe(403);
});

test('an assignment stored before the roles has its role in every team', async () => {
  // Written as a binary from before #394 left it: one role.
  await etcdPut(`/user_instances/${alice.id}/${fx().localInstanceId}`, {
    user_id: alice.id,
    instance_id: fx().localInstanceId,
    team_ids: [viewed.id, developed.id],
    team_id: viewed.id,
    role: 'developer',
  });
  const refused = await refusal(
    apiFetch(`${PROXY}/routes/${routeOf.viewed}`, await aliceToken(), {
      method: 'PUT',
      headers: local(),
      json: { ...route(routeOf.viewed), desc: 'legacy developer' },
    })
  );
  expect(refused).toBeUndefined();
});

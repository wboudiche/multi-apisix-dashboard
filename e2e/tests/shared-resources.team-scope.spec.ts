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
import { permission } from '@e2e/pom/permission';
import { genTLS, randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, test } from '@playwright/test';

/**
 * Plugin configs, SSLs and protos were instance-wide: a viewer listed and
 * opened every one of them, whichever team it was created for (#455). They
 * belong to a team now, as routes do: a viewer sees their teams' alone, one
 * with no team is an admin's until it is given one, and an admin sees all.
 */
const PROXY = '/api/v1/apisix/admin';
const INSTANCE_NAME = 'Local APISIX';
const fx = () => getFixtures();
const on = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const viewerToken = () => loginAdmin(fx().users.viewer.username, fx().users.viewer.password);
const statusOf = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (err: unknown) => (err instanceof HttpError ? err.status : -1)
  );
type Row = { value: Record<string, unknown> };
type List = { total: number; list: Row[] };

// One letter run per seeding, so an SNI stays a valid host name.
const sniSafe = () => Math.random().toString(36).slice(2, 10);

const TYPES = {
  plugin_configs: async (id: string) => ({ plugins: {}, desc: id }),
  protos: async () => ({ content: 'syntax = "proto3"; package e2e;' }),
  ssls: async () => {
    const { cert, key } = await genTLS();
    return { cert, key, snis: [`team-scope-${sniSafe()}.e2e.test`] };
  },
} as const;
type Type = keyof typeof TYPES;

test.describe.configure({ mode: 'serial' });

// For each type: one object of the viewer's team, one of another team, one of none.
const seeded = {} as Record<Type, { mine: string; theirs: string; none: string }>;

test.beforeAll(async () => {
  const admin = await loginAdmin();
  for (const type of Object.keys(TYPES) as Type[]) {
    const ids = {
      mine: randomId('e2e-ts-mine'),
      theirs: randomId('e2e-ts-theirs'),
      none: randomId('e2e-ts-none'),
    };
    const owners = { mine: fx().viewersTeamId, theirs: fx().backendTeamId, none: undefined };
    for (const k of ['mine', 'theirs', 'none'] as const) {
      await apiFetch(`${PROXY}/${type}/${ids[k]}`, admin, {
        method: 'PUT',
        headers: on(owners[k]),
        json: await TYPES[type](ids[k]),
      });
    }
    seeded[type] = ids;
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  for (const [type, ids] of Object.entries(seeded)) {
    for (const id of Object.values(ids)) {
      await apiFetch(`${PROXY}/${type}/${id}`, admin, { method: 'DELETE', headers: on() }).catch(
        () => undefined
      );
    }
  }
});

const listIds = async (type: Type, token: string) => {
  const res = (await apiFetch(`${PROXY}/${type}?page=1&page_size=500`, token, {
    headers: on(),
  })) as List;
  return { rows: res.list, ids: res.list.map((r) => r.value.id as string) };
};

for (const type of Object.keys(TYPES) as Type[]) {
  test(`a viewer lists only the ${type} of their team`, async () => {
    const { ids } = await listIds(type, await viewerToken());
    const { mine, theirs, none } = seeded[type];
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(ids).not.toContain(none);
  });

  test(`a viewer cannot open another team's ${type}, nor one of no team`, async () => {
    const token = await viewerToken();
    const { mine, theirs, none } = seeded[type];
    expect(await statusOf(apiFetch(`${PROXY}/${type}/${mine}`, token, { headers: on() }))).toBe(200);
    expect(await statusOf(apiFetch(`${PROXY}/${type}/${theirs}`, token, { headers: on() }))).toBe(403);
    expect(await statusOf(apiFetch(`${PROXY}/${type}/${none}`, token, { headers: on() }))).toBe(403);
  });

  test(`an admin lists every ${type}, whatever its team`, async () => {
    const { ids } = await listIds(type, await loginAdmin());
    expect(ids).toEqual(expect.arrayContaining(Object.values(seeded[type])));
  });
}

test("the SSLs a viewer is left with still carry their certificate's expiry", async () => {
  const { rows } = await listIds('ssls', await viewerToken());
  const mine = rows.find((r) => r.value.id === seeded.ssls.mine);
  expect(mine?.value.__cert_not_after).toBeTruthy();
});

test('an admin hands a plugin config to the viewer\'s team from its page', async ({ page }) => {
  await permission.loginAs(page, fx().users.admin.username, fx().users.admin.password);
  await permission.switchInstance(page, INSTANCE_NAME);
  await page.goto(`/ui/plugin_configs/detail/${seeded.plugin_configs.theirs}`);

  await page.getByRole('button', { name: i18n.t('form.reassignTeam.title') }).click();
  await page.getByRole('textbox', { name: i18n.t('form.reassignTeam.selectTeam') }).click();
  await page.getByRole('option', { name: 'Viewers Team', exact: true }).click();
  await page.getByRole('button', { name: i18n.t('form.reassignTeam.confirm'), exact: true }).click();
  await uiHasToastMsg(page, { hasText: i18n.t('form.reassignTeam.success') });

  const { ids } = await listIds('plugin_configs', await viewerToken());
  expect(ids).toContain(seeded.plugin_configs.theirs);
});

test("a viewer's route that uses a plugin config they cannot read shows its id", async ({
  page,
}) => {
  // The route is the viewer's team's; the plugin config it uses is nobody's.
  const admin = await loginAdmin();
  const routeId = randomId('e2e-ts-route');
  await apiFetch(`${PROXY}/routes/${routeId}`, admin, {
    method: 'PUT',
    headers: on(fx().viewersTeamId),
    json: {
      uri: `/${routeId}`,
      name: routeId,
      plugin_config_id: seeded.plugin_configs.none,
      upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
    },
  });
  try {
    await permission.loginAs(page, fx().users.viewer.username, fx().users.viewer.password);
    await permission.switchInstance(page, INSTANCE_NAME);
    await page.goto(`/ui/routes/detail/${routeId}`);
    await page.getByText(i18n.t('form.routes.steps.preview'), { exact: true }).click();
    await expect(page.getByText(seeded.plugin_configs.none)).toBeVisible();
    // A refused read of the name is not an error to show.
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await apiFetch(`${PROXY}/routes/${routeId}`, admin, { method: 'DELETE', headers: on() }).catch(
      () => undefined
    );
  }
});

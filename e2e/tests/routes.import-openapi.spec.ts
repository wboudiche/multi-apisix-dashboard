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
import { writeFileSync } from 'node:fs';

import { headerTeamSelect, permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq, listEvery } from '@e2e/utils/req';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
  type Team,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiCell } from '@e2e/utils/ui';
import { roleText } from '@e2e/utils/ui/roles';
import { expect, type Page } from '@playwright/test';

import { postUpstreamReq } from '@/apis/upstreams';
import { API_ROUTES, API_UPSTREAMS } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * The Import Routes modal: an OpenAPI spec or APISIX route JSON, parsed in the
 * browser and posted one route at a time. It had no e2e spec; the WSDL
 * importer next to it has routes.import-wsdl.spec.ts.
 */
const PREFIX = randomId('e2e-oas');
const PASSWORD = 'e2e-Oas-imp0rt!pass';

type Route = APISIXType['Route'] & { __team_id?: string };

const imported = async (): Promise<Route[]> =>
  (await listEvery<Route>(API_ROUTES))
    .map((d) => d.value)
    .filter((r) => r.name?.startsWith(PREFIX));

const deleteImported = async () => {
  const routes = await imported();
  await Promise.all(routes.map((r) => e2eReq.delete(`${API_ROUTES}/${r.id}`)));
};

// Every test reads what the others imported under the same prefix, so they
// run in one worker, in order, and clean up either side.
test.describe.configure({ mode: 'serial' });

test.beforeEach(deleteImported);

// What a test provisions beside the routes it imports, removed after them:
// APISIX refuses to delete an upstream a route still uses.
const provisioned: string[] = [];

test.afterEach(async () => {
  try {
    await deleteImported();
  } finally {
    for (const path of provisioned.splice(0)) {
      await e2eReq.delete(path).catch(() => null);
    }
  }
});

// APISIX refuses a route with nothing to send it to.
const upstream = { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] };
const op = (summary: string, extra: Record<string, unknown> = {}) => ({
  summary,
  'x-apisix-upstream': upstream,
  ...extra,
});

const spec = (paths: Record<string, unknown>) =>
  JSON.stringify({ openapi: '3.0.0', info: { title: 'pets', version: '1' }, paths });

const pets = spec({
  [`/${PREFIX}/pets`]: {
    get: op(`${PREFIX}-pets`),
    post: op(`${PREFIX}-pets`, {
      description: 'Lists and adds pets',
      servers: [{ url: 'http://pets.example.com/v1' }],
    }),
  },
  [`/${PREFIX}/health`]: { get: op(`${PREFIX}-health`, { 'x-apisix-status': 0 }) },
});

const dialog = (page: Page) => page.getByRole('dialog');

const openImporter = async (page: Page) => {
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await page.getByRole('button', { name: 'Import Routes' }).click();
  await expect(dialog(page)).toBeVisible();
};

const paste = (page: Page, content: string) =>
  dialog(page).getByPlaceholder('Paste OpenAPI spec or APISIX route JSON here...').fill(content);

const parse = (page: Page) => dialog(page).getByRole('button', { name: 'Parse' }).click();

test('imports the routes an OpenAPI spec describes', async ({ page }) => {
  await openImporter(page);
  await paste(page, pets);
  await parse(page);

  // The preview names the format and every route before anything is written.
  await expect(dialog(page).getByText('openapi', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('2 route(s) found')).toBeVisible();
  await expect(dialog(page).getByText(`/${PREFIX}/pets`, { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('GET, POST')).toBeVisible();
  expect(await imported()).toHaveLength(0);

  await dialog(page).getByRole('button', { name: 'Import 2 route(s)' }).click();
  await expect(dialog(page).getByText('2 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });

  // One route per path, its methods merged, the last operation's metadata.
  const byName = Object.fromEntries((await imported()).map((r) => [r.name, r]));
  expect(Object.keys(byName).sort()).toEqual([`${PREFIX}-health`, `${PREFIX}-pets`]);
  expect(byName[`${PREFIX}-pets`]).toMatchObject({
    uri: `/${PREFIX}/pets`,
    desc: 'Lists and adds pets',
    status: 1,
  });
  // A server names where the backend lives, not a host to match on (#396).
  expect(byName[`${PREFIX}-pets`].hosts).toBeUndefined();
  expect(byName[`${PREFIX}-pets`].methods?.slice().sort()).toEqual(['GET', 'POST']);
  expect(byName[`${PREFIX}-health`]).toMatchObject({
    uri: `/${PREFIX}/health`,
    methods: ['GET'],
    status: 0,
  });
});

test('importing the same spec again names the clashes, and a second click adds copies', async ({
  page,
}) => {
  await openImporter(page);
  await paste(page, pets);
  await parse(page);
  await dialog(page).getByRole('button', { name: 'Import 2 route(s)' }).click();
  await expect(dialog(page).getByText('2 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });
  await dialog(page).getByRole('button', { name: 'Back' }).click();

  await openImporter(page);
  await paste(page, pets);
  await parse(page);
  const importButton = dialog(page).getByRole('button', { name: 'Import 2 route(s)' });
  await importButton.click();

  // The first click only checks: it says what clashes and writes nothing.
  await expect(dialog(page).getByText('2 of these already exist on this gateway')).toBeVisible({
    timeout: 15000,
  });
  await expect(dialog(page).getByText(`"${PREFIX}-pets" clashes with ${PREFIX}-pets`)).toBeVisible();
  expect(await imported()).toHaveLength(2);

  // The second goes ahead: APISIX allows several routes on one path.
  await importButton.click();
  await expect(dialog(page).getByText('2 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });
  expect(await imported()).toHaveLength(4);
});

test('a route the gateway refuses is reported by name, and the others still land', async ({
  page,
}) => {
  await openImporter(page);
  await paste(
    page,
    spec({
      [`/${PREFIX}/good`]: { get: op(`${PREFIX}-good`) },
      // No upstream: APISIX refuses it.
      [`/${PREFIX}/bad`]: { get: { summary: `${PREFIX}-bad` } },
    })
  );
  await parse(page);
  // Said before anything is written, and still left to the operator.
  await expect(
    dialog(page).getByText(
      '1 route(s) have no backend, and APISIX will refuse them. Choose one above.'
    )
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Import 2 route(s)' }).click();

  await expect(dialog(page).getByText('1 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });
  await expect(dialog(page).getByText('1 route(s) failed to import')).toBeVisible();
  await expect(dialog(page).getByText(new RegExp(`^${PREFIX}-bad: .+`))).toBeVisible();
  expect((await imported()).map((r) => r.name)).toEqual([`${PREFIX}-good`]);
});

test('says what is wrong with input it cannot import', async ({ page }) => {
  await openImporter(page);

  await paste(page, JSON.stringify({ hello: 'world' }));
  await parse(page);
  await expect(
    dialog(page).getByText(
      'Unrecognized format. Expected OpenAPI spec, APISIX route JSON, or array of routes.'
    )
  ).toBeVisible();

  await paste(page, spec({}));
  await parse(page);
  await expect(dialog(page).getByText('No routes found in the provided data')).toBeVisible();

  // Not JSON at all: the parser's own message, whatever the browser words it.
  await paste(page, 'openapi: 3.0.0');
  await parse(page);
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: /^Import \d+ route/ })).toHaveCount(0);
  expect(await imported()).toHaveLength(0);
});

test('takes an uploaded file, and APISIX route JSON as well as OpenAPI', async ({
  page,
}, testInfo) => {
  const file = testInfo.outputPath('routes.json');
  writeFileSync(
    file,
    JSON.stringify([
      { name: `${PREFIX}-one`, uri: `/${PREFIX}/one`, methods: ['GET'], upstream },
      { name: `${PREFIX}-two`, uri: `/${PREFIX}/two`, upstream },
      { name: `${PREFIX}-no-uri` },
    ])
  );
  await openImporter(page);
  // The input sits behind the Upload button.
  await dialog(page).locator('input[type="file"]').setInputFiles(file);
  await expect(
    dialog(page).getByPlaceholder('Paste OpenAPI spec or APISIX route JSON here...')
  ).toHaveValue(new RegExp(`${PREFIX}-one`));
  await parse(page);

  // An entry with no uri is not a route, and is left out.
  await expect(dialog(page).getByText('apisix-array', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('2 route(s) found')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Import 2 route(s)' }).click();
  await expect(dialog(page).getByText('2 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });
  expect((await imported()).map((r) => r.name).sort()).toEqual([
    `${PREFIX}-one`,
    `${PREFIX}-two`,
  ]);
});

const PROXY = '/api/v1/apisix/admin';

test('an ordinary spec goes to its server, under the server\'s base path', async ({ page }) => {
  // The backend: a route on the gateway itself, under /v1, answering for the
  // server the spec names. The gateway reaches itself on 9080 in its container.
  const admin = await loginAdmin();
  const backendId = `backend-${PREFIX}`;
  const local = { 'X-Instance-ID': getFixtures().localInstanceId };
  await apiFetch(`${PROXY}/routes/${backendId}`, admin, {
    method: 'PUT',
    headers: local,
    json: {
      uri: `/v1/${PREFIX}/pets`,
      plugins: {
        mocking: {
          content_type: 'application/json',
          response_status: 200,
          response_example: '{"answered":"by the backend"}',
        },
      },
    },
  });
  provisioned.push(`${API_ROUTES}/${backendId}`);

  await openImporter(page);
  // No x-apisix extension anywhere: what any spec looks like.
  await paste(
    page,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'pets', version: '1' },
      servers: [{ url: 'http://127.0.0.1:9080/v1' }],
      paths: { [`/${PREFIX}/pets`]: { get: { summary: `${PREFIX}-plain` } } },
    })
  );
  await parse(page);

  // The servers are offered first, and the preview says where the route goes.
  await expect(dialog(page).getByRole('radio', { name: "From the spec's servers" })).toBeChecked();
  await expect(uiCell(dialog(page), '127.0.0.1:9080')).toBeVisible();
  await expect(dialog(page).getByText(/have no backend/)).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Import 1 route(s)' }).click();
  await expect(dialog(page).getByText('1 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });

  const [route] = await imported();
  expect(route?.upstream).toMatchObject({
    scheme: 'http',
    pass_host: 'node',
    nodes: { '127.0.0.1:9080': 1 },
  });

  // And it answers: /<prefix>/pets on the gateway is /v1/<prefix>/pets to the backend.
  const answer = (await apiFetch('/api/v1/test-route', admin, {
    method: 'POST',
    headers: local,
    json: { route_id: route!.id, method: 'GET', path: `/${PREFIX}/pets` },
  })) as { status: number; body: string };
  expect(answer.status).toBe(200);
  expect(answer.body).toContain('by the backend');
});

test('a templated path matches the requests it describes, and no others', async ({ page }) => {
  // The gateway's router knows nothing of {petId}: a path copied as is made a
  // route nothing reached (#399). The backend answers anything under /v1/<prefix>/pets/.
  const admin = await loginAdmin();
  const backendId = `backend-${PREFIX}`;
  const local = { 'X-Instance-ID': getFixtures().localInstanceId };
  await apiFetch(`${PROXY}/routes/${backendId}`, admin, {
    method: 'PUT',
    headers: local,
    json: {
      uri: `/v1/${PREFIX}/pets/*`,
      plugins: {
        mocking: {
          content_type: 'application/json',
          response_status: 200,
          response_example: '{"answered":"by the backend"}',
        },
      },
    },
  });
  provisioned.push(`${API_ROUTES}/${backendId}`);

  await openImporter(page);
  await paste(
    page,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'pets', version: '1' },
      servers: [{ url: 'http://127.0.0.1:9080/v1' }],
      paths: {
        [`/${PREFIX}/pets/{petId}`]: { get: { summary: `${PREFIX}-item` } },
        [`/${PREFIX}/pets/{petId}/toys`]: { get: { summary: `${PREFIX}-toys` } },
      },
    })
  );
  await parse(page);
  await dialog(page).getByRole('button', { name: 'Import 2 route(s)' }).click();
  await expect(dialog(page).getByText('2 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });

  const byName = Object.fromEntries((await imported()).map((r) => [r.name, r]));
  expect(byName[`${PREFIX}-item`]).toMatchObject({
    uri: `/${PREFIX}/pets/*`,
    vars: [['uri', '~~', `^/${PREFIX}/pets/[^/]+$`]],
  });

  // Asked of the gateway, which picks the route: the item and its toys each
  // answer, and a path neither describes is not swallowed by the prefix.
  const status = async (path: string) =>
    (
      (await apiFetch('/api/v1/test-route', admin, {
        method: 'POST',
        headers: local,
        json: { route_id: byName[`${PREFIX}-item`].id, method: 'GET', path },
      })) as { status: number }
    ).status;
  expect(await status(`/${PREFIX}/pets/42`)).toBe(200);
  expect(await status(`/${PREFIX}/pets/42/toys`)).toBe(200);
  expect(await status(`/${PREFIX}/pets/42/extra`)).toBe(404);
});

test('sends routes to an upstream chosen from the list', async ({ page }) => {
  const upstreamName = `${PREFIX}-chosen`;
  const created = await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }],
  });
  const upstreamId = created.data.value.id;
  provisioned.push(`${API_UPSTREAMS}/${upstreamId}`);

  await openImporter(page);
  await paste(page, spec({ [`/${PREFIX}/chosen`]: { get: { summary: `${PREFIX}-chosen` } } }));
  await parse(page);

  // Nothing in the spec says where it goes, and the modal says so.
  await expect(dialog(page).getByRole('radio', { name: 'As in the spec' })).toBeChecked();
  await expect(dialog(page).getByText(/1 route\(s\) have no backend/)).toBeVisible();

  await dialog(page).getByRole('radio', { name: 'Existing upstream' }).check();
  // Not before one is chosen.
  const importButton = dialog(page).getByRole('button', { name: 'Import 1 route(s)' });
  await expect(importButton).toBeDisabled();
  await dialog(page).getByRole('textbox', { name: 'Existing upstream' }).click();
  await page.getByRole('option', { name: upstreamName, exact: true }).click();

  await expect(dialog(page).getByText(/have no backend/)).toHaveCount(0);
  await expect(uiCell(dialog(page), `Upstream ${upstreamName}`)).toBeVisible();
  await importButton.click();
  await expect(dialog(page).getByText('1 route(s) imported successfully')).toBeVisible({
    timeout: 15000,
  });
  const [route] = await imported();
  expect(route?.upstream_id).toBe(upstreamId);
  expect(route?.upstream).toBeUndefined();
});

test.describe('a developer in one team and a viewer in another', () => {
  let viewed: Team;
  let developed: Team;

  test.beforeAll(async () => {
    const admin = await loginAdmin();
    viewed = await ensureTeam(admin, { name: `${PREFIX}-viewed` });
    developed = await ensureTeam(admin, { name: `${PREFIX}-developed` });
    const user = await ensureUser(admin, { username: `${PREFIX}-dev`, password: PASSWORD });
    await ensureUserInstanceRole(admin, user.id, getFixtures().localInstanceId, {
      role: 'developer',
      team_ids: [viewed.id, developed.id],
      team_roles: { [viewed.id]: 'viewer', [developed.id]: 'developer' },
    });
  });

  test.afterAll(async () => {
    // The routes first: a team that still owns something cannot be deleted.
    await deleteImported();
    await deleteUsersByPrefix(PREFIX);
    await deleteTeamsByPrefix(PREFIX);
  });

  const pickTeam = async (page: Page, team: Team, role: 'developer' | 'viewer') => {
    await headerTeamSelect(page).click();
    await page
      .getByRole('option', { name: `${team.name} · ${roleText(role)}`, exact: true })
      .click();
  };

  test('imports only into the team she develops in, which then owns the routes', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await permission.loginAs(page, `${PREFIX}-dev`, PASSWORD);
    await permission.switchInstance(page, 'Local APISIX');
    await routesPom.toIndex(page);
    await expect(headerTeamSelect(page)).toBeVisible({ timeout: 30000 });

    // With the team she views picked, nothing she could create is offered.
    await pickTeam(page, viewed, 'viewer');
    await expect(page.getByRole('heading', { name: 'Routes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Routes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import from WSDL' })).toHaveCount(0);

    await pickTeam(page, developed, 'developer');
    await page.getByRole('button', { name: 'Import Routes' }).click();
    await paste(page, spec({ [`/${PREFIX}/mine`]: { get: op(`${PREFIX}-mine`) } }));
    await parse(page);
    await dialog(page).getByRole('button', { name: 'Import 1 route(s)' }).click();
    await expect(dialog(page).getByText('1 route(s) imported successfully')).toBeVisible({
      timeout: 15000,
    });

    const [route] = await imported();
    expect(route?.name).toBe(`${PREFIX}-mine`);
    expect(route?.__team_id).toBe(developed.id);
  });
});

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
import { consumersPom } from '@e2e/pom/consumers';
import { permission } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
  type Team,
} from '@e2e/utils/seed-client';
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

/**
 * A viewer reads a route or a consumer, not its credentials (#463). The
 * proxy answered both as APISIX stores them, so a viewer read a route's
 * openid-connect client_secret, or a consumer's key-auth key, and could
 * call the API as that client. A developer of the team, who may write them,
 * still reads them.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-redact');
const PASSWORD = 'E2e-Redact!pass1';
const ROUTE = `${PREFIX}-route`;
// A consumer's username takes no dash.
const CONSUMER = `e2e_redact_${Date.now()}`;
const CLIENT_SECRET = `oidc-secret-${PREFIX}`;
const KEY = `key-auth-key-${PREFIX}`;
const SECRETS = [CLIENT_SECRET, KEY];
const MARKER = '"***"';

const TIMEOUT_MS = 120_000;

test.describe.configure({ mode: 'serial' });

let team: Team;
const viewer = `${PREFIX}-viewer`;
const developer = `${PREFIX}-dev`;
const local = (teamId?: string) => ({
  'X-Instance-ID': getFixtures().localInstanceId,
  ...(teamId ? { 'X-Team-ID': teamId } : {}),
});

test.beforeAll(async () => {
  const admin = await loginAdmin();
  team = await ensureTeam(admin, { name: `${PREFIX}-team` });
  for (const [username, role] of [
    [viewer, 'viewer'],
    [developer, 'developer'],
  ] as const) {
    const user = await ensureUser(admin, { username, password: PASSWORD });
    await ensureUserInstanceRole(admin, user.id, getFixtures().localInstanceId, {
      role,
      team_id: team.id,
    });
  }
  await apiFetch(`${PROXY}/routes/${ROUTE}`, admin, {
    method: 'PUT',
    headers: local(team.id),
    json: {
      uri: `/${ROUTE}`,
      name: ROUTE,
      upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
      plugins: {
        'openid-connect': {
          client_id: `${PREFIX}-client`,
          client_secret: CLIENT_SECRET,
          discovery: 'http://127.0.0.1:8180/realms/apis/.well-known/openid-configuration',
          bearer_only: true,
        },
      },
    },
  });
  await apiFetch(`${PROXY}/consumers/${CONSUMER}`, admin, {
    method: 'PUT',
    headers: local(team.id),
    json: { username: CONSUMER, plugins: { 'key-auth': { key: KEY } } },
  });
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  try {
    for (const path of [`/routes/${ROUTE}`, `/consumers/${CONSUMER}`]) {
      await apiFetch(`${PROXY}${path}`, admin, {
        method: 'DELETE',
        headers: local(),
      }).catch(() => undefined);
    }
  } finally {
    await deleteUsersByPrefix(PREFIX);
    await deleteTeamsByPrefix(PREFIX);
  }
});

/** Every answer the proxy gave as each read, as text. */
const reads = async (token: string) => {
  const paths = [
    `/routes/${ROUTE}`,
    `/routes?name=${ROUTE}&page_size=50`,
    `/consumers/${CONSUMER}`,
    '/consumers?page_size=500',
  ];
  return Promise.all(
    paths.map(async (path) =>
      JSON.stringify(await apiFetch(`${PROXY}${path}`, token, { headers: local() }))
    )
  );
};

test('a viewer reads the route and the consumer without their credentials', async () => {
  const answers = await reads(await loginAdmin(viewer, PASSWORD));
  for (const answer of answers) {
    for (const secret of SECRETS) expect(answer).not.toContain(secret);
  }
  // Each in place of the credential, not the whole plugin taken away.
  expect(answers[0]).toContain(`"client_secret":${MARKER}`);
  expect(answers[0]).toContain(`${PREFIX}-client`);
  expect(answers[2]).toContain(`"key":${MARKER}`);
});

test('a developer of the team, and an admin, still read them', async () => {
  for (const token of [await loginAdmin(developer, PASSWORD), await loginAdmin()]) {
    const [route, routes, consumer, consumers] = await reads(token);
    expect(route).toContain(CLIENT_SECRET);
    expect(routes).toContain(CLIENT_SECRET);
    expect(consumer).toContain(KEY);
    expect(consumers).toContain(KEY);
  }
});

/**
 * Opens the route's and the consumer's detail pages as username, and returns
 * every Admin API answer the pages received, and the pages' own text.
 */
const browse = async (page: Page, username: string) => {
  const answers: Promise<string>[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/apisix/admin/')) {
      answers.push(res.text().catch(() => ''));
    }
  });
  await permission.loginAs(page, username, PASSWORD);
  await permission.switchInstance(page, 'Local APISIX');

  const route = page.waitForResponse((res) => res.url().includes(`/apisix/admin/routes/${ROUTE}`));
  await uiGoto(page, '/routes/detail/$id', { id: ROUTE });
  await routesPom.isDetailPage(page);
  await route;
  const routePage = await page.content();

  const consumer = page.waitForResponse((res) =>
    res.url().includes(`/apisix/admin/consumers/${CONSUMER}`)
  );
  await uiGoto(page, '/consumers/detail/$username', { username: CONSUMER });
  await consumersPom.isDetailPage(page);
  await consumer;
  const consumerPage = await page.content();

  return { answers: await Promise.all(answers), pages: [routePage, consumerPage] };
};

test('a viewer browsing the pages receives no credential', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });
  try {
    const { answers, pages } = await browse(await context.newPage(), viewer);
    expect(answers.some((a) => a.includes(MARKER))).toBe(true);
    for (const text of [...answers, ...pages]) {
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
  } finally {
    await context.close();
  }
});

test('a developer browsing the same pages receives them', async ({ browser }) => {
  test.setTimeout(TIMEOUT_MS);
  const context = await browser.newContext({ storageState: undefined });
  try {
    const { answers } = await browse(await context.newPage(), developer);
    for (const secret of SECRETS) {
      expect(answers.some((a) => a.includes(secret))).toBe(true);
    }
  } finally {
    await context.close();
  }
});

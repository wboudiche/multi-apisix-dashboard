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
import { routesPom } from '@e2e/pom/routes';
import { randomId } from '@e2e/utils/common';
import { e2eReq, listEvery } from '@e2e/utils/req';
import { stack } from '@e2e/utils/stack';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { API_CONSUMERS, API_ROUTES, API_UPSTREAMS } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * Quick route on the routes list opens a dialog that makes a route from a
 * path and a destination, posted as the wizard would post it, and hands over
 * to the wizard - "Continue in the advanced form" - answers and all, for
 * anything more.
 */

const prefix = `/e2e-quick-${randomId('r')}`;
const upstreamId = `e2e-quick-${randomId('u')}`;

const routesUnder = async () =>
  (await listEvery<APISIXType['Route']>(API_ROUTES))
    .map((r) => r.value)
    .filter((r) => r.uri?.startsWith(prefix));

const openDialog = async (page: Page) => {
  await routesPom.toIndex(page);
  await routesPom.getAddRouteBtn(page).click();
  const dialog = page.getByRole('dialog', { name: 'New route' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test.beforeAll(async () => {
  await e2eReq.put(`${API_UPSTREAMS}/${upstreamId}`, {
    name: upstreamId,
    type: 'roundrobin',
    nodes: { '127.0.0.1:1980': 1 },
  });
});

test.afterAll(async () => {
  for (const route of await routesUnder()) {
    await e2eReq.delete(`${API_ROUTES}/${route.id}`).catch(() => null);
  }
  await e2eReq.delete(`${API_UPSTREAMS}/${upstreamId}`).catch(() => null);
});

test('makes a route from a path and an address, as the wizard would', async ({ page }) => {
  const path = `${prefix}/orders/*`;
  const dialog = await openDialog(page);

  await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
  await dialog.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980/v1');
  await dialog.getByRole('textbox', { name: 'Host' }).fill('quick.example.com');
  // The name follows the path until it is typed in.
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(path);

  await dialog.getByRole('button', { name: 'Create offline' }).click();
  await expect(dialog).toBeHidden();
  await expect(routesPom.rowByName(page, path).first()).toBeVisible();

  const [route] = (await routesUnder()).filter((r) => r.uri === path);
  expect(route).toMatchObject({
    name: path,
    uri: path,
    host: 'quick.example.com',
    status: 0,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    upstream: {
      type: 'roundrobin',
      scheme: 'http',
      pass_host: 'node',
      nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }],
      timeout: { connect: 6, send: 6, read: 6 },
    },
    // The address's path is where the backend's API lives.
    plugins: { 'proxy-rewrite': { regex_uri: ['^(.*)$', '/v1$1'] } },
  });
});

test('points a route at an existing upstream', async ({ page }) => {
  const path = `${prefix}/by-upstream`;
  const dialog = await openDialog(page);

  await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
  await dialog.locator('label').filter({ hasText: /^Existing upstream$/ }).click();
  await dialog.getByRole('textbox', { name: 'Existing upstream' }).click();
  await page.getByRole('option', { name: upstreamId }).click();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden();

  const [route] = (await routesUnder()).filter((r) => r.uri === path);
  expect(route.upstream_id).toBe(upstreamId);
  expect(route.upstream).toBeUndefined();
  expect(route.status).toBe(1);
});

test('says what is missing rather than posting it', async ({ page }) => {
  const dialog = await openDialog(page);
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(API_ROUTES)) posted = true;
  });

  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByText('URI is required')).toBeVisible();
  await expect(dialog.getByText("Enter the backend's address")).toBeVisible();

  await dialog.getByRole('textbox', { name: 'Address' }).fill('127.0.0.1:1980');
  await expect(dialog.getByText('An address starting with http:// or https://')).toBeVisible();
  expect(posted).toBe(false);
});

test('warns of a route already on the path', async ({ page }) => {
  const path = `${prefix}/taken`;
  await e2eReq.put(`${API_ROUTES}/${randomId('e2e-quick-taken')}`, {
    name: 'already-here',
    uri: path,
    upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
  });
  const dialog = await openDialog(page);

  await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
  // Why it is one, as the wizard says it: on this path, not of this name.
  await expect(dialog.getByRole('alert')).toContainText(`"already-here" already answers on ${path}`);
});

test('hands what was typed over to the wizard', async ({ page }) => {
  const path = `${prefix}/more`;
  const dialog = await openDialog(page);

  await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
  await dialog.getByRole('textbox', { name: 'Address' }).fill('https://backend.example.com');
  await dialog.getByRole('button', { name: 'Continue in the advanced form' }).click();

  await routesPom.isAddPage(page);
  await expect(page.locator('input[name="uri"]')).toHaveValue(path);
  await expect(page.locator('input[name="name"]')).toHaveValue(path);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('input[name="upstream.nodes.0.host"]')).toHaveValue('backend.example.com');
  await expect(page.locator('input[name="upstream.nodes.0.port"]')).toHaveValue('443');

  // The draft is the wizard's own: leave none behind for the next spec.
  await page.getByRole('button', { name: 'Discard Draft' }).click();
});

test('tests the address the way the upstream form does', async ({ page }) => {
  const dialog = await openDialog(page);
  // Its own answers, not the dialog's other alerts (a duplicate, a refusal).
  const test = dialog.getByRole('region', { name: 'Test Connection' });

  // Offered once an address is being typed, greyed out until it is one.
  await expect(test).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Address' }).fill('http://');
  await expect(test.getByRole('button', { name: 'Test Connection' })).toBeDisabled();

  // An internal address is not dialed (#304), and says so rather than failing.
  await dialog.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');
  await test.getByRole('button', { name: 'Test Connection' }).click();
  await expect(test.getByRole('alert')).toContainText('127.0.0.1:1980');
  await expect(test.getByRole('alert')).toContainText('Not tested');

  // Another address is another question: the last answer goes.
  await dialog.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1981');
  await expect(test.getByRole('alert')).toHaveCount(0);
});

test('lets only the clients picked call a route made in the dialog', async ({ page }) => {
  const path = `${prefix}/keyed`;
  const id = randomId('c');
  const allowed = `e2e-quick-a-${id}`;
  const other = `e2e-quick-b-${id}`;
  for (const username of [allowed, other]) {
    await e2eReq.put(API_CONSUMERS, {
      username,
      plugins: { 'key-auth': { key: `${username}-key` } },
    });
  }
  try {
    const dialog = await openDialog(page);
    await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
    await dialog.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

    await test.step('anyone, until said otherwise', async () => {
      await expect(dialog.getByRole('radio', { name: 'Anyone' })).toBeChecked();
      await expect(dialog.getByTestId('auth-clients')).toBeHidden();
    });

    await test.step('a password is said to need HTTPS', async () => {
      await dialog.locator('label').filter({ hasText: /^Username and password$/ }).click();
      await expect(dialog.getByText('The password travels with every request', { exact: false })).toBeVisible();
    });

    const clients = dialog.getByTestId('auth-clients');

    await test.step('a key, narrowed to the clients picked, waits for one', async () => {
      await dialog.locator('label').filter({ hasText: /^Clients with a key$/ }).click();
      await clients.getByRole('radio', { name: 'Only the clients picked' }).check();
      await expect(clients.getByText('Pick at least one client.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toBeVisible();
      expect((await routesUnder()).filter((r) => r.uri === path)).toEqual([]);
    });

    await test.step('created with the key and the allow-list', async () => {
      await clients.getByRole('textbox', { name: 'Clients allowed' }).fill(`a-${id}`);
      await page.getByRole('option', { name: allowed }).click();
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toBeHidden();

      const [route] = (await routesUnder()).filter((r) => r.uri === path);
      expect(route.plugins).toEqual({
        'key-auth': expect.any(Object),
        'consumer-restriction': expect.objectContaining({ whitelist: [allowed] }),
      });
    });

    await test.step('the gateway lets the client picked through, and no other', async () => {
      const call = (key?: string) =>
        fetch(`${stack.gateway}${path}`, { headers: key ? { apikey: key } : {} }).then((r) => r.status);
      // The gateway reads the route from etcd a moment after it is written.
      await expect.poll(() => call(), { timeout: 15000 }).toBe(401);
      expect(await call(`${other}-key`)).toBe(403);
      // Past both checks: what answers now is the backend, or its absence.
      expect([401, 403]).not.toContain(await call(`${allowed}-key`));
    });
  } finally {
    for (const username of [allowed, other]) {
      await e2eReq.delete(`${API_CONSUMERS}/${username}`).catch(() => null);
    }
  }
});

test('limits the calls to a route made in the dialog', async ({ page }) => {
  const path = `${prefix}/limited`;
  const dialog = await openDialog(page);
  await dialog.getByRole('textbox', { name: 'Path' }).fill(path);
  await dialog.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  await test.step('no limit until asked for one', async () => {
    await expect(dialog.getByRole('switch', { name: 'Limit the number of calls' })).not.toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Requests' })).toBeHidden();
  });

  await test.step('a limit with no count is refused', async () => {
    await dialog.locator('label').filter({ hasText: /^Limit the number of calls$/ }).click();
    await expect(dialog.getByText('Counted for each IP address', { exact: false })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Requests' }).fill('');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByText('A whole number, 1 or more')).toBeVisible();
  });

  await test.step('two a minute, written as a limit-count', async () => {
    await dialog.getByRole('textbox', { name: 'Requests' }).fill('2');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toBeHidden();
    const [route] = (await routesUnder()).filter((r) => r.uri === path);
    expect(route.plugins?.['limit-count']).toEqual({
      count: 2,
      time_window: 60,
      key_type: 'var',
      key: 'remote_addr',
      rejected_code: 429,
      policy: 'local',
    });
  });

  await test.step('the gateway turns the third call of the minute away', async () => {
    const call = () => fetch(`${stack.gateway}${path}`).then((r) => r.status);
    // Not counted until the gateway has read the route: a 404 is no call.
    await expect.poll(call, { timeout: 15000 }).not.toBe(404);
    await call();
    expect(await call()).toBe(429);
  });
});

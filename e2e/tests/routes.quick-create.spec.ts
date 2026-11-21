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
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

import { API_CONSUMERS, API_ROUTES, API_SERVICES, API_UPSTREAMS } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * Quick route on the routes list opens a page that makes a route from a
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

const openForm = async (page: Page) => {
  await routesPom.toIndex(page);
  await routesPom.getAddRouteBtn(page).click();
  const form = page.getByRole('region', { name: 'New route' });
  await expect(form).toBeVisible();
  return form;
};

/**
 * The answers of `n` calls the gateway counted, sent one after the other,
 * with a key when one is given. A
 * 404 is a gateway worker that has not read the route yet: no call to count,
 * so it is sent again. Fewer than `n` if the route never shows up.
 */
const countedCalls = async (url: string, n: number, apikey?: string): Promise<number[]> => {
  const counted: number[] = [];
  const deadline = Date.now() + 15000;
  while (counted.length < n && Date.now() < deadline) {
    const status = await fetch(url, { headers: apikey ? { apikey } : {} }).then((r) => r.status);
    if (status !== 404) counted.push(status);
    else await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return counted;
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
  const form = await openForm(page);

  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980/v1');
  await form.getByRole('textbox', { name: 'Host' }).fill('quick.example.com');
  // The name follows the path until it is typed in.
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue(path);

  await form.getByRole('button', { name: 'Create offline' }).click();
  await expect(form).toBeHidden();
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

test('is a page of its own, which Cancel leaves for the list', async ({ page }) => {
  const path = `${prefix}/left`;
  const form = await openForm(page);
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/routes/quick'));
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await routesPom.isIndexPage(page);
  expect((await routesUnder()).filter((r) => r.uri === path)).toHaveLength(0);
});

test('asks before a link elsewhere throws away what was typed', async ({ page }) => {
  const path = `${prefix}/asked`;
  const form = await openForm(page);
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  const ask = page.getByRole('dialog', { name: 'Unsaved Changes' });

  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/routes/quick'));
  await expect(form.getByRole('textbox', { name: 'Path' })).toHaveValue(path);

  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();
  await ask.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/upstreams'));
});

test('opened by its address, lands on the list with the route made', async ({ page }) => {
  const path = `${prefix}/direct`;
  await uiGoto(page, '/routes/quick');
  const form = page.getByRole('region', { name: 'New route' });
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  await form.getByRole('button', { name: 'Create offline' }).click();
  await routesPom.isIndexPage(page);
  await expect(routesPom.rowByName(page, path).first()).toBeVisible();
});

test('says so when the route to copy is not there', async ({ page }) => {
  // All digits, as an APISIX id often is: the router reads it as a number.
  await uiGoto(page, '/routes/quick');
  await page.goto(`${page.url()}?from=9${Date.now()}`);
  await expect(page.getByTestId('detail-not-found')).toBeVisible();
  await page.getByRole('button', { name: 'Back to list' }).click();
  await routesPom.isIndexPage(page);
});

test('keeps whoever left during a create where they went', async ({ page }) => {
  const path = `${prefix}/left-early`;
  const form = await openForm(page);
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  // A slow gateway: the create settles after the page is left.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/apisix/admin/routes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held;
    await route.fallback();
  });
  const posted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/apisix/admin/routes')
  );
  await form.getByRole('button', { name: 'Create offline' }).click();
  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/upstreams'));

  release();
  await posted;
  await expect.poll(async () => (await routesUnder()).some((r) => r.uri === path)).toBe(true);
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/upstreams'));
});

test('tells whoever left during a create that it was refused', async ({ page }) => {
  const path = `${prefix}/refused-late`;
  const form = await openForm(page);
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/apisix/admin/routes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held;
    await route.fulfill({ status: 400, json: { error_msg: 'refused by the e2e gateway' } });
  });
  await form.getByRole('button', { name: 'Create offline' }).click();
  await page.getByRole('link', { name: 'Upstreams', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/upstreams'));

  release();
  await expect(page.getByRole('alert').filter({ hasText: 'refused by the e2e gateway' }).first()).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname.endsWith('/upstreams'));
});

test('points a route at an existing upstream', async ({ page }) => {
  const path = `${prefix}/by-upstream`;
  const form = await openForm(page);

  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.locator('label').filter({ hasText: /^Existing upstream$/ }).click();
  await form.getByRole('textbox', { name: 'Existing upstream' }).click();
  await page.getByRole('option', { name: upstreamId }).click();
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form).toBeHidden();

  const [route] = (await routesUnder()).filter((r) => r.uri === path);
  expect(route.upstream_id).toBe(upstreamId);
  expect(route.upstream).toBeUndefined();
  expect(route.status).toBe(1);
});

test('says what is missing rather than posting it', async ({ page }) => {
  const form = await openForm(page);
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(API_ROUTES)) posted = true;
  });

  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form.getByText('URI is required')).toBeVisible();
  await expect(form.getByText("Enter the backend's address")).toBeVisible();

  await form.getByRole('textbox', { name: 'Address' }).fill('127.0.0.1:1980');
  await expect(form.getByText('An address starting with http:// or https://')).toBeVisible();
  expect(posted).toBe(false);
});

test('warns of a route already on the path', async ({ page }) => {
  const path = `${prefix}/taken`;
  await e2eReq.put(`${API_ROUTES}/${randomId('e2e-quick-taken')}`, {
    name: 'already-here',
    uri: path,
    upstream: { nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin' },
  });
  const form = await openForm(page);

  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  // Why it is one, as the wizard says it: on this path, not of this name.
  await expect(form.getByRole('alert')).toContainText(`"already-here" already answers on ${path}`);
});

test('hands what was typed over to the wizard', async ({ page }) => {
  const path = `${prefix}/more`;
  const form = await openForm(page);

  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('https://backend.example.com');
  await form.getByRole('button', { name: 'Continue in the advanced form' }).click();

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
  const form = await openForm(page);
  // Its own answers, not the form's other alerts (a duplicate, a refusal).
  const test = form.getByRole('region', { name: 'Test Connection' });

  // Offered once an address is being typed, greyed out until it is one.
  await expect(test).toHaveCount(0);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://');
  await expect(test.getByRole('button', { name: 'Test Connection' })).toBeDisabled();

  // An internal address is not dialed (#304), and says so rather than failing.
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');
  await test.getByRole('button', { name: 'Test Connection' }).click();
  await expect(test.getByRole('alert')).toContainText('127.0.0.1:1980');
  await expect(test.getByRole('alert')).toContainText('Not tested');

  // Another address is another question: the last answer goes.
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1981');
  await expect(test.getByRole('alert')).toHaveCount(0);
});

test('lets only the clients picked call a route made on the quick page', async ({ page }) => {
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
    const form = await openForm(page);
    await form.getByRole('textbox', { name: 'Path' }).fill(path);
    await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

    await test.step('anyone, until said otherwise', async () => {
      await expect(form.getByRole('radio', { name: 'Anyone' })).toBeChecked();
      await expect(form.getByTestId('auth-clients')).toBeHidden();
    });

    await test.step('a password is said to need HTTPS', async () => {
      await form.locator('label').filter({ hasText: /^Username and password$/ }).click();
      await expect(form.getByText('The password travels with every request', { exact: false })).toBeVisible();
    });

    const clients = form.getByTestId('auth-clients');

    await test.step('a key, narrowed to the clients picked, waits for one', async () => {
      await form.locator('label').filter({ hasText: /^Clients with a key$/ }).click();
      await clients.getByRole('radio', { name: 'Only the clients picked' }).check();
      await expect(clients.getByText('Pick at least one client.')).toBeVisible();
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(form).toBeVisible();
      expect((await routesUnder()).filter((r) => r.uri === path)).toEqual([]);
    });

    await test.step('created with the key and the allow-list', async () => {
      await clients.getByRole('button', { name: 'Clients allowed' }).click();
      const list = page.getByTestId('client-dropdown');
      await list.getByRole('textbox', { name: 'Search the clients' }).fill(`a-${id}`);
      await list.getByRole('checkbox', { name: allowed, exact: true }).check();
      await page.keyboard.press('Escape');
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(form).toBeHidden();

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

test('picks the clients a search shows, all at once', async ({ page }) => {
  const path = `${prefix}/partners`;
  const id = randomId('p');
  const partners = [1, 2, 3].map((n) => `e2e-quick-partner-${id}-${n}`);
  const outsider = `e2e-quick-outsider-${id}`;
  for (const username of [...partners, outsider]) {
    await e2eReq.put(API_CONSUMERS, {
      username,
      plugins: { 'key-auth': { key: `${username}-key` } },
    });
  }
  try {
    const form = await openForm(page);
    await form.getByRole('textbox', { name: 'Path' }).fill(path);
    await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');
    await form.locator('label').filter({ hasText: /^Clients with a key$/ }).click();
    const clients = form.getByTestId('auth-clients');

    const dropdown = page.getByTestId('client-dropdown');

    await test.step('every holder is counted in a field that opens on them', async () => {
      await expect(clients.getByTestId('client-count')).toHaveText(/^\d+ in all$/);
      await expect(dropdown).toBeHidden();
      await clients.getByRole('button', { name: 'Clients holding a credential' }).click();
      // Found by its name: the list draws the first names only.
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(outsider);
      await expect(dropdown.getByRole('listitem').filter({ hasText: outsider })).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(dropdown).toBeHidden();
    });

    await test.step('a search, then all it shows', async () => {
      await clients.getByRole('radio', { name: 'Only the clients picked' }).check();
      await clients.getByRole('button', { name: 'Clients allowed' }).click();
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(`partner-${id}`);
      await expect(dropdown.getByRole('checkbox', { name: outsider })).toBeHidden();
      await dropdown.getByRole('checkbox', { name: /^All \(/ }).check();
      // Still open after a tick: several are picked in a row.
      await expect(dropdown).toBeVisible();
      await expect(clients.getByTestId('client-count')).toHaveText(/^3 of \d+ picked$/);
      // What the search hid is left as it was.
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill('');
      await expect(dropdown.getByRole('checkbox', { name: outsider, exact: true })).not.toBeChecked();
      await page.keyboard.press('Escape');
    });

    await test.step('created with those three only', async () => {
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(form).toBeHidden();
      const [route] = (await routesUnder()).filter((r) => r.uri === path);
      expect(
        (route.plugins?.['consumer-restriction'] as { whitelist: string[] }).whitelist.slice().sort()
      ).toEqual(partners);
    });

    await test.step('Clear unticks the ones shown, and only those', async () => {
      const again = await openForm(page);
      await again.locator('label').filter({ hasText: /^Clients with a key$/ }).click();
      const list = again.getByTestId('auth-clients');
      await list.getByRole('radio', { name: 'Only the clients picked' }).check();
      await list.getByRole('button', { name: 'Clients allowed' }).click();
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(`partner-${id}`);
      await dropdown.getByRole('checkbox', { name: /^All \(/ }).check();
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(outsider);
      await dropdown.getByRole('checkbox', { name: outsider, exact: true }).check();
      await expect(list.getByTestId('client-count')).toHaveText(/^4 of \d+ picked$/);

      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(`partner-${id}`);
      await dropdown.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(list.getByTestId('client-count')).toHaveText(/^1 of \d+ picked$/);
      await dropdown.getByRole('textbox', { name: 'Search the clients' }).fill(outsider);
      await expect(dropdown.getByRole('checkbox', { name: outsider, exact: true })).toBeChecked();
    });
  } finally {
    for (const username of [...partners, outsider]) {
      await e2eReq.delete(`${API_CONSUMERS}/${username}`).catch(() => undefined);
    }
  }
});

test('limits the calls to a route made on the quick page', async ({ page }) => {
  const path = `${prefix}/limited`;
  const form = await openForm(page);
  await form.getByRole('textbox', { name: 'Path' }).fill(path);
  await form.getByRole('textbox', { name: 'Address' }).fill('http://127.0.0.1:1980');

  await test.step('no limit until asked for one', async () => {
    await expect(form.getByRole('switch', { name: 'Limit the number of calls' })).not.toBeChecked();
    await expect(form.getByRole('textbox', { name: 'Requests' })).toBeHidden();
  });

  await test.step('a limit with no count is refused', async () => {
    await form.locator('label').filter({ hasText: /^Limit the number of calls$/ }).click();
    await expect(form.getByText('Counted for each IP address', { exact: false })).toBeVisible();
    await form.getByRole('textbox', { name: 'Requests' }).fill('');
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(form.getByText('A whole number, 1 or more')).toBeVisible();
  });

  await test.step('two a minute, written as a limit-count', async () => {
    await form.getByRole('textbox', { name: 'Requests' }).fill('2');
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(form).toBeHidden();
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
    const counted = await countedCalls(`${stack.gateway}${path}`, 3);
    expect(counted).toHaveLength(3);
    expect(counted.slice(0, 2)).not.toContain(429);
    expect(counted[2]).toBe(429);
  });
});

test('starts from the clients a route\'s service lets through, and can open it to all', async ({ page }) => {
  const path = `${prefix}/on-service`;
  const id = randomId('s');
  const serviceId = `e2e-quick-svc-${id}`;
  const allowed = `e2e-quick-sa-${id}`;
  const other = `e2e-quick-sb-${id}`;
  for (const username of [allowed, other]) {
    await e2eReq.put(API_CONSUMERS, {
      username,
      plugins: { 'key-auth': { key: `${username}-key` } },
    });
  }
  await e2eReq.put(`${API_SERVICES}/${serviceId}`, {
    name: serviceId,
    upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
    plugins: { 'key-auth': {}, 'consumer-restriction': { whitelist: [allowed] } },
  });
  try {
    const form = await openForm(page);
    await form.getByRole('textbox', { name: 'Path' }).fill(path);
    await form.locator('label').filter({ hasText: /^Service$/ }).click();
    await form.getByRole('textbox', { name: 'Service' }).click();
    await page.getByRole('option', { name: serviceId }).click();
    await form.locator('label').filter({ hasText: /^Clients with a key$/ }).click();

    const clients = form.getByTestId('auth-clients');

    await test.step('the service\'s clients are where the choice starts', async () => {
      await expect(form.getByText('The service already limits who can call', { exact: false })).toBeVisible();
      await expect(clients.getByRole('radio', { name: 'Only the clients picked' })).toBeChecked();
      await expect(clients.getByTestId('client-count')).toHaveText(/^1 of \d+ picked$/);
      // First in the list, however many clients sort before it.
      await clients.getByRole('button', { name: 'Clients allowed' }).click();
      const list = page.getByTestId('client-dropdown');
      await expect(list.getByTestId('client-list').getByRole('checkbox').first()).toHaveAccessibleName(allowed);
      await expect(list.getByRole('checkbox', { name: allowed, exact: true })).toBeChecked();
      await page.keyboard.press('Escape');
    });

    await test.step('every client, and the service\'s list no longer holds on this route', async () => {
      await clients.getByRole('radio', { name: 'Every client holding a credential' }).check();
      // A look at another destination and back keeps the choice made.
      await form.locator('label').filter({ hasText: /^Address$/ }).click();
      await form.locator('label').filter({ hasText: /^Service$/ }).click();
      await expect(clients.getByRole('radio', { name: 'Every client holding a credential' })).toBeChecked();
      await form.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(form).toBeHidden();

      const [route] = (await routesUnder()).filter((r) => r.uri === path);
      expect(route.service_id).toBe(serviceId);
      expect(route.plugins?.['consumer-restriction']).toEqual({
        whitelist: [allowed],
        _meta: { disable: true },
      });
      const counted = await countedCalls(`${stack.gateway}${path}`, 1, `${other}-key`);
      expect(counted).toHaveLength(1);
      expect([401, 403]).not.toContain(counted[0]);
    });
  } finally {
    for (const route of (await routesUnder()).filter((r) => r.uri === path)) {
      await e2eReq.delete(`${API_ROUTES}/${route.id}`).catch(() => null);
    }
    await e2eReq.delete(`${API_SERVICES}/${serviceId}`).catch(() => null);
    for (const username of [allowed, other]) {
      await e2eReq.delete(`${API_CONSUMERS}/${username}`).catch(() => null);
    }
  }
});


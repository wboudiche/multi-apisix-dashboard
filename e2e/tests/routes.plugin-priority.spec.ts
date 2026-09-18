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
import { env } from '@e2e/utils/env';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { getRouteReq, putRouteReq } from '@/apis/routes';
import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * A route's plugins run in priority order, highest first - not in the order
 * they appear in the object, which is JSON and has none. The list showed them
 * by insertion, so it said nothing about what happens to a request, and the
 * priority itself was not on the page at all (#48).
 */

const ROUTE_ID = randomId('plugin-priority');
const DETAIL_URL = `${env.E2E_TARGET_URL.replace(/\/$/, '')}/routes/detail/${ROUTE_ID}`;

// Written with the low-priority plugin first, so that insertion order and
// execution order disagree: APISIX runs key-auth (2500) before limit-count
// (1002).
const route: APISIXType['Route'] = {
  id: ROUTE_ID,
  name: ROUTE_ID,
  uri: `/${ROUTE_ID}`,
  methods: ['GET'],
  plugins: {
    'limit-count': { count: 2, time_window: 60, rejected_code: 503 },
    'key-auth': {},
    // The Request Override step rebuilds this one from its own fields, which
    // is where a priority set here used to be dropped.
    'proxy-rewrite': { host: 'first.example.com' },
  },
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
};

test.beforeEach(async () => {
  await putRouteReq(e2eReq, route);
});

test.afterEach(async () => {
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_ID}`);
});

// The route wizard's Plugins step is the 4th of five, so three Next clicks from
// step 1 - the same walk routes.multiple-plugins.spec.ts makes.
const STEPS_TO_PLUGINS = 3;

const openPluginsStep = async (page: Page) => {
  await page.goto(DETAIL_URL);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (let i = 0; i < STEPS_TO_PLUGINS; i++) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.getByRole('button', { name: 'Select Plugins' })).toBeVisible();
};

/** The plugin names as the page lists them, top to bottom. */
const listedOrder = (page: Page) =>
  page
    // Not the editor's own field, which shares the prefix.
    .locator('[data-testid^="plugin-priority-"]:not([data-testid$="-input"])')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') ?? '').replace('plugin-priority-', ''))
    );

test('lists the plugins in the order the gateway runs them, with the number', async ({
  page,
}) => {
  await openPluginsStep(page);

  // key-auth (2500) first, then proxy-rewrite (1008), then limit-count (1002)
  // - though the route was written with limit-count first.
  await expect
    .poll(() => listedOrder(page))
    .toEqual(['key-auth', 'proxy-rewrite', 'limit-count']);

  // The numbers are the gateway's own, served beside the schemas.
  await expect(page.getByTestId('plugin-priority-key-auth')).toHaveText('priority 2500');
  await expect(page.getByTestId('plugin-priority-limit-count')).toHaveText('priority 1002');
});

test('lets a route overrule the order, and says it did', async ({ page }) => {
  await openPluginsStep(page);

  await page.getByTestId('plugin-limit-count').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('plugin-priority-input');
  // The gateway's number is offered as the placeholder, so the operator can
  // see what they are overruling.
  await expect(editor).toHaveAttribute('placeholder', '1002');
  await editor.fill('9999');

  await page.getByRole('button', { name: 'Save', exact: true }).first().click();

  // The badge says the number is a decision, and the card moves to the top.
  await expect(page.getByTestId('plugin-priority-limit-count')).toHaveText(
    'priority 9999, set here'
  );
  await expect
    .poll(() => listedOrder(page))
    .toEqual(['limit-count', 'key-auth', 'proxy-rewrite']);

  // And it reaches the gateway, under the key APISIX reads.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect
    .poll(async () => {
      const saved = await getRouteReq(e2eReq, ROUTE_ID);
      const plugins = saved.value.plugins as Record<string, { _meta?: { priority?: number } }>;
      return plugins['limit-count']?._meta?.priority;
    })
    .toBe(9999);
});

test('a priority left half-typed is not a priority', async ({ page }) => {
  await openPluginsStep(page);

  await page.getByTestId('plugin-limit-count').getByRole('button', { name: 'Edit' }).click();
  const field = page.getByTestId('plugin-priority-input');

  // A minus sign and nothing after it: a number field mid-edit. Nothing about
  // it may reach the config - a NaN there serialises to null, which the Admin
  // API refuses, and the badge would claim the route had decided something.
  await field.pressSequentially('-');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();

  await expect(page.getByTestId('plugin-priority-limit-count')).toHaveText('priority 1002');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect
    .poll(async () => {
      const saved = await getRouteReq(e2eReq, ROUTE_ID);
      const plugins = saved.value.plugins as Record<string, { _meta?: unknown }>;
      return plugins['limit-count']?._meta;
    })
    .toBeUndefined();
});

test('takes a priority below zero, typed a character at a time', async ({ page }) => {
  await openPluginsStep(page);

  await page.getByTestId('plugin-limit-count').getByRole('button', { name: 'Edit' }).click();
  const field = page.getByTestId('plugin-priority-input');

  // Typed rather than filled: the minus sign arrives on its own, before there
  // is a number to speak of, and the field has to survive that to let a
  // negative priority be entered at all.
  await field.pressSequentially('-500');
  await expect(field).toHaveValue('-500');

  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByTestId('plugin-priority-limit-count')).toHaveText(
    'priority -500, set here'
  );

  // Below everything the gateway ships, so it runs last.
  await expect
    .poll(() => listedOrder(page))
    .toEqual(['key-auth', 'proxy-rewrite', 'limit-count']);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect
    .poll(async () => {
      const saved = await getRouteReq(e2eReq, ROUTE_ID);
      const plugins = saved.value.plugins as Record<string, { _meta?: { priority?: number } }>;
      return plugins['limit-count']?._meta?.priority;
    })
    .toBe(-500);
});

test('is not offered where it would mean nothing', async ({ page }) => {
  // The same drawer edits plugin metadata, which is a plugin's settings on the
  // gateway: no `_meta`, no order to speak of, and a body validated against
  // the metadata schema. The field used to be there anyway, with a
  // description saying the gateway does not say what this plugin runs at -
  // true, and beside the point (#48).
  await page.goto(`${env.E2E_TARGET_URL.replace(/\/$/, '')}/plugin_metadata`);
  await page.getByRole('button', { name: 'Select Plugins' }).click();

  const drawer = page.locator('[role="dialog"]');
  await drawer.getByPlaceholder('Search').first().fill('http-logger');
  await expect(drawer.getByText('http-logger').first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Add' }).first().click();

  await expect(page.getByTestId('plugin-priority-input')).toBeHidden();
});

test('keeps a priority the Request Override step does not know about', async ({ page }) => {
  await openPluginsStep(page);

  await page
    .getByTestId('plugin-proxy-rewrite')
    .getByRole('button', { name: 'Edit' })
    .click();
  await page.getByTestId('plugin-priority-input').fill('4242');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByTestId('plugin-priority-proxy-rewrite')).toHaveText(
    'priority 4242, set here'
  );

  // Back a step, and change the one thing that step is for. It rebuilds the
  // plugin's config from its own fields, and everything else on it - the
  // priority included - has to survive that.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('group', { name: 'Request Override' })).toBeVisible();
  await page.getByPlaceholder('new-host.example.com').fill('second.example.com');

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('plugin-priority-proxy-rewrite')).toHaveText(
    'priority 4242, set here'
  );
});

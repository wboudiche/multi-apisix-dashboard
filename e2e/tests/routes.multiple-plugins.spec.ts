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

const ROUTE_ID = randomId('multi-plugin');
const DETAIL_URL = `${env.E2E_TARGET_URL.replace(/\/$/, '')}/routes/detail/${ROUTE_ID}`;

// key-auth takes an empty configuration object — that is how most auth plugins
// are switched on. An empty config used to be indistinguishable from leftover
// noise to the payload cleaner, so the plugin was dropped on every save.
const route: APISIXType['Route'] = {
  id: ROUTE_ID,
  name: ROUTE_ID,
  uri: `/${ROUTE_ID}`,
  methods: ['GET'],
  plugins: { 'key-auth': {} },
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
};

test.beforeEach(async () => {
  await putRouteReq(e2eReq, route);
});

test.afterEach(async () => {
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_ID}`);
});

// The route wizard's Plugins step is the 4th of five, so three Next clicks from
// step 1. Asserted below rather than assumed: if a step is ever inserted, the
// failure should name the wizard rather than surface as a stray locator error.
const STEPS_TO_PLUGINS = 3;

const openPluginsStep = async (page: Page) => {
  await page.goto(DETAIL_URL);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (let i = 0; i < STEPS_TO_PLUGINS; i++) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.getByRole('button', { name: 'Select Plugins' })).toBeVisible();
};

test('adds a second plugin without dropping the one already configured', async ({
  page,
}) => {
  await openPluginsStep(page);

  // The route arrives with key-auth already on it.
  await expect(page.getByText('key-auth')).toBeVisible();

  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const selectDrawer = page.locator('[role="dialog"]');
  await selectDrawer.locator('input[placeholder="Search"]').fill('basic-auth');
  // Wait for the search to narrow before clicking, otherwise the first Add
  // button belongs to whichever plugin happened to be at the top of the list.
  await expect(selectDrawer.getByText('basic-auth')).toBeVisible();
  await selectDrawer.getByRole('button', { name: 'Add' }).first().click();

  // Confirm in the plugin editor drawer that opens on top.
  await page.locator('[role="dialog"]').last().getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByText('Edit Route Successfully')).toBeVisible();

  // What the gateway actually stored is the only thing that settles it: the
  // form used to show both while sending only the configured one.
  const saved = await getRouteReq(e2eReq, ROUTE_ID);
  expect(Object.keys(saved.value.plugins ?? {}).sort()).toEqual([
    'basic-auth',
    'key-auth',
  ]);
});

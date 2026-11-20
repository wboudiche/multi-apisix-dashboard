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
import { deleteByPrefix } from '@e2e/utils/cleanup';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';
import { customAlphabet } from 'nanoid';

import { API_PLUGIN_CONFIGS } from '@/config/constant';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
const PREFIX = 'e2e-oidc';
// Answered by the test itself: the suite does not reach the internet.
const DISCOVERY = 'https://idp.e2e.test/.well-known/openid-configuration';

type PluginConfigList = {
  list: { value: { name?: string; plugins: Record<string, Record<string, unknown>> } }[];
};

test.afterAll(async () => {
  await deleteByPrefix(API_PLUGIN_CONFIGS, 'name', PREFIX);
});

const savedPlugin = async (name: string) => {
  const configs = await e2eReq
    .get<unknown, { data: PluginConfigList }>(API_PLUGIN_CONFIGS)
    .then((r) => r.data.list);
  return configs.find((c) => c.value.name === name)?.value.plugins['openid-connect'];
};

const openOidc = async (page: import('@playwright/test').Page, name: string) => {
  await page.route(DISCOVERY, (route) =>
    route.fulfill({
      json: {
        issuer: 'https://idp.e2e.test',
        authorization_endpoint: 'https://idp.e2e.test/auth',
        token_endpoint: 'https://idp.e2e.test/token',
        jwks_uri: 'https://idp.e2e.test/jwks',
      },
      headers: { 'access-control-allow-origin': '*' },
    })
  );
  await page.goto('plugin_configs/add');
  await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill(name);
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const picker = page.getByRole('dialog', { name: 'Select Plugins' });
  await picker.getByPlaceholder('Search').fill('openid-connect');
  await picker.getByTestId('plugin-openid-connect').getByRole('button', { name: 'Add' }).click();
  return page.getByRole('dialog', { name: 'Add Plugin' });
};

test('openid-connect asks how callers sign in, and tests the provider', async ({ page }) => {
  const name = `${PREFIX}-${nanoid()}`;
  const drawer = await openOidc(page, name);
  const section = drawer.getByTestId('oidc-section');

  await test.step('the three settings a route needs, bearer_only asked as a question', async () => {
    for (const field of ['discovery', 'client_id', 'client_secret']) {
      await expect(drawer.getByRole('textbox', { name: `* ${field}` })).toBeVisible();
    }
    await expect(drawer.getByText('scope', { exact: true })).toBeHidden();
    await drawer.getByRole('button', { name: 'More options' }).click();
    await expect(drawer.getByText('scope', { exact: true })).toBeVisible();
    await expect(drawer.getByText('bearer_only', { exact: true })).toBeHidden();
    await expect(section.getByRole('radio', { name: 'Login page' })).toBeChecked();
  });

  await test.step('the provider is read, and what the mode needs from it said', async () => {
    await drawer.getByRole('textbox', { name: '* discovery' }).fill(DISCOVERY);
    await section.getByRole('button', { name: 'Test the address' }).click();
    await expect(section.getByText('Provider found: https://idp.e2e.test')).toBeVisible();
    await section.getByRole('radio', { name: 'Token already provided' }).check();
    // No introspection offered, and the route does not check signatures.
    await expect(section.getByText(/It offers no way to check a token/)).toBeVisible();
  });

  await test.step('saved as bearer_only, with no session to set up', async () => {
    await drawer.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page).toHaveURL(/plugin_configs\/detail\//);
    const saved = await savedPlugin(name);
    expect(saved?.bearer_only).toBe(true);
    expect(saved?.discovery).toBe(DISCOVERY);
  });
});

test('openid-connect with a login page is saved with a session secret', async ({ page }) => {
  // A field's change reached the drawer from inside the form's state
  // updater, an update to another component while rendering it.
  const renderUpdates: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('Cannot update a component')) {
      renderUpdates.push(m.text());
    }
  });
  const name = `${PREFIX}-${nanoid()}`;
  const drawer = await openOidc(page, name);
  // A paste brings a space with it; the gateway would fetch it as it is.
  await drawer.getByRole('textbox', { name: '* discovery' }).fill(`${DISCOVERY} `);
  const section = drawer.getByTestId('oidc-section');
  const redirect = section.getByRole('textbox', { name: 'redirect_uri' });
  await expect(section.getByText(/Without it, the gateway sends people back/)).toBeVisible();
  await redirect.fill('/callback');
  await expect(section.getByText(/The provider needs a full address here/)).toBeVisible();
  await redirect.fill('https://gw.e2e.test/app/callback');
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer).toBeHidden();
  // The gateway refuses a login without one: the save getting through is
  // the proof it was generated.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/plugin_configs\/detail\//);
  const saved = await savedPlugin(name);
  expect(saved?.bearer_only).toBeUndefined();
  expect(saved?.discovery).toBe(DISCOVERY);
  expect(saved?.redirect_uri).toBe('https://gw.e2e.test/app/callback');
  expect((saved?.session as { secret?: string } | undefined)?.secret).toBeTruthy();
  expect(renderUpdates).toEqual([]);
});

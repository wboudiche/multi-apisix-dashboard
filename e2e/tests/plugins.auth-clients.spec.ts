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

import { API_CONSUMERS, API_CREDENTIALS, API_PLUGIN_CONFIGS } from '@/config/constant';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
// One per worker: the tests of this file run in several, and each worker's
// afterAll removes what carries the prefix, which would take another
// worker's clients from under a test still running.
const PREFIX = `e2e-authclient-${nanoid(4)}`;

type Credentials = { list: { value: { id: string; plugins: Record<string, Record<string, string>> } }[] };

const removeClient = async (username: string) => {
  const creds = await e2eReq
    .get<unknown, { data: Credentials }>(API_CREDENTIALS(username))
    .then((r) => r.data.list)
    .catch(() => []);
  await Promise.all(
    creds.map((c) => e2eReq.delete(`${API_CREDENTIALS(username)}/${c.value.id}`).catch(() => null))
  );
  await e2eReq.delete(`${API_CONSUMERS}/${username}`).catch(() => null);
};

test.afterAll(async () => {
  await deleteByPrefix(API_PLUGIN_CONFIGS, 'name', PREFIX);
  await deleteByPrefix(API_CONSUMERS, 'username', PREFIX);
});

test('an auth plugin lists who can call it and makes a client with a key', async ({ page }) => {
  const name = `${PREFIX}-${nanoid()}`;
  try {

  await page.goto('plugin_configs/add');
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const picker = page.getByRole('dialog', { name: 'Select Plugins' });
  await picker.getByPlaceholder('Search').fill('key-auth');
  await picker.getByTestId('plugin-key-auth').getByRole('button', { name: 'Add' }).click();

  const drawer = page.getByRole('dialog', { name: 'Add Plugin' });
  const clients = drawer.getByTestId('auth-clients');
  await expect(clients.getByRole('heading', { name: 'Who can call it' })).toBeVisible();

  await test.step('the less used settings fold away', async () => {
    await expect(drawer.getByText('header', { exact: true })).toBeVisible();
    await expect(drawer.getByText('realm', { exact: true })).toBeHidden();
    await drawer.getByRole('button', { name: 'More options' }).click();
    await expect(drawer.getByText('realm', { exact: true })).toBeVisible();
  });

  await test.step('a new client gets a generated key, written as a credential', async () => {
    await clients.getByRole('button', { name: 'New client' }).click();
    await clients.getByRole('textbox', { name: 'Client name' }).fill(name);
    const key = await clients.getByRole('textbox', { name: 'Key' }).inputValue();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    await clients.getByRole('button', { name: 'Create client' }).click();

    await expect(clients.getByText(`Client ${name} created.`)).toBeVisible();
    await expect(clients.getByText(name, { exact: true })).toBeVisible();
    await expect(clients.getByText(`curl -H 'apikey: ${key}'`)).toBeVisible();

    const creds = await e2eReq
      .get<unknown, { data: Credentials }>(API_CREDENTIALS(name))
      .then((r) => r.data.list);
    expect(creds.map((c) => c.value.plugins['key-auth']?.key)).toContain(key);
  });

  await test.step('a name that already holds a key is refused', async () => {
    await clients.getByRole('button', { name: 'New client' }).click();
    await clients.getByRole('textbox', { name: 'Client name' }).fill(name);
    await expect(clients.getByText('This client already holds a credential for this plugin.')).toBeVisible();
    await expect(clients.getByRole('button', { name: 'Create client' })).toBeDisabled();
  });

  } finally {
    await removeClient(name);
  }
});

type PluginConfigList = {
  list: { value: { id: string; name?: string; plugins: Record<string, Record<string, unknown>> } }[];
};

test('an auth plugin narrows who may call to the clients picked', async ({ page }) => {
  const id = nanoid();
  const allowed = `${PREFIX}-a-${id}`;
  const other = `${PREFIX}-b-${id}`;
  const configName = `${PREFIX}-cfg-${id}`;
  for (const username of [allowed, other]) {
    await e2eReq.put(API_CONSUMERS, {
      username,
      plugins: { 'key-auth': { key: `${username}-key` } },
    });
  }
  try {
    await page.goto('plugin_configs/add');
    await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill(configName);
    await page.getByRole('button', { name: 'Select Plugins' }).click();
    const picker = page.getByRole('dialog', { name: 'Select Plugins' });
    await picker.getByPlaceholder('Search').fill('key-auth');
    await picker.getByTestId('plugin-key-auth').getByRole('button', { name: 'Add' }).click();

    const drawer = page.getByRole('dialog', { name: 'Add Plugin' });
    const clients = drawer.getByTestId('auth-clients');

    await test.step('every client holding a key, until said otherwise', async () => {
      await expect(clients.getByRole('radio', { name: 'Every client holding a credential' })).toBeChecked();
      await expect(clients.getByText(allowed, { exact: true })).toBeVisible();
    });

    await test.step('narrowed to one, the plugin waits for a name', async () => {
      await clients.getByRole('radio', { name: 'Only the clients picked' }).check();
      await expect(clients.getByText('Pick at least one client.')).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      // Found by typing part of its name, as among hundreds of clients.
      await clients.getByRole('textbox', { name: 'Search the clients' }).fill(`a-${id}`);
      await expect(clients.getByRole('checkbox', { name: other, exact: true })).toBeHidden();
      await clients.getByRole('checkbox', { name: allowed, exact: true }).check();
      await expect(clients.getByTestId('client-count')).toContainText('1 of');
      await expect(clients.getByText('Pick at least one client.')).toBeHidden();
      await drawer.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await test.step('saved as the consumer-restriction beside the plugin', async () => {
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page).toHaveURL(/plugin_configs\/detail\//);
      const configs = await e2eReq
        .get<unknown, { data: PluginConfigList }>(API_PLUGIN_CONFIGS)
        .then((r) => r.data.list);
      const saved = configs.find((c) => c.value.name === configName);
      expect(saved?.value.plugins['consumer-restriction']).toEqual({ whitelist: [allowed] });
      expect(saved?.value.plugins['key-auth']).toBeDefined();
    });
  } finally {
    await removeClient(allowed);
    await removeClient(other);
  }
});

const SIGNING = [
  // A token signed in the browser, sent with the Bearer word.
  { plugin: 'jwt-auth', field: 'key', usage: () => /curl -H 'authorization: Bearer [\w-]+\.[\w-]+\.[\w-]+'/ },
  // A script that signs a request, with the client's keyId.
  { plugin: 'hmac-auth', field: 'key_id', usage: (name: string) => new RegExp(`KEY_ID='${name}-[0-9a-f]{6}'`) },
] as const;

for (const { plugin, field, usage } of SIGNING) {
  test(`${plugin} makes a client with a secret and shows how to sign with it`, async ({ page }) => {
    const name = `${PREFIX}-${plugin.slice(0, 4)}-${nanoid()}`;
    try {
      await page.goto('plugin_configs/add');
      await page.getByRole('button', { name: 'Select Plugins' }).click();
      const picker = page.getByRole('dialog', { name: 'Select Plugins' });
      await picker.getByPlaceholder('Search').fill(plugin);
      await picker.getByTestId(`plugin-${plugin}`).getByRole('button', { name: 'Add' }).click();

      const clients = page.getByRole('dialog', { name: 'Add Plugin' }).getByTestId('auth-clients');
      await clients.getByRole('button', { name: 'New client' }).click();
      await clients.getByRole('textbox', { name: 'Client name' }).fill(name);
      const secret = await clients.getByRole('textbox', { name: 'Secret' }).inputValue();
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
      await clients.getByRole('button', { name: 'Create client' }).click();
      await expect(clients.getByText(`Client ${name} created.`)).toBeVisible();

      await expect(clients.getByText(usage(name))).toBeVisible();

      // The credential names the client by its name and a random suffix, so
      // that a key or keyId made elsewhere from the same name cannot clash:
      // the token's key claim, the signature's keyId.
      const creds = await e2eReq
        .get<unknown, { data: Credentials }>(API_CREDENTIALS(name))
        .then((r) => r.data.list);
      expect(creds.map((c) => c.value.plugins[plugin]?.[field])).toContainEqual(
        expect.stringMatching(new RegExp(`^${name}-[0-9a-f]{6}$`))
      );
    } finally {
      await removeClient(name);
    }
  });
}

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

import { API_CONSUMERS, API_CREDENTIALS } from '@/config/constant';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
const PREFIX = 'e2e-authclient';

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

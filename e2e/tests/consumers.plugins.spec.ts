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
import { credentialsPom } from '@e2e/pom/credentials';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { API_CONSUMERS } from '@/config/constant';

/**
 * A consumer takes any plugin the gateway has - a quota per client is the
 * usual one - and a credential only those APISIX takes in one, the plugins
 * with a consumer_schema. The pickers used the dashboard's own category
 * table instead, and hid every plugin but authentication from a consumer
 * (#411).
 */

const openPicker = async (page: Page) => {
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const picker = page.getByRole('dialog', { name: 'Select Plugins' });
  await expect(picker).toBeVisible();
  return picker;
};

test('a consumer is offered every plugin, a quota among them', async ({ page }) => {
  await consumersPom.toAdd(page);
  await consumersPom.isAddPage(page);
  const picker = await openPicker(page);

  for (const plugin of ['limit-count', 'limit-req', 'proxy-rewrite', 'key-auth']) {
    await picker.getByPlaceholder('Search').fill(plugin);
    await expect(picker.getByTestId(`plugin-${plugin}`)).toBeVisible();
  }
});

test('an auth plugin on a consumer is edited by its consumer schema', async ({ page }) => {
  await consumersPom.toAdd(page);
  await consumersPom.isAddPage(page);
  const picker = await openPicker(page);
  await picker.getByPlaceholder('Search').fill('key-auth');
  await picker.getByTestId('plugin-key-auth').getByRole('button', { name: 'Add' }).click();

  // The key a client presents - the consumer's side - not the header a
  // route reads it from.
  const editor = page.getByRole('dialog', { name: 'Add Plugin' });
  const field = (name: string) => editor.locator('label').filter({ hasText: new RegExp(`^\\*?\\s*${name}$`) });
  await expect(field('key')).toBeVisible();
  await expect(field('header')).toHaveCount(0);
});

test('a credential is offered only the plugins the gateway takes in one', async ({ page }) => {
  const username = randomId('e2e_411');
  await e2eReq.put(API_CONSUMERS, { username });
  try {
    await credentialsPom.toCredentialAdd(page, username);
    await credentialsPom.isCredentialAddPage(page, username);
    const picker = await openPicker(page);

    await picker.getByPlaceholder('Search').fill('key-auth');
    await expect(picker.getByTestId('plugin-key-auth')).toBeVisible();
    // A quota is a consumer's, not a credential's: the gateway refuses it
    // there ("only supports auth type plugins in consumer credential").
    await picker.getByPlaceholder('Search').fill('limit-count');
    await expect(picker.getByTestId('plugin-limit-count')).toBeHidden();
  } finally {
    await e2eReq.delete(`${API_CONSUMERS}/${username}`).catch(() => undefined);
  }
});

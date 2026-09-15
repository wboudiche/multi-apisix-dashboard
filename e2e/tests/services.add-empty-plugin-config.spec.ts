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
import { deleteServicesByNamePrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { uiAddServiceNode, uiDiscardServiceDraftIfPresent } from '@e2e/utils/ui/services';
import { expect } from '@playwright/test';

/**
 * A plugin enabled with an empty config — `{"key-auth": {}}`, the plugin with
 * its defaults — reaches the Admin API when a service is added. The add page
 * ran a cleaner of its own that removed it before anything was sent (#223).
 */

const PREFIX = 'e2e_svc_empty_plugin';
const PROXY = '/api/v1/apisix/admin';

type ServiceList = { list: { value: { name?: string; plugins?: Record<string, unknown> } }[] };

test.afterAll(async () => {
  await deleteServicesByNamePrefix(PREFIX);
});

test('adding a service keeps a plugin enabled with an empty config', async ({ page }) => {
  const name = randomId(PREFIX);
  await page.goto('/ui/services/add');
  await uiDiscardServiceDraftIfPresent(page);

  await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill(name);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await uiAddServiceNode(page, '127.0.0.1', 80);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Plugins step: key-auth, with its config emptied in the JSON editor.
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const picker = page.getByRole('dialog').first();
  await picker.getByPlaceholder('Search').fill('key-auth');
  await picker.getByRole('button', { name: 'Add' }).first().click();
  const editor = page.getByRole('dialog', { name: 'Add Plugin', exact: true });
  await editor.locator('label:has-text("JSON")').click();
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor.getByTestId('editor-loading')).toBeHidden();
  await page.evaluate(() => window.__monacoEditor__.getModel()?.setValue('{}'));
  await editor.locator('button[data-block="true"]').click();
  await expect(page.getByTestId('plugin-key-auth')).toBeVisible();

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const sent = page.waitForRequest(
    (request) =>
      request.url().includes('/apisix/admin/services') &&
      ['POST', 'PUT'].includes(request.method())
  );
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  expect((await sent).postDataJSON().plugins).toEqual({ 'key-auth': {} });
  await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });

  // APISIX may fill in the plugin's defaults; what matters is that it is on.
  const token = await loginAdmin();
  const services = (await apiFetch(`${PROXY}/services`, token, {
    headers: { 'X-Instance-ID': getFixtures().localInstanceId },
  })) as ServiceList;
  const stored = services.list.find((item) => item.value.name === name);
  expect(stored?.value.plugins).toHaveProperty('key-auth');
});

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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The raw JSON drawer loads the route each time it opens, so an edit closed
 * without saving is gone when it is opened again (#212 moved that load from
 * an effect into render).
 */

const PROXY = '/api/v1/apisix/admin';

test('an edit closed without saving is gone when the JSON drawer reopens', async ({ page }) => {
  const token = await loginAdmin();
  const id = randomId('e2e_rawjson');
  const headers = { 'X-Instance-ID': getFixtures().localInstanceId };
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers,
    json: { name: id, uri: `/${id}`, upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } } },
  });

  try {
    await page.goto(`/ui/routes/detail/${id}`);
    const open = page.getByRole('button', { name: 'View JSON' });
    const drawer = page.getByRole('dialog').filter({ hasText: 'Edit JSON' });
    const editor = drawer.locator('.monaco-editor').first();

    await open.click();
    await expect(drawer).toContainText(id);
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' "zzcancelled"');
    await expect(drawer).toContainText('zzcancelled');
    await expect(drawer.getByText('Unsaved')).toBeVisible();

    await drawer.locator('.mantine-Drawer-close').click();
    await expect(drawer).toBeHidden();

    await open.click();
    await expect(drawer).toContainText(id);
    await expect(drawer).not.toContainText('zzcancelled');
    await expect(drawer.getByText('Unsaved')).toBeHidden();
  } finally {
    await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers });
  }
});

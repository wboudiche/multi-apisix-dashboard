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
import { upstreamsPom } from '@e2e/pom/upstreams';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiGoto } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

import { API_UPSTREAMS } from '@/config/constant';

/**
 * A record's ID is the key APISIX knows it by, not what anyone reads it by:
 * the lists hide their ID column until the column setting brings it back,
 * and a detail page shows it as one quiet line, to copy. A record with no
 * name but its ID - a global rule - has it asked for, and shown, as its name.
 */

const id = randomId('e2e-idcol');

test.beforeAll(async () => {
  await e2eReq.put(`${API_UPSTREAMS}/${id}`, {
    name: id,
    nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }],
  });
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_UPSTREAMS}/${id}`).catch(() => undefined);
});

test('a list hides its ID column until the column setting shows it', async ({ page }) => {
  await upstreamsPom.toIndex(page);
  await upstreamsPom.isIndexPage(page);
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'Name' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'ID' })).toBeHidden();

  await page.locator('.ant-pro-table-list-toolbar-setting-item').first().click();
  // A tree of the columns, each with its box beside its title.
  await page.locator('.ant-tree-treenode').filter({ hasText: /^ID$/ }).locator('.ant-tree-checkbox').click();
  await expect(table.getByRole('columnheader', { name: 'ID' })).toBeVisible();
});

test('a detail page shows the ID as a line to copy, not a field', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await uiGoto(page, '/upstreams/detail/$id', { id });
  const field = page.getByRole('textbox', { name: 'ID', exact: true });
  await expect(field).toHaveValue(id);
  // No field's border: a line of text.
  await expect
    .poll(() => field.evaluate((el) => getComputedStyle(el).borderTopStyle))
    .toBe('none');
  // Usable read-only, and what it copies is the ID.
  const copy = page.getByRole('button', { name: 'Copy' }).first();
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(id);
});

test('a new record\'s ID is generated, and folded away until asked for', async ({ page }) => {
  await uiGoto(page, '/plugin_configs/add');
  const field = page.getByRole('textbox', { name: 'ID', exact: true });
  await expect(field).toBeHidden();
  await page.getByRole('button', { name: 'Set the ID yourself' }).click();
  await expect(field).toBeVisible();
  await expect(field).not.toHaveValue('');
});

test('a global rule, whose ID is its only name, has it asked for as its name', async ({ page }) => {
  await uiGoto(page, '/global_rules/add');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  // Asked for, not generated, and not folded.
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('');
  await name.fill('has space');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Letters, digits and - _ . only, 64 at most.')).toBeVisible();
});

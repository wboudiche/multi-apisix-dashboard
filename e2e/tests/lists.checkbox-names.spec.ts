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
import { readFileSync } from 'node:fs';

import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';

/**
 * The ten antd lists had row checkboxes with no accessible name - a screen
 * reader read "checkbox, unchecked" once per row, and rows were ticked for a
 * batch delete blind - and a header checkbox antd names itself, 'Select all',
 * in English whatever the language (#372).
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-names');
const NAMED = `${PREFIX}-named`;
const NAMELESS = `${PREFIX}-nameless`;
// A consumer's name takes letters, digits and underscores.
const CONSUMER = `e2e_names_${Date.now().toString(36)}`;
const SECRET = `${PREFIX}-secret`;
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
const SEEDED: [path: string, body: Record<string, unknown>][] = [
  [`upstreams/${NAMED}`, { ...upstream, name: NAMED }],
  [`upstreams/${NAMELESS}`, upstream],
  [`consumers/${CONSUMER}`, { username: CONSUMER }],
  [
    `secrets/vault/${SECRET}`,
    { uri: 'http://vault.example.com:8200', prefix: '/secret/names', token: 'e2e-token' },
  ],
];

test.beforeAll(async () => {
  const admin = await loginAdmin();
  for (const [path, json] of SEEDED) {
    // A consumer is put on the collection, under the username in its body.
    const target = path.startsWith('consumers/') ? 'consumers' : path;
    await apiFetch(`${PROXY}/${target}`, admin, { method: 'PUT', headers: onLocal(), json });
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  for (const [path] of SEEDED) {
    await apiFetch(`${PROXY}/${path}`, admin, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
});

const german = JSON.parse(
  readFileSync(new URL('../../src/locales/de/common.json', import.meta.url), 'utf8')
) as { table: { selectAll: string; selectRow: string } };

const box = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const rowBox = (page: Page, name: string) => box(page, i18n.t('table.selectRow', { name }));
const headerBox = (page: Page) => box(page, i18n.t('table.selectAll'));
/** The checkboxes of the table a screen reader has nothing to call. */
const unnamed = (page: Page) =>
  page.locator('table input[type="checkbox"]:not([aria-label]), table input[aria-label=""]');

test('a row is selected by its name, or by its id when it has none', async ({ page }) => {
  await page.goto('/ui/upstreams?page=1&page_size=100');

  await expect(rowBox(page, NAMED)).toBeVisible({ timeout: 30000 });
  await expect(rowBox(page, NAMELESS)).toBeVisible();
  await expect(headerBox(page)).toBeVisible();
  await expect(unnamed(page)).toHaveCount(0);

  // And it is the row's own: ticked by name, it is that row that is selected.
  await rowBox(page, NAMED).check();
  await expect(
    page.getByRole('row').filter({ hasText: NAMED }).getByRole('checkbox')
  ).toBeChecked();
  await expect(rowBox(page, NAMELESS)).not.toBeChecked();
});

test('a consumer by its username, a secret by its manager and id', async ({ page }) => {
  await page.goto('/ui/consumers?page=1&page_size=100');
  await expect(rowBox(page, CONSUMER)).toBeVisible({ timeout: 30000 });
  await expect(unnamed(page)).toHaveCount(0);

  // Two managers can hold the same id: the id alone would name two rows alike.
  await page.goto('/ui/secrets?page=1&page_size=100');
  await expect(rowBox(page, `vault/${SECRET}`)).toBeVisible({ timeout: 30000 });
  await expect(unnamed(page)).toHaveCount(0);
});

test('in the language of the page, the header’s too', async ({ page }) => {
  await page.goto('/ui/upstreams?page=1&page_size=100');
  await expect(rowBox(page, NAMED)).toBeVisible({ timeout: 30000 });

  await page.locator('header .mantine-ActionIcon-root[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Deutsch' }).click();

  // antd's own name for it is 'Select all', whatever the language: in English
  // the two cannot be told apart.
  await expect(box(page, german.table.selectAll)).toBeVisible();
  await expect(box(page, german.table.selectRow.replace('{{name}}', NAMED))).toBeVisible();
  await expect(box(page, 'Select all')).toHaveCount(0);
});

// Every list that has the checkboxes, as it stands: no row is seeded on most,
// and the header's is there on an empty list too.
const LISTS = [
  'services',
  'upstreams',
  'consumers',
  'consumer_groups',
  'ssls',
  'secrets',
  'protos',
  'global_rules',
  'plugin_configs',
  'stream_routes',
];

for (const list of LISTS) {
  test(`no checkbox of the ${list} list is without a name`, async ({ page }) => {
    await page.goto(`/ui/${list}`);

    await expect(headerBox(page)).toBeVisible({ timeout: 30000 });
    await expect(unnamed(page)).toHaveCount(0);
  });
}

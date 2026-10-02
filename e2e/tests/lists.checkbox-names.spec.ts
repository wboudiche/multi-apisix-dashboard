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
import { genTLS, randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiSwitchLanguage } from '@e2e/utils/ui';
import { i18n, i18nIn } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';
import { customAlphabet } from 'nanoid';

import { PAGE_SIZE_MAX } from '@/config/constant';

/**
 * The ten antd lists had row checkboxes with no accessible name - a screen
 * reader read "checkbox, unchecked" once per row, and rows were ticked for a
 * batch delete blind - and a header checkbox antd names itself, 'Select all',
 * in English whatever the language (#372).
 */
const PROXY = '/api/v1/apisix/admin';
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

const de = i18nIn('de');

const box = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const rowBox = (page: Page, name: string) => box(page, i18n.t('table.selectRow', { name }));
const headerBox = (page: Page) => box(page, i18n.t('table.selectAll'));
/** A row that shares its name: the name, and its id beside it. */
const twinBox = (page: Page, name: string, id: string) =>
  rowBox(page, i18n.t('table.nameWithId', { name, id }));
/** The checkboxes of the table a screen reader has nothing to call. */
const unnamed = (page: Page) =>
  page.locator('table input[type="checkbox"]:not([aria-label]), table input[aria-label=""]');

/** The list with every row on one page: a shared gateway holds more than ten. */
const openList = (page: Page, list: string) =>
  page.goto(`/ui/${list}?page=1&page_size=${PAGE_SIZE_MAX}`);

test.describe('the rows', () => {
  const PREFIX = randomId('e2e-names');
  const NAMED = `${PREFIX}-named`;
  const NAMELESS = `${PREFIX}-nameless`;
  // Two under one name: nothing stops it, and each has to be told from the
  // other. For a certificate it is the ordinary case - RSA and ECDSA for one
  // SNI.
  const TWIN = `${PREFIX}-twin`;
  const TWINS = [`${TWIN}-a`, `${TWIN}-b`];
  const SNI = `${PREFIX}.example.com`;
  // A consumer's name takes letters and digits, and the workers of a parallel
  // run each need their own.
  const CONSUMER = `e2enames${customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)()}`;
  const SECRET = `${PREFIX}-secret`;

  const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
  const route = (id: string) => ({ uri: `/${id}`, name: TWIN, upstream });
  const seeded = async (): Promise<[path: string, body: Record<string, unknown>][]> => {
    const tls = await genTLS();
    return [
      [`upstreams/${NAMED}`, { ...upstream, name: NAMED }],
      [`upstreams/${NAMELESS}`, upstream],
      [`consumers/${CONSUMER}`, { username: CONSUMER }],
      [
        `secrets/vault/${SECRET}`,
        { uri: 'http://vault.example.com:8200', prefix: '/secret/names', token: 'e2e-token' },
      ],
      ...TWINS.flatMap((id): [string, Record<string, unknown>][] => [
        [`upstreams/${id}`, { ...upstream, name: TWIN }],
        [`routes/${id}`, route(id)],
        [`ssls/${id}`, { snis: [SNI], ...tls }],
      ]),
    ];
  };
  const PATHS: string[] = [];

  test.beforeAll(async () => {
    const admin = await loginAdmin();
    for (const [path, json] of await seeded()) {
      // A consumer is put on the collection, under the username in its body.
      const target = path.startsWith('consumers/') ? 'consumers' : path;
      await apiFetch(`${PROXY}/${target}`, admin, { method: 'PUT', headers: onLocal(), json });
      PATHS.push(path);
    }
  });

  test.afterAll(async () => {
    const admin = await loginAdmin();
    for (const path of PATHS) {
      await apiFetch(`${PROXY}/${path}`, admin, { method: 'DELETE', headers: onLocal() }).catch(
        () => undefined
      );
    }
  });

  test('a row is selected by its name, or by its id when it has none', async ({ page }) => {
    await openList(page, 'upstreams');

    await expect(rowBox(page, NAMED)).toBeVisible({ timeout: 30000 });
    await expect(rowBox(page, NAMELESS)).toBeVisible();
    await expect(unnamed(page)).toHaveCount(0);

    // And it is the row's own: ticked by name, it is that row that is selected.
    await rowBox(page, NAMED).check();
    await expect(
      page.getByRole('row').filter({ hasText: NAMED }).getByRole('checkbox')
    ).toBeChecked();
    await expect(rowBox(page, NAMELESS)).not.toBeChecked();
  });

  test('two rows under one name are told apart by their ids', async ({ page }) => {
    await openList(page, 'upstreams');
    for (const id of TWINS) {
      await expect(twinBox(page, TWIN, id)).toBeVisible({ timeout: 30000 });
    }
    await expect(rowBox(page, TWIN)).toHaveCount(0);

    // Two certificates for one SNI, which the list calls by the SNI.
    await openList(page, 'ssls');
    for (const id of TWINS) {
      await expect(twinBox(page, SNI, id)).toBeVisible({ timeout: 30000 });
    }

    // And on the routes list, which is not antd's table.
    await page.goto(`/ui/routes?name=${TWIN}`);
    for (const id of TWINS) {
      await expect(twinBox(page, TWIN, id)).toBeVisible({ timeout: 30000 });
    }
  });

  test('a consumer by its username, a secret by its manager and id', async ({ page }) => {
    await openList(page, 'consumers');
    await expect(rowBox(page, CONSUMER)).toBeVisible({ timeout: 30000 });
    await expect(unnamed(page)).toHaveCount(0);

    // Two managers can hold the same id: the id alone would name two rows alike.
    await openList(page, 'secrets');
    await expect(rowBox(page, `vault/${SECRET}`)).toBeVisible({ timeout: 30000 });
    await expect(unnamed(page)).toHaveCount(0);
  });

  test('a row is named in the language of the page', async ({ page }) => {
    await openList(page, 'upstreams');
    await expect(rowBox(page, NAMED)).toBeVisible({ timeout: 30000 });

    await uiSwitchLanguage(page, 'Deutsch');

    await expect(box(page, de.t('table.selectRow', { name: NAMED }))).toBeVisible();
    await expect(rowBox(page, NAMED)).toHaveCount(0);
  });
});

// Every list that has the checkboxes, as it stands: nothing is seeded, and
// the header's checkbox is there on an empty list too. In German, because in
// English it proves nothing: antd's own name for it is 'Select all', the same
// words as ours.
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
  test(`the header checkbox of the ${list} list is named by the page, not by antd`, async ({
    page,
  }) => {
    await page.goto(`/ui/${list}`);
    await expect(headerBox(page)).toBeVisible({ timeout: 30000 });

    await uiSwitchLanguage(page, 'Deutsch');

    await expect(box(page, de.t('table.selectAll'))).toBeVisible();
    await expect(headerBox(page)).toHaveCount(0);
    await expect(unnamed(page)).toHaveCount(0);
  });
}

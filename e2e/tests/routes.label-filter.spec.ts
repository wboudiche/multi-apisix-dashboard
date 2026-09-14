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
import { permission } from '@e2e/pom/permission';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The label filter swallowed a failed catalogue request and substituted an
 * empty list, so a 401, a 500 or an unreachable backend all looked exactly like
 * "no labels have been defined" — with nothing logged and nothing shown.
 */

const keySelect = (page: import('@playwright/test').Page) =>
  page.getByPlaceholder('Select key').or(page.getByPlaceholder('Loading labels…'));

test('says so when the label catalogue cannot be loaded', async ({ page }) => {
  await page.route('**/api/v1/labels', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/ui/routes');
  // The label filter lives in the advanced panel, which starts collapsed.
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(
    page.getByText('Could not load the label catalogue, so filtering by label is unavailable.')
  ).toBeVisible({ timeout: 20000 });

  // And it does not pretend the catalogue is merely empty by offering a
  // dropdown with nothing in it.
  await expect(keySelect(page)).toBeDisabled();
});

test('distinguishes an empty catalogue from a broken one', async ({ page }) => {
  await page.route('**/api/v1/labels', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  // And no route carrying a label either: those are offered beside the
  // catalogue (#190), and one left behind by another spec would fill the
  // dropdown this test needs empty. Only the full-list read the filter makes;
  // the table's own page is left alone.
  await page.route(
    (url) =>
      url.pathname.endsWith('/apisix/admin/routes') &&
      url.searchParams.get('page_size') === '500',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ list: [], total: 0 }),
      })
  );

  await page.goto('/ui/routes');
  await page.getByRole('button', { name: 'Expand' }).click();
  const select = keySelect(page);
  await expect(select).toBeEnabled({ timeout: 20000 });

  // No error, and the dropdown explains its own emptiness rather than just
  // being blank.
  await expect(
    page.getByText('Could not load the label catalogue, so filtering by label is unavailable.')
  ).toHaveCount(0);
  await select.click();
  await expect(page.getByText('No label keys are defined yet')).toBeVisible();
});

const onInstance = (id: string) => ({ 'X-Instance-ID': id });

/** A catalogue key: lowercase letters, digits and underscores, at most 32. */
const labelKey = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

/** Adds a catalogue entry on one instance; returns what the key select shows. */
const defineLabel = async (token: string, instanceId: string, key: string) => {
  const displayName = `E2E ${key}`;
  await apiFetch('/api/v1/labels', token, {
    method: 'POST',
    headers: onInstance(instanceId),
    json: { key, display_name: displayName, color: 'blue', values: ['one'] },
  });
  return displayName;
};

const forgetLabel = (token: string, instanceId: string, key: string) =>
  apiFetch(`/api/v1/labels/${key}`, token, {
    method: 'DELETE',
    headers: onInstance(instanceId),
  }).catch(() => undefined);

test('offers the catalogue of the instance selected, after a switch', async ({ page }) => {
  // The catalogue is per instance. This passed before #190 changed how the
  // filter builds its options, and pins that a switch in the header still
  // brings the new instance's catalogue rather than keeping the previous one.
  const fx = getFixtures();
  const token = await loginAdmin();
  const localKey = labelKey('e2e_local');
  const stagingKey = labelKey('e2e_staging');
  try {
    const localName = await defineLabel(token, fx.localInstanceId, localKey);
    const stagingName = await defineLabel(token, fx.stagingInstanceId, stagingKey);

    await permission.switchInstance(page, 'Local APISIX');
    await page.goto('/ui/routes');
    await page.getByRole('button', { name: 'Expand' }).click();
    const keys = page.getByPlaceholder('Select key');
    await keys.click();
    await expect(page.getByRole('option', { name: localName })).toBeVisible({ timeout: 20000 });
    await page.keyboard.press('Escape');

    // In the header, as a person would: no reload.
    const switcher = page.locator('header input[placeholder="Select instance"]');
    await switcher.click();
    await page.getByRole('option', { name: 'Staging APISIX' }).click();
    await expect(switcher).toHaveValue('Staging APISIX');

    await keys.click();
    await expect(page.getByRole('option', { name: stagingName })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('option', { name: localName })).toHaveCount(0);
  } finally {
    await forgetLabel(token, fx.localInstanceId, localKey);
    await forgetLabel(token, fx.stagingInstanceId, stagingKey);
  }
});

test('offers, and filters by, a label the routes carry that the catalogue does not', async ({
  page,
}) => {
  // A catalogue entry removed while routes still carry it, or labels written
  // before the catalogue knew them, stay on the routes and in the table — and
  // could not be picked, because the filter offered the catalogue alone
  // (#190).
  const fx = getFixtures();
  const token = await loginAdmin();
  const key = labelKey('e2e_inuse');
  const tagged = randomId('e2e-label-tagged');
  const untagged = randomId('e2e-label-untagged');
  const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
  const onLocal = onInstance(fx.localInstanceId);
  await defineLabel(token, fx.localInstanceId, key);

  try {
    await apiFetch(`/api/v1/apisix/admin/routes/${tagged}`, token, {
      method: 'PUT',
      headers: onLocal,
      json: { name: tagged, uri: `/${tagged}`, labels: { [key]: 'one' }, upstream },
    });
    await apiFetch(`/api/v1/apisix/admin/routes/${untagged}`, token, {
      method: 'PUT',
      headers: onLocal,
      json: { name: untagged, uri: `/${untagged}`, upstream },
    });
    // Gone from the catalogue, still on the route.
    await forgetLabel(token, fx.localInstanceId, key);

    await permission.switchInstance(page, 'Local APISIX');
    await page.goto('/ui/routes');
    await page.getByRole('button', { name: 'Expand' }).click();
    await page.getByPlaceholder('Select key').click();
    await page.getByRole('option', { name: key, exact: true }).click({ timeout: 20000 });
    await page.getByPlaceholder('Select value').click();
    await page.getByRole('option', { name: 'one', exact: true }).click();
    await page.getByRole('button', { name: 'Add to filter' }).click();
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('row').filter({ hasText: tagged })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('row').filter({ hasText: untagged })).toHaveCount(0);
  } finally {
    for (const id of [tagged, untagged]) {
      await apiFetch(`/api/v1/apisix/admin/routes/${id}`, token, {
        method: 'DELETE',
        headers: onLocal,
      }).catch(() => undefined);
    }
    await forgetLabel(token, fx.localInstanceId, key);
  }
});

test('offers a label written while the page is open, when the filter opens again', async ({
  page,
}) => {
  // The labels in use were read once per minute and never refreshed by a
  // route write: straight after an import that labels routes, the table showed
  // the new labels and the filter did not offer them (#190).
  const fx = getFixtures();
  const token = await loginAdmin();
  const key = labelKey('e2e_fresh');
  const route = randomId('e2e-label-fresh');
  const onLocal = onInstance(fx.localInstanceId);

  try {
    await permission.switchInstance(page, 'Local APISIX');
    await page.goto('/ui/routes');
    await page.getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByPlaceholder('Select key')).toBeEnabled({ timeout: 20000 });
    await page.getByRole('button', { name: 'Collapse' }).click();

    // Written while the page stays open, as an import would.
    await defineLabel(token, fx.localInstanceId, key);
    await apiFetch(`/api/v1/apisix/admin/routes/${route}`, token, {
      method: 'PUT',
      headers: onLocal,
      json: {
        name: route,
        uri: `/${route}`,
        labels: { [key]: 'one' },
        upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
      },
    });
    await forgetLabel(token, fx.localInstanceId, key);

    await page.getByRole('button', { name: 'Expand' }).click();
    await page.getByPlaceholder('Select key').click();
    await expect(page.getByRole('option', { name: key, exact: true })).toBeVisible({
      timeout: 20000,
    });
  } finally {
    await apiFetch(`/api/v1/apisix/admin/routes/${route}`, token, {
      method: 'DELETE',
      headers: onLocal,
    }).catch(() => undefined);
    await forgetLabel(token, fx.localInstanceId, key);
  }
});

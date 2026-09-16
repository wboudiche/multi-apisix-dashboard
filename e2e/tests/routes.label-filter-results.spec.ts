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
import { expect, type Page } from '@playwright/test';

/**
 * What the label filter returns, from the filter bar down to the rows.
 *
 * #221 reported a label filter that also returned routes carrying no label at
 * all. It was raised against the bundle baked into the APISIX image, which
 * predates the move of list filtering into the backend proxy (#80) and the
 * filter's rework in #159 (#217 only changed which labels it offers). These
 * tests hold the behaviour the current code has: a label filter narrows, and a
 * route without labels never matches.
 */

const PROXY = '/api/v1/apisix/admin';
const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

const suffix = Math.random().toString(36).slice(2, 8);
const envKey = `e2e_env_${suffix}`;
const tierKey = `e2e_tier_${suffix}`;
const envLabel = `E2E env ${suffix}`;
const tierLabel = `E2E tier ${suffix}`;

const prod = randomId('e2e_lf_prod');
const staging = randomId('e2e_lf_staging');
// No seeded name is a prefix of another: the rows are matched on their text.
const prodGold = randomId('e2e_lf_gold');
const unlabelled = randomId('e2e_lf_plain');

const defineLabel = (token: string, key: string, display: string, values: string[]) =>
  apiFetch('/api/v1/labels', token, {
    method: 'POST',
    headers: onLocal(),
    json: { key, display_name: display, color: 'blue', values },
  });

const seedRoute = (token: string, name: string, labels?: Record<string, string>) =>
  apiFetch(`${PROXY}/routes/${name}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { uri: `/${name}`, name, upstream, ...(labels ? { labels } : {}) },
  });

/** Pick a key and a value in the label filter, and add it to the filter. */
const addLabel = async (page: Page, display: string, value: string) => {
  await page.getByPlaceholder('Select key').click();
  await page.getByRole('option', { name: display }).click();
  await page.getByPlaceholder('Select value').click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await page.getByRole('button', { name: 'Add to filter' }).click();
};

const rowFor = (page: Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

test.beforeAll(async () => {
  const token = await loginAdmin();
  await defineLabel(token, envKey, envLabel, ['prod', 'staging']);
  await defineLabel(token, tierKey, tierLabel, ['gold']);
  await seedRoute(token, prod, { [envKey]: 'prod' });
  await seedRoute(token, staging, { [envKey]: 'staging' });
  await seedRoute(token, prodGold, { [envKey]: 'prod', [tierKey]: 'gold' });
  await seedRoute(token, unlabelled);
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const name of [prod, staging, prodGold, unlabelled]) {
    await apiFetch(`${PROXY}/routes/${name}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
  for (const key of [envKey, tierKey]) {
    await apiFetch(`/api/v1/labels/${key}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
});

test('a label filter leaves out the routes that do not carry it', async ({ page }) => {
  await page.goto('/ui/routes');
  await page.getByRole('button', { name: 'Expand' }).click();
  await addLabel(page, envLabel, 'prod');
  await page.getByRole('button', { name: 'Search' }).click();

  // The key belongs to this run alone, so the filtered list is exactly the two
  // routes carrying it, whatever else the gateway holds. The list is fetched
  // again on Search, along with the filter's own read of every route.
  await expect(page.getByRole('row')).toHaveCount(3, { timeout: 20000 });
  await expect(rowFor(page, prod)).toHaveCount(1);
  await expect(rowFor(page, prodGold)).toHaveCount(1);
  // The same key with another value, and a route with no labels at all.
  await expect(rowFor(page, staging)).toHaveCount(0);
  await expect(rowFor(page, unlabelled)).toHaveCount(0);
});

test('two labels narrow the list rather than widen it', async ({ page }) => {
  await page.goto('/ui/routes');
  await page.getByRole('button', { name: 'Expand' }).click();
  await addLabel(page, envLabel, 'prod');
  await addLabel(page, tierLabel, 'gold');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('row')).toHaveCount(2, { timeout: 20000 });
  await expect(rowFor(page, prodGold)).toHaveCount(1);
  // Carries the first label only, so it no longer matches.
  await expect(rowFor(page, prod)).toHaveCount(0);
  await expect(rowFor(page, staging)).toHaveCount(0);
  await expect(rowFor(page, unlabelled)).toHaveCount(0);
});

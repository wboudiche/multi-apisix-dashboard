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
 * The route list is filtered in the dashboard's proxy rather than by APISIX
 * (see api/internal/handlers/list_filter.go). #142 added an upstream filter and
 * made labels and teams repeatable; these pin what those mean.
 *
 * The label cases matter beyond the new syntax: filtering by label used to
 * happen in the browser, over the page it had already been given, and it
 * overwrote the total with the number of matches on that page. Anything past
 * the first page was invisible to it.
 */

const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('f142');

const onInstance = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

const created: string[] = [];
const put = async (path: string, body: unknown) => {
  const token = await loginAdmin();
  await apiFetch(`${PROXY}${path}`, token, {
    method: 'PUT',
    headers: onInstance(),
    json: body,
  });
  created.push(`${PROXY}${path}`);
};

type Row = { value: { name?: string } };
const listNames = async (query: string): Promise<string[]> => {
  const token = await loginAdmin();
  const res = (await apiFetch(`${PROXY}/routes?${query}`, token, {
    headers: onInstance(),
  })) as { list?: Row[] };
  return (res.list ?? [])
    .map((r) => r.value.name ?? '')
    .filter((n) => n.startsWith(PREFIX))
    .sort();
};

const total = async (query: string): Promise<number> => {
  const token = await loginAdmin();
  const res = (await apiFetch(`${PROXY}/routes?${query}`, token, {
    headers: onInstance(),
  })) as { total?: number };
  return res.total ?? 0;
};

test.beforeAll(async () => {
  await put(`/upstreams/${PREFIX}-up`, {
    name: `${PREFIX}-upstream`,
    type: 'roundrobin',
    nodes: { '127.0.0.1:1980': 1 },
  });
  await put(`/upstreams/${PREFIX}-other`, {
    name: `${PREFIX}-other-upstream`,
    type: 'roundrobin',
    nodes: { '127.0.0.1:1981': 1 },
  });
  await put(`/services/${PREFIX}-svc`, {
    name: `${PREFIX}-service`,
    upstream_id: `${PREFIX}-up`,
  });

  await put(`/routes/${PREFIX}-direct`, {
    name: `${PREFIX}-direct`,
    uri: `/${PREFIX}/direct`,
    upstream_id: `${PREFIX}-up`,
    labels: { env: `${PREFIX}-prod`, tier: 'edge' },
  });
  await put(`/routes/${PREFIX}-viasvc`, {
    name: `${PREFIX}-viasvc`,
    uri: `/${PREFIX}/viasvc`,
    service_id: `${PREFIX}-svc`,
    labels: { env: `${PREFIX}-prod`, tier: 'core' },
  });
  await put(`/routes/${PREFIX}-embedded`, {
    name: `${PREFIX}-embedded`,
    uri: `/${PREFIX}/embedded`,
    upstream: { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } },
    labels: { env: `${PREFIX}-staging` },
  });
  await put(`/routes/${PREFIX}-elsewhere`, {
    name: `${PREFIX}-elsewhere`,
    uri: `/${PREFIX}/elsewhere`,
    upstream_id: `${PREFIX}-other`,
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  // Routes first: APISIX refuses to drop an upstream a route still points at.
  for (const path of created.reverse()) {
    await apiFetch(path, token, { method: 'DELETE', headers: onInstance() }).catch(
      () => undefined
    );
  }
});

test('the upstream filter reaches routes bound through a service', async () => {
  // The whole point of the filter: during an incident the question is which
  // routes touch the failing gateway. A route bound to a service that names it
  // is as affected as one that names it directly.
  expect(await listNames(`upstream_id=${PREFIX}-up`)).toEqual([
    `${PREFIX}-direct`,
    `${PREFIX}-viasvc`,
  ]);
});

test('an inline upstream has no id, so it matches no upstream filter', async () => {
  const names = await listNames(`upstream_id=${PREFIX}-up`);
  expect(names).not.toContain(`${PREFIX}-embedded`);
});

test('several upstreams widen rather than narrow', async () => {
  expect(
    await listNames(`upstream_id=${PREFIX}-up&upstream_id=${PREFIX}-other`)
  ).toEqual([`${PREFIX}-direct`, `${PREFIX}-elsewhere`, `${PREFIX}-viasvc`]);
});

test('several labels all have to match', async () => {
  expect(await listNames(`label=env:${PREFIX}-prod`)).toEqual([
    `${PREFIX}-direct`,
    `${PREFIX}-viasvc`,
  ]);

  // Narrowing, not widening: tier:edge belongs to one of the two above.
  expect(await listNames(`label=env:${PREFIX}-prod&label=tier:edge`)).toEqual([
    `${PREFIX}-direct`,
  ]);
});

test('a label value is compared, not just its key', async () => {
  // The value used to be discarded, so env:staging matched every route
  // carrying an env label whatever it held.
  expect(await listNames(`label=env:${PREFIX}-staging`)).toEqual([`${PREFIX}-embedded`]);
});

test('the label filter searches every page, and the total agrees', async () => {
  // This is the regression the move to the proxy fixes. The browser used to
  // filter the page it had been handed and overwrite the total with the matches
  // on it, so a label on page two simply did not exist — and the pager lied.
  const one = await total(`label=env:${PREFIX}-prod&page=1&page_size=1`);
  const two = await total(`label=env:${PREFIX}-prod&page=2&page_size=1`);

  // Two routes carry it, and the value is unique to this run so the count is
  // exactly those two whatever else the gateway holds. Both pages report the
  // size of the whole match, not of the slice they returned.
  expect(one).toBe(2);
  expect(two).toBe(2);

  const firstPage = await listNames(`label=env:${PREFIX}-prod&page=1&page_size=1`);
  const secondPage = await listNames(`label=env:${PREFIX}-prod&page=2&page_size=1`);
  expect(firstPage).toHaveLength(1);
  expect(secondPage).toHaveLength(1);
  expect(firstPage).not.toEqual(secondPage);
});

// The table and the bar, rather than the query string. The column has to say
// something for all three ways a route reaches a backend, and the filter has to
// be reachable by clicking rather than only by hand-writing a URL.

const rowFor = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

test('the Upstream column names the upstream a route reaches', async ({ page }) => {
  // Narrowed by name so the seeded rows are on the first page whatever else the
  // gateway happens to hold.
  await page.goto(`/ui/routes?name=${PREFIX}&page_size=50`);

  await expect(rowFor(page, `${PREFIX}-direct`)).toContainText(`${PREFIX}-upstream`);

  // Resolved through the service, which is the whole point of the column: a
  // route bound to a service is not a route without a backend.
  await expect(rowFor(page, `${PREFIX}-viasvc`)).toContainText(`${PREFIX}-upstream`);

  // An inline upstream has no name to show, and an empty cell would read as
  // "no backend" — which is the one thing it does not mean. The route is named
  // "-embedded" rather than "-inline" on purpose: with the word in the name the
  // assertion would match the Name column and pass whatever this one rendered.
  await expect(rowFor(page, `${PREFIX}-embedded`)).toContainText('inline');
});

test('picking an upstream in the bar narrows the table', async ({ page }) => {
  await page.goto(`/ui/routes?name=${PREFIX}&page_size=50`);
  await expect(rowFor(page, `${PREFIX}-elsewhere`)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByPlaceholder('Any upstream').click();
  await page.getByRole('option', { name: `${PREFIX}-upstream`, exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(rowFor(page, `${PREFIX}-direct`)).toBeVisible({ timeout: 20000 });
  await expect(rowFor(page, `${PREFIX}-viasvc`)).toBeVisible();
  // Bound to a different upstream, so it drops out.
  await expect(rowFor(page, `${PREFIX}-elsewhere`)).toHaveCount(0);
});

// Two shapes the page has to survive, and did not: the multi-valued params the
// bar itself produces, and the single-valued ones an older bookmark still holds.
// Both landed on the router's error screen — the first because pageSearchSchema
// declared `label` as a string, the second because a bare string reached a
// MultiSelect that maps over its value.

test('accepts the multi-valued filters the bar itself produces', async ({ page }) => {
  // Exactly the URL Search writes when two labels are picked. It used to reach
  // pageSearchSchema, which declared `label` as a string, and the router turned
  // the failure into its error screen before the table ever rendered.
  await page.goto(
    `/ui/routes?name=${PREFIX}&label=env%3A${PREFIX}-prod&label=tier%3Aedge&page_size=50`
  );

  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
  await expect(rowFor(page, `${PREFIX}-direct`)).toBeVisible({ timeout: 20000 });
  await expect(rowFor(page, `${PREFIX}-viasvc`)).toHaveCount(0);

  // And the bar opens on them rather than crashing on an array it cannot map.
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
});

test('opens a bookmark that still carries single-valued filters', async ({ page }) => {
  // The shape the previous release wrote into the URL. It has to keep working,
  // and the bar has to show it rather than crash on it.
  await page.goto(`/ui/routes?name=${PREFIX}&team_id=nobody&label=env&page_size=50`);
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
});

test('keeps the Status field showing what was searched', async ({ page }) => {
  // The URL turns "1" back into the number 1, which no option value matches.
  await page.goto(`/ui/routes?name=${PREFIX}&status=1&page_size=50`);
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByPlaceholder('UnPublished/Published')).toHaveValue('Published');
});

test('a narrowing search returns to the first page', async ({ page }) => {
  // Searching from page 2 used to keep page=2 in the draft, so a filter matching
  // fewer rows than one page landed past the end and showed nothing.
  await page.goto(`/ui/routes?name=${PREFIX}&page_size=1&page=2`);
  await page.getByRole('button', { name: 'Expand' }).click();
  await page.getByPlaceholder('Any upstream').click();
  await page.getByRole('option', { name: `${PREFIX}-other-upstream`, exact: true }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(rowFor(page, `${PREFIX}-elsewhere`)).toBeVisible({ timeout: 20000 });
});

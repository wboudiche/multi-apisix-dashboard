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
import { headerSelect } from '@e2e/pom/permission';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';

/**
 * A list page kept every id ticked for as long as it was mounted, and handed
 * all of them to Batch Delete. On the routes list, two routes ticked on page
 * one were still selected on page two, where nothing showed them: the bar came
 * back at the first row ticked there reading "3 selected", and the delete took
 * the two routes that were not on screen (#371). The ten antd lists held their
 * selection the same way.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-batch');
// More than a page of ten, so that there is a second page to go to.
const ROUTES = Array.from({ length: 12 }, (_, i) => `${PREFIX}-${String(i + 1).padStart(2, '0')}`);
const UPSTREAM = `${PREFIX}-upstream`;
// On both gateways under the same id, and under a name of its own: outside
// the twelve above, which the other tests count and delete from.
const SHARED_ROUTE = randomId('e2e-shared');
const fx = () => getFixtures();
const on = (instanceId: string) => ({ 'X-Instance-ID': instanceId });
const onLocal = () => on(fx().localInstanceId);
const onStaging = () => on(fx().stagingInstanceId);

const routeBody = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});
const upstreamBody = { name: UPSTREAM, type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };

// The tests delete from the same fixtures.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = await loginAdmin();
  for (const id of ROUTES) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, {
      method: 'PUT',
      headers: onLocal(),
      json: routeBody(id),
    });
  }
  // The same ids on the other gateway: two instances number alike, and a row
  // ticked on one must not arrive ticked on the other.
  for (const headers of [onLocal(), onStaging()]) {
    await apiFetch(`${PROXY}/upstreams/${UPSTREAM}`, admin, {
      method: 'PUT',
      headers,
      json: upstreamBody,
    });
  }
  for (const headers of [onLocal(), onStaging()]) {
    await apiFetch(`${PROXY}/routes/${SHARED_ROUTE}`, admin, {
      method: 'PUT',
      headers,
      json: routeBody(SHARED_ROUTE),
    });
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  const quietly = (path: string, headers: Record<string, string>) =>
    apiFetch(`${PROXY}/${path}`, admin, { method: 'DELETE', headers }).catch(() => undefined);
  for (const id of ROUTES) {
    await quietly(`routes/${id}`, onLocal());
  }
  await quietly(`routes/${SHARED_ROUTE}`, onLocal());
  await quietly(`routes/${SHARED_ROUTE}`, onStaging());
  await quietly(`upstreams/${UPSTREAM}`, onLocal());
  await quietly(`upstreams/${UPSTREAM}`, onStaging());
});

/** Which of the route fixtures the local gateway still holds. */
const remaining = async () => {
  const admin = await loginAdmin();
  const kept: string[] = [];
  for (const id of ROUTES) {
    try {
      await apiFetch(`${PROXY}/routes/${id}`, admin, { headers: onLocal() });
      kept.push(id);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 404) throw err;
    }
  }
  return kept;
};

const selectLabel = (name: string) => i18n.t('routes.list.selectRow', { name });
const rowBox = (page: Page, name: string) =>
  page.getByRole('checkbox', { name: selectLabel(name), exact: true });
const rowBoxes = (page: Page) =>
  page.getByRole('checkbox', { name: new RegExp(`^${selectLabel(PREFIX)}`) });

/** Tick the nth route on screen, and say which it is. */
const tick = async (page: Page, nth: number) => {
  const box = rowBoxes(page).nth(nth);
  const label = (await box.getAttribute('aria-label')) ?? '';
  await box.check();
  return label.slice(selectLabel('').length);
};

const selectedCount = (page: Page, count: number) =>
  page.getByText(i18n.t('form.json.selectedCount', { count }), { exact: true });

const deleteButton = (page: Page, count: number) =>
  page.getByRole('button', { name: `${i18n.t('form.btn.delete')} (${count})`, exact: true });

const confirmDelete = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('button', { name: i18n.t('form.btn.delete'), exact: true })
    .click();

const openRoutes = async (page: Page, rows: number) => {
  await page.goto(`/ui/routes?name=${PREFIX}`);
  await expect(rowBoxes(page)).toHaveCount(rows, { timeout: 30000 });
};

/** By the header's own selector: the page stays mounted, which is the point. */
const switchInstance = async (page: Page, name: string) => {
  await headerSelect(page).click();
  await page.getByRole('option', { name }).click();
};

test('a batch delete takes the routes ticked on screen, not the ones ticked a page ago', async ({
  page,
}) => {
  await openRoutes(page, 10);
  const first = await tick(page, 0);
  const second = await tick(page, 1);
  await expect(selectedCount(page, 2)).toBeVisible();

  // Page two, by the list's own pagination: the page stays mounted, which is
  // what kept the ticks of page one.
  await page.getByRole('button', { name: '2', exact: true }).click();
  await expect(rowBoxes(page)).toHaveCount(2, { timeout: 30000 });

  // Nothing here is ticked, and nothing is selected.
  await expect(selectedCount(page, 2)).toBeHidden();
  await expect(deleteButton(page, 2)).toHaveCount(0);

  // One row ticked is one row selected - not three.
  const third = await tick(page, 0);
  await expect(selectedCount(page, 1)).toBeVisible();
  await deleteButton(page, 1).click();
  await confirmDelete(page);
  await uiHasToastMsg(page, {
    hasText: i18n.t('info.delete.success', { name: `1 ${i18n.t('routes.singular')}` }),
  });

  const kept = await remaining();
  expect(kept).not.toContain(third);
  // The two that were ticked on the page before, and never on screen since.
  expect(kept).toContain(first);
  expect(kept).toContain(second);
  expect(kept).toHaveLength(ROUTES.length - 1);

  // And back on page one they are not ticked: they were another visit's.
  await page.getByRole('button', { name: '1', exact: true }).click();
  await expect(rowBox(page, first)).toBeVisible({ timeout: 30000 });
  await expect(rowBox(page, first)).not.toBeChecked();
  await expect(selectedCount(page, 2)).toBeHidden();
});

test('a row somebody else deleted in the meantime counts as deleted', async ({ page }) => {
  await openRoutes(page, 10);
  const gone = await tick(page, 0);
  const there = await tick(page, 1);
  await expect(selectedCount(page, 2)).toBeVisible();

  // One of the two is deleted behind the page - another tab, another admin.
  await apiFetch(`${PROXY}/routes/${gone}`, await loginAdmin(), {
    method: 'DELETE',
    headers: onLocal(),
  });

  await deleteButton(page, 2).click();
  await confirmDelete(page);

  // Both are gone, which is what was asked. The 404 used to end the batch on
  // the spot - the page left with both rows ticked, the list not asked again
  // and nothing said - and, once counted, would have been reported as a
  // failure of a batch that ended exactly as intended.
  await uiHasToastMsg(page, {
    hasText: i18n.t('info.delete.success', { name: `2 ${i18n.t('routes.singular')}` }),
  });
  await expect(selectedCount(page, 2)).toBeHidden();
  await expect(rowBox(page, there)).toHaveCount(0);
  await expect(rowBox(page, gone)).toHaveCount(0);

  const kept = await remaining();
  expect(kept).not.toContain(there);
  expect(kept).not.toContain(gone);
});

test('a batch delete says what was refused, and leaves it ticked to be tried again', async ({
  page,
}) => {
  await openRoutes(page, 9);
  const refused = await tick(page, 0);
  const deleted = await tick(page, 1);
  await expect(selectedCount(page, 2)).toBeVisible();

  // The gateway refuses one of the two.
  await page.route(`**/apisix/admin/routes/${refused}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error_msg: 'refused by the test' }),
        })
      : route.fallback()
  );

  await deleteButton(page, 2).click();
  await confirmDelete(page);

  await uiHasToastMsg(page, {
    hasText: i18n.t('info.delete.partial', {
      deleted: 1,
      failed: 1,
      name: i18n.t('routes.singular'),
    }),
  });
  // The one that went is off the list; the one that was refused is still on
  // it, and still ticked.
  await expect(rowBox(page, deleted)).toHaveCount(0);
  await expect(rowBox(page, refused)).toBeChecked();
  await expect(selectedCount(page, 1)).toBeVisible();

  const kept = await remaining();
  expect(kept).toContain(refused);
  expect(kept).not.toContain(deleted);
});

test('a route ticked on one instance is not ticked on another that holds the same id', async ({
  page,
}) => {
  // Two gateways number their routes alike. Ticked on one, a route arrived
  // ticked on the other, with a Delete (1) nobody had asked for there.
  const id = SHARED_ROUTE;
  await page.goto(`/ui/routes?name=${id}`);

  await rowBox(page, id).check({ timeout: 30000 });
  await expect(selectedCount(page, 1)).toBeVisible();

  await switchInstance(page, 'Staging APISIX');

  // The same id, on the other gateway: listed, and not selected.
  await expect(rowBox(page, id)).toBeVisible({ timeout: 30000 });
  await expect(rowBox(page, id)).not.toBeChecked();
  await expect(selectedCount(page, 1)).toBeHidden();
  await expect(deleteButton(page, 1)).toHaveCount(0);
});

test('nor is a row of an antd list: an upstream ticked on one instance, on the other', async ({
  page,
}) => {
  // Upstreams stand in for the ten lists that share the table and the hook.
  await page.goto('/ui/upstreams?page=1&page_size=100');
  const row = page.getByRole('row').filter({ hasText: UPSTREAM });
  await row.getByRole('checkbox').check({ timeout: 30000 });
  await expect(deleteButton(page, 1)).toBeVisible();

  await switchInstance(page, 'Staging APISIX');

  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(deleteButton(page, 1)).toHaveCount(0);
});

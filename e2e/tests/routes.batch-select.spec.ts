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
import { apiFetch, HttpError, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';

/**
 * The routes list kept every id ticked for as long as it was mounted, and
 * handed all of them to Batch Delete. Two routes ticked on page one were still
 * selected on page two, where nothing showed them: the bar came back at the
 * first row ticked there reading "3 selected", and the delete took the two
 * routes that were not on screen (#371).
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-batch');
// More than a page of ten, so that there is a second page to go to.
const ROUTES = Array.from({ length: 12 }, (_, i) => `${PREFIX}-${String(i + 1).padStart(2, '0')}`);
const fx = () => getFixtures();
const onLocal = () => ({ 'X-Instance-ID': fx().localInstanceId });

// The tests delete from the same fixtures.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const admin = await loginAdmin();
  for (const id of ROUTES) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, {
      method: 'PUT',
      headers: onLocal(),
      json: {
        uri: `/${id}`,
        name: id,
        upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
      },
    });
  }
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  for (const id of ROUTES) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
});

/** Which of the fixtures the gateway still holds. */
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

const rowBoxes = (page: Page) =>
  page.getByRole('checkbox', { name: new RegExp(`^Select ${PREFIX}`) });

/** Tick the nth row on screen, and say which route it is. */
const tick = async (page: Page, nth: number) => {
  const box = rowBoxes(page).nth(nth);
  const label = (await box.getAttribute('aria-label')) ?? '';
  await box.check();
  return label.replace(/^Select /, '');
};

const selectedCount = (page: Page, count: number) =>
  page.getByText(i18n.t('form.json.selectedCount', { count }), { exact: true });

const deleteButton = (page: Page, count: number) =>
  page.getByRole('button', { name: `Delete (${count})`, exact: true });

const openList = async (page: Page) => {
  await page.goto(`/ui/routes?name=${PREFIX}`);
  await expect(rowBoxes(page)).toHaveCount(10, { timeout: 30000 });
};

test('a batch delete takes the routes ticked on screen, not the ones ticked a page ago', async ({
  page,
}) => {
  await openList(page);
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
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await uiHasToastMsg(page, {
    hasText: i18n.t('info.delete.success', { name: '1 Route' }),
  });

  const kept = await remaining();
  expect(kept).not.toContain(third);
  // The two that were ticked on the page before, and never on screen since.
  expect(kept).toContain(first);
  expect(kept).toContain(second);
  expect(kept).toHaveLength(ROUTES.length - 1);
});

test('a batch delete says what it could not delete, and leaves nothing ticked', async ({
  page,
}) => {
  await openList(page);
  const gone = await tick(page, 0);
  const there = await tick(page, 1);
  await expect(selectedCount(page, 2)).toBeVisible();

  // One of the two is deleted behind the page - another tab, another admin.
  await apiFetch(`${PROXY}/routes/${gone}`, await loginAdmin(), {
    method: 'DELETE',
    headers: onLocal(),
  });

  await deleteButton(page, 2).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

  // One refusal used to give up the lot: the other delete had gone through,
  // and the page was left with both rows ticked, the list not asked again and
  // nothing said about either.
  await uiHasToastMsg(page, {
    hasText: i18n.t('info.delete.partial', { deleted: 1, failed: 1, name: 'Route' }),
  });
  await expect(selectedCount(page, 2)).toBeHidden();
  await expect(page.getByRole('checkbox', { name: `Select ${there}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `Select ${gone}`, exact: true })).toHaveCount(0);

  const kept = await remaining();
  expect(kept).not.toContain(there);
  expect(kept).not.toContain(gone);
});

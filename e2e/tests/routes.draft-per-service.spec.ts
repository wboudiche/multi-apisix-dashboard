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
 * A route draft belongs to the page it was started on: /routes/add, or one
 * service's route add page. All of them used to share one key, and a draft
 * restored on another of them replaced that page's defaults, service_id
 * included (#228).
 */

const PROXY = '/api/v1/apisix/admin';
const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });

const serviceA = randomId('e2e_draft_svc_a');
const serviceB = randomId('e2e_draft_svc_b');

/** Whether a stored route draft holds `text`, whatever key it is under. */
const draftHolds = (page: Page, text: string) =>
  page.evaluate(
    (t) =>
      Object.keys(localStorage).some(
        (k) => k.startsWith('apisix-route-draft') && (localStorage.getItem(k) ?? '').includes(t)
      ),
    text
  );

const dropRouteDrafts = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('apisix-route-draft'))
      .forEach((k) => localStorage.removeItem(k))
  );

/** Type a name and URI, and wait for auto-save to store them. */
const startDraft = async (page: Page, name: string) => {
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="uri"]').fill(`/${name}`);
  await expect.poll(() => draftHolds(page, `/${name}`), { timeout: 10000 }).toBe(true);
};

/** The add page offers no draft: an empty name, and no Discard Draft. */
const expectNoDraft = async (page: Page) => {
  await expect(page.locator('input[name="name"]')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Discard Draft' })).toBeHidden();
};

test.beforeAll(async () => {
  const token = await loginAdmin();
  for (const id of [serviceA, serviceB]) {
    await apiFetch(`${PROXY}/services/${id}`, token, {
      method: 'PUT',
      headers: onLocal(),
      json: { name: id, upstream },
    });
  }
});

test.beforeEach(async ({ page }) => {
  // Leaving a dirty form asks first; accept, as navigating away would.
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/ui/routes/add');
  await dropRouteDrafts(page);
});

test.afterEach(async ({ page }) => {
  await dropRouteDrafts(page);
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const id of [serviceA, serviceB]) {
    await apiFetch(`${PROXY}/services/${id}`, token, { method: 'DELETE', headers: onLocal() });
  }
});

test('a draft started on /routes/add does not show on a service route add page', async ({
  page,
}) => {
  await page.goto('/ui/routes/add');
  await startDraft(page, randomId('e2e_draft_plain'));

  await page.goto(`/ui/services/detail/${serviceA}/routes/add`);
  await expect(page.locator('input[name="name"]')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Discard Draft' })).toBeHidden();
});

test('a draft started under one service stays with that service', async ({ page }) => {
  const name = randomId('e2e_draft_scoped');
  await page.goto(`/ui/services/detail/${serviceA}/routes/add`);
  await startDraft(page, name);

  await page.goto(`/ui/services/detail/${serviceB}/routes/add`);
  await expectNoDraft(page);
  await page.goto('/ui/routes/add');
  await expectNoDraft(page);

  // Back on the service it was started for, it is still offered.
  await page.goto(`/ui/services/detail/${serviceA}/routes/add`);
  await expect(page.locator('input[name="name"]')).toHaveValue(name);
});

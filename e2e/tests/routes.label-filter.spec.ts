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

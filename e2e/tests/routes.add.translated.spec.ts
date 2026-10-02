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

import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * What a reader of another language still saw in English was text that was
 * never a key: sentences written as strings outside JSX, where nothing that
 * holds the screens to their translations looked - a wizard's steps, a zod
 * message (#364).
 *
 * In German, because in English a page that reads its keys and one that has
 * the sentences written in cannot be told apart.
 */
type Bundle = {
  form: {
    btn: { next: string };
    steps: { apiInfo: string; apiInfoDesc: string; upstream: string; preview: string };
    validation: { nameRequired: string };
  };
};
const german = JSON.parse(
  readFileSync(new URL('../../src/locales/de/common.json', import.meta.url), 'utf8')
) as Bundle;

const switchToGerman = async (page: Page) => {
  await page.locator('header .mantine-ActionIcon-root[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Deutsch' }).click();
};

test('the route wizard is in the language of the page: its steps and its refusals', async ({
  page,
}) => {
  await page.goto('/ui/routes/add');
  // No draft of another test: the form as it starts.
  await page.evaluate(() => localStorage.removeItem('apisix-route-draft'));
  await page.reload();
  await expect(page.getByText('Define API Information')).toBeVisible({ timeout: 30000 });

  await switchToGerman(page);

  // The steps: they were a table of labels above the JSX.
  await expect(page.getByText(german.form.steps.apiInfo)).toBeVisible();
  await expect(page.getByText(german.form.steps.apiInfoDesc)).toBeVisible();
  await expect(page.getByText(german.form.steps.upstream)).toBeVisible();
  await expect(page.getByText(german.form.steps.preview, { exact: true })).toBeVisible();
  await expect(page.getByText('Define API Information')).toHaveCount(0);

  // And what the form refuses: a zod message, written where there is no `t`.
  await page.getByRole('button', { name: german.form.btn.next, exact: true }).click();
  await expect(page.getByText(german.form.validation.nameRequired)).toBeVisible();
  await expect(page.getByText('Name is required')).toHaveCount(0);
});

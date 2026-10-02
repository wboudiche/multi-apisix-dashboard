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
import { streamRoutesPom } from '@e2e/pom/stream_routes';
import { test } from '@e2e/utils/test';
import { uiSwitchLanguage } from '@e2e/utils/ui';
import { i18n, i18nIn } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

/**
 * zod's words for a value out of range - "Number must be less than or equal
 * to 65535" - were English in every language: a key alone could not carry the
 * 65535. The refusal is a key now, with its bound.
 *
 * In German, because in English zod's words and the key's would both read as
 * English.
 */
const de = i18nIn('de');

test('a server port out of range is refused in the language of the page, with its bound', async ({
  page,
}) => {
  await streamRoutesPom.toIndex(page);
  await streamRoutesPom.toAdd(page);
  await expect(page.getByLabel(i18n.t('form.streamRoutes.serverPort'), { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await uiSwitchLanguage(page, 'Deutsch');

  await page.getByLabel(de.t('form.streamRoutes.serverPort'), { exact: true }).fill('70000');
  await page.getByRole('button', { name: de.t('form.btn.add'), exact: true }).click();

  await expect(page.getByText(de.t('form.validation.atMost', { maximum: 65535 }))).toBeVisible();
  await expect(page.getByText('Number must be less than or equal to 65535')).toHaveCount(0);
  await expect(page.getByText('form.validation.')).toHaveCount(0);
});

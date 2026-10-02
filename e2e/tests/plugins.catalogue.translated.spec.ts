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
import { globalRulePom } from '@e2e/pom/global_rules';
import { test } from '@e2e/utils/test';
import { uiSwitchLanguage } from '@e2e/utils/ui';
import { i18n, i18nIn } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

/**
 * The plugin picker described every plugin in English whatever the language
 * of the page: the catalogue was a table of sentences the translations never
 * reached.
 *
 * In German, because in English the catalogue's words and the keys' read alike.
 */
const de = i18nIn('de');

test('the plugin picker describes each plugin in the language of the page', async ({ page }) => {
  await globalRulePom.toAdd(page);
  await globalRulePom.isAddPage(page);

  await uiSwitchLanguage(page, 'Deutsch');

  await page.getByRole('button', { name: de.t('form.plugins.selectPlugins.title') }).click();
  const dialog = page.getByRole('dialog', { name: de.t('form.plugins.selectPlugins.title') });
  await dialog.getByPlaceholder(de.t('form.search')).fill('limit-count');

  const card = dialog.getByTestId('plugin-limit-count');
  await expect(card.getByText(de.t('form.plugins.descriptions.limit-count'))).toBeVisible();
  await expect(card.getByText(i18n.t('form.plugins.descriptions.limit-count'))).toHaveCount(0);
});

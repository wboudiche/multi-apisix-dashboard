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
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiSwitchLanguage } from '@e2e/utils/ui';
import { i18n, i18nIn } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

import { API_PLUGIN_METADATA } from '@/config/constant';

/**
 * Saving plugin metadata said "Plugin Metadaten of rocketmq-logger erfolgreich
 * bearbeitet": the "of" between the resource and the plugin was written in
 * the code, in English, where no lint rule looks - the string begins with a
 * value.
 */
const de = i18nIn('de');

// A plugin no other spec names. Not one another spec only reads either: the
// viewer spec picks tcp-logger in Select Plugins, which lists only the plugins
// that have no metadata yet, and this entry would take it out of the list.
const PLUGIN = 'rocketmq-logger';

test.beforeAll(async () => {
  await e2eReq.put(`${API_PLUGIN_METADATA}/${PLUGIN}`, { log_format: { host: '$host' } });
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_PLUGIN_METADATA}/${PLUGIN}`).catch(() => {});
});

test('saving plugin metadata is announced in the language of the page', async ({ page }) => {
  await page.goto('/ui/plugin_metadata');
  const card = page.getByTestId(`plugin-${PLUGIN}`);
  await expect(card).toBeVisible({ timeout: 30000 });

  await uiSwitchLanguage(page, 'Deutsch');

  await card.getByRole('button', { name: de.t('form.btn.edit') }).click();
  const drawer = page.getByRole('dialog', { name: de.t('form.plugins.editPlugin') });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: de.t('form.btn.save') }).click();

  const named = de.t('pluginMetadata.of', { plugin: PLUGIN });
  await expect(page.getByText(de.t('info.edit.success', { name: named }))).toBeVisible();
  await expect(page.getByText(` of ${PLUGIN}`)).toHaveCount(0);
  // And in English, as it read before.
  expect(i18n.t('info.edit.success', { name: i18n.t('pluginMetadata.of', { plugin: PLUGIN }) })).toBe(
    `Edit Plugin Metadata of ${PLUGIN} Successfully`
  );
});

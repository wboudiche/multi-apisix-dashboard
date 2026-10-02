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
import { uiSwitchLanguage } from '@e2e/utils/ui';
import { i18n, i18nIn } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

/**
 * A button that shows only an icon was announced as "button" and nothing
 * else: the language menu, the navigation toggle, the refresh of the routes
 * list. Each has a name now, in the language of the page.
 */
const de = i18nIn('de');

test('the icon buttons of the header and the routes list have names, translated', async ({ page }) => {
  await page.goto('/ui/routes');
  const language = page.getByRole('button', { name: i18n.t('header.language'), exact: true });
  await expect(language).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: i18n.t('common.collapse'), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: i18n.t('routes.list.refresh'), exact: true })).toBeVisible();

  await uiSwitchLanguage(page, 'Deutsch');

  await expect(page.getByRole('button', { name: de.t('header.language'), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: de.t('common.collapse'), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: de.t('routes.list.refresh'), exact: true })).toBeVisible();
  await expect(language).toHaveCount(0);
});

test('the navigation toggle of a narrow screen says what it will do', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/ui/routes');
  const open = page.getByRole('button', { name: i18n.t('header.openNavigation'), exact: true });
  await expect(open).toBeVisible({ timeout: 30000 });
  await open.click();
  await expect(page.getByRole('button', { name: i18n.t('header.closeNavigation'), exact: true })).toBeVisible();
});

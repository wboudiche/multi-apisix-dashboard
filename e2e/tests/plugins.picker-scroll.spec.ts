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
import { i18n } from '@e2e/utils/ui/i18n';
import { expect } from '@playwright/test';

/**
 * The plugin picker showed its scrollbar only while it was being scrolled, so
 * nothing said there were dozens of plugins below the first screen; and on a
 * short window its list ran past the bottom, the drawer scrolling around it.
 *
 * Scrolled with the wheel, as a person does. A click would not prove it:
 * Playwright scrolls the card into view first, and a box that hides its
 * overflow still scrolls when a script asks it to.
 */
test('the plugin picker scrolls to its last plugin', async ({ page }) => {
  // A laptop's window: the list was given 80% of it under a header of its
  // own, and ran past the bottom of anything under about 650px.
  await page.setViewportSize({ width: 1280, height: 600 });
  await globalRulePom.toAdd(page);
  await globalRulePom.isAddPage(page);

  const title = i18n.t('form.plugins.selectPlugins.title');
  await page.getByRole('button', { name: title }).click();
  const dialog = page.getByRole('dialog', { name: title });

  const cards = dialog.locator('[data-testid^="plugin-"]');
  const first = cards.first();
  const last = cards.last();
  await expect(first).toBeVisible();
  // Otherwise there is nothing to scroll, and the test proves nothing.
  await expect(last).not.toBeInViewport();
  // A scrollbar says so before anything is scrolled: one shown only while
  // scrolling told nobody there was more below.
  await expect(dialog.locator('.mantine-ScrollArea-scrollbar[data-orientation="vertical"]')).toBeVisible();
  // One box scrolls, not the drawer around it as well.
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        const content = el.closest('.mantine-Drawer-content') ?? el;
        return content.scrollHeight - content.clientHeight;
      })
    )
    .toBeLessThanOrEqual(1);

  await first.hover();
  await expect(async () => {
    await page.mouse.wheel(0, 1500);
    await expect(last).toBeInViewport({ ratio: 1, timeout: 500 });
  }).toPass();

  await last.getByRole('button', { name: i18n.t('form.btn.add') }).click();
  await expect(page.getByRole('dialog', { name: i18n.t('form.plugins.addPlugin') })).toBeVisible();
});

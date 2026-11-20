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
import { routesPom } from '@e2e/pom/routes';
import { upstreamsPom } from '@e2e/pom/upstreams';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * Light, dark, or as the operating system says - the header's theme menu,
 * kept in this browser and applied before the first paint.
 */

const scheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'));

/** How light a computed background is, 0 (black) to 255 (white). */
const lightness = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });

const pickTheme = async (page: Page, name: 'Light' | 'Dark' | 'System') => {
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};

test.afterEach(async ({ page }) => {
  // The worker's other tests start from the system's scheme again.
  await page.evaluate(() => localStorage.removeItem('mantine-color-scheme-value'));
});

test('follows the operating system until told otherwise', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await expect.poll(() => scheme(page)).toBe('dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => scheme(page)).toBe('light');
});

test('keeps the scheme picked, the tables with it, across a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  // A list drawn by antd's table, themed apart from Mantine.
  await upstreamsPom.toIndex(page);
  await upstreamsPom.isIndexPage(page);

  await test.step('dark, picked from the header', async () => {
    await pickTheme(page, 'Dark');
    await expect.poll(() => scheme(page)).toBe('dark');
    // The menu closes, and opened again says which one is in use.
    await expect(page.getByRole('menuitem', { name: 'Dark', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Dark', exact: true })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    // The resource tables are antd's, themed apart from Mantine.
    await expect.poll(() => lightness(page, '.ant-table')).toBeLessThan(80);
  });

  await test.step('still dark after a reload, from the first paint', async () => {
    await page.reload();
    // Before the app has run: the script in index.html set it.
    expect(await scheme(page)).toBe('dark');
    await upstreamsPom.isIndexPage(page);
    await expect.poll(() => lightness(page, '.ant-table')).toBeLessThan(80);
  });

  await test.step('light again, the tables with it', async () => {
    await pickTheme(page, 'Light');
    await expect.poll(() => scheme(page)).toBe('light');
    await expect.poll(() => lightness(page, '.ant-table')).toBeGreaterThan(200);
  });

  await test.step('back to the system\'s', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await pickTheme(page, 'System');
    await expect.poll(() => scheme(page)).toBe('dark');
  });
});

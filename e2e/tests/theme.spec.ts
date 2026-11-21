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
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

import { putRouteReq } from '@/apis/routes';
import { API_ROUTES } from '@/config/constant';

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

  await test.step('dark from the first paint, before the app has run', async () => {
    // Every script file refused: what sets the scheme now is the one written
    // into index.html, or nothing - and Mantine, which would set it too once
    // mounted, never runs.
    await page.route('**/*', (route) =>
      route.request().resourceType() === 'script' ? route.abort() : route.continue()
    );
    await page.reload();
    expect(await scheme(page)).toBe('dark');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  await test.step('still dark after a reload, the tables with it', async () => {
    await page.reload();
    await upstreamsPom.isIndexPage(page);
    await expect.poll(() => scheme(page)).toBe('dark');
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

/**
 * The contrast of a field's text on what is behind it, as it is drawn: its
 * colour, with its own alpha and the opacity of it and every ancestor, over
 * the first background that is not clear - the page's own when none is.
 */
const fieldContrast = (page: Page, label: string) =>
  page.getByRole('textbox', { name: label, exact: true }).first().evaluate((el) => {
    const rgba = (c: string) => {
      const [r, g, b, a = 1] = c.match(/[\d.]+/g)!.map(Number);
      return { rgb: [r, g, b], a };
    };
    let alpha = rgba(getComputedStyle(el).color).a;
    let bg: number[] | undefined;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      alpha *= Number(style.opacity);
      const back = rgba(style.backgroundColor);
      if (!bg && back.a > 0) bg = back.rgb;
    }
    bg ??= rgba(getComputedStyle(document.body).backgroundColor).rgb;
    const fg = rgba(getComputedStyle(el).color).rgb.map((c, i) => c * alpha + bg![i] * (1 - alpha));
    const lum = ([r, g, b]: number[]) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });

test('shows a record\'s fields readable, in either scheme', async ({ page }) => {
  const id = randomId('theme-route');
  await putRouteReq(e2eReq, {
    id,
    name: `${id}-name`,
    uri: `/${id}`,
    upstream: { nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
  });
  try {
    for (const colorScheme of ['dark', 'light'] as const) {
      await test.step(colorScheme, async () => {
        await page.emulateMedia({ colorScheme });
        await uiGoto(page, '/routes/detail/$id', { id });
        await routesPom.isDetailPage(page);
        await expect.poll(() => scheme(page)).toBe(colorScheme);
        const name = page.getByRole('textbox', { name: 'Name', exact: true }).first();
        await expect(name).toHaveValue(`${id}-name`);
        await expect(name).toBeDisabled();
        // Polled: the inputs ease their colours in, and a first frame reads
        // halfway between the page's defaults and the scheme's.
        await expect.poll(() => fieldContrast(page, 'Name')).toBeGreaterThanOrEqual(4.5);
        // Set apart from a field to type in, now that it is not faded: by a
        // background other than the card's every input has.
        const [field, card] = await name.evaluate((el) => [
          getComputedStyle(el).backgroundColor,
          getComputedStyle(el.closest('.mantine-Paper-root, [class*="Fieldset"]') ?? document.body).backgroundColor,
        ]);
        expect(field).not.toBe(card);
      });
    }
  } finally {
    await e2eReq.delete(`${API_ROUTES}/${id}`).catch(() => undefined);
  }
});

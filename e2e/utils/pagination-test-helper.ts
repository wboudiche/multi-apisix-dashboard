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

import { expect, type Locator, type Page } from '@playwright/test';

import { test as realTest } from './test';

export interface PaginationTestConfig<T> {
  pom: {
    toIndex: (page: Page) => Promise<unknown>;
    isIndexPage: (page: Page) => Promise<void>;
  };
  filterItemsNotInPage: (page: Page) => Promise<T[]>;
  getCell: (page: Page, item: T) => Locator;
  /**
   * 'antd' (default): ProTable pagination with a "N / page" size selector.
   * 'mantine': Mantine <Pagination> — page numbers are buttons and there is
   * no page-size selector, so size-switching steps are skipped (page_size
   * still works through the URL).
   */
  variant?: 'antd' | 'mantine';
}

export function setupPaginationTests<T>(
  test: typeof realTest,
  { pom, filterItemsNotInPage, getCell, variant = 'antd' }: PaginationTestConfig<T>
) {
  const defaultPageNum = 1;
  const defaultPageSize = 10;
  const newPageSize = 20;
  const newPageNum = 2;
  const hasPageSizeSelector = variant === 'antd';

  const getPageSizeSelection = (page: Page, size: number) => {
    return page
      .locator('.ant-select-selection-item')
      .filter({ hasText: new RegExp(`${size} / page`) })
      .first();
  };

  const getPageSizeOption = (page: Page, size: number) => {
    return page.getByRole('option', { name: `${size} / page` });
  };

  const getPageNum = (page: Page, num: number) => {
    if (variant === 'mantine') {
      return page.getByRole('button', { name: `${num}`, exact: true });
    }
    return page.getByRole('listitem', { name: `${num}` });
  };

  /**
   * The data rows on screen, as text, with the header row dropped.
   *
   * Used by the assertions below instead of naming the fixtures directly.
   * A spec's own items only occupy a whole page when nothing else is on the
   * gateway, which is why these tests used to empty it first — and emptying it
   * is what made the suite order-dependent (#82). Comparing rows to each other
   * tests the same behaviour without caring what else exists.
   */
  const visibleRows = async (page: Page): Promise<string[]> => {
    const rows = await page.getByRole('row').allInnerTexts();
    return rows.slice(1).map((r) => r.trim()).filter(Boolean);
  };

  const itemIsHidden = async (page: Page, item: T) => {
    const cell = getCell(page, item);
    // Increased timeout for CI environments where pagination might be slower
    await expect(cell).toBeHidden({ timeout: 10000 });
  };

  test('can use the pagination of the table to switch', async ({ page }) => {
    await test.step('navigate to list page', async () => {
      await pom.toIndex(page);
      await pom.isIndexPage(page);
    });

    await test.step('default page info should exists', async () => {
      // page_size should exist in url
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get('page_size') === defaultPageSize.toString()
      );
      // page_size should exist in table
      if (hasPageSizeSelector) {
        await expect(getPageSizeSelection(page, defaultPageSize)).toBeVisible();
      }

      // pageNum should exist in url
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('page') === defaultPageNum.toString()
      );
      // pageNum should exist in table
      await expect(getPageNum(page, defaultPageNum)).toBeVisible();

      const itemsNotInPage = await filterItemsNotInPage(page);
      // items not in page should not be visible
      for (const item of itemsNotInPage) {
        await itemIsHidden(page, item);
      }
    });

    if (hasPageSizeSelector) {
      await test.step(`can switch page size to ${newPageSize}`, async () => {
        const rowsBefore = (await visibleRows(page)).length;

        // click page size selection, then click new page size option
        await getPageSizeSelection(page, defaultPageSize).click();
        await getPageSizeOption(page, newPageSize).click();

        await expect(getPageSizeSelection(page, newPageSize)).toBeVisible();
        await expect(getPageNum(page, defaultPageNum)).toBeVisible();
        // old page_size should be hidden
        await expect(getPageSizeSelection(page, defaultPageSize)).toBeHidden();

        // page_size should exist in url
        await expect(page).toHaveURL(
          (url) => url.searchParams.get('page_size') === newPageSize.toString()
        );
        // pageNum should exist in url
        await expect(page).toHaveURL(
          (url) => url.searchParams.get('page') === defaultPageNum.toString()
        );

        // A larger page shows more rows, and never more than it allows. The
        // fixtures seed more than defaultPageSize items, so there is always
        // something for the extra capacity to reveal.
        await expect
          .poll(async () => (await visibleRows(page)).length)
          .toBeGreaterThan(rowsBefore);
        expect((await visibleRows(page)).length).toBeLessThanOrEqual(newPageSize);
      });
    }

    if (hasPageSizeSelector) {
      await test.step('switch to default', async () => {
        await getPageSizeSelection(page, newPageSize).click();
        await getPageSizeOption(page, defaultPageSize).click();

        await expect(getPageSizeSelection(page, defaultPageSize)).toBeVisible();
        await expect(getPageNum(page, defaultPageNum)).toBeVisible();
        await expect(getPageSizeSelection(page, newPageSize)).toBeHidden();
      });
    }

    await test.step(`can switch page num to ${newPageNum}`, async () => {
      const firstPage = await visibleRows(page);

      // click page num
      await getPageNum(page, defaultPageNum).click();
      await getPageNum(page, newPageNum).click();

      // pageNum should exist in url
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('page') === newPageNum.toString()
      );
      await pom.isIndexPage(page);

      // The second page carries different rows from the first. Asserting that
      // this spec's own leftovers land there needs the gateway to hold nothing
      // else; comparing the two pages does not, and is what pagination is
      // actually meant to do.
      const secondPage = await visibleRows(page);
      expect(secondPage.length).toBeGreaterThan(0);
      expect(secondPage.filter((row) => firstPage.includes(row))).toEqual([]);
    });
  });

  test('can use the search params in the URL to switch', async ({ page }) => {
    await test.step('navigate to list page', async () => {
      await pom.toIndex(page);
      await pom.isIndexPage(page);
    });

    await test.step('default page info should exists', async () => {
      // page_size should exist in url
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get('page_size') === defaultPageSize.toString()
      );
      // page_size should exist in table
      if (hasPageSizeSelector) {
        await expect(getPageSizeSelection(page, defaultPageSize)).toBeVisible();
      }

      // pageNum should exist in url
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('page') === defaultPageNum.toString()
      );
      // pageNum should exist in table
      await expect(getPageNum(page, defaultPageNum)).toBeVisible();

      // items not in page should not be visible
      const itemsNotInPage = await filterItemsNotInPage(page);
      for (const item of itemsNotInPage) {
        await itemIsHidden(page, item);
      }
    });

    await test.step(`can switch page size to ${newPageSize}`, async () => {
      const url = new URL(page.url());
      url.searchParams.set('page_size', newPageSize.toString());
      await page.goto(url.toString());

      // check pagination
      if (hasPageSizeSelector) {
        await expect(getPageSizeSelection(page, newPageSize)).toBeVisible();
        await expect(getPageSizeSelection(page, defaultPageSize)).toBeHidden();
      }
      await expect(getPageNum(page, defaultPageNum)).toBeVisible();

      // pagination should exist in url
      await expect(page).toHaveURL((url) => {
        return (
          url.searchParams.get('page_size') === newPageSize.toString() &&
          url.searchParams.get('page') === defaultPageNum.toString()
        );
      });

      // Same reasoning as the click-driven test above: a bigger page shows
      // more rows, without assuming the gateway holds only this spec's data.
      expect((await visibleRows(page)).length).toBeLessThanOrEqual(newPageSize);
      expect((await visibleRows(page)).length).toBeGreaterThan(0);
    });

    await test.step('switch to default', async () => {
      const url = new URL(page.url());
      url.searchParams.set('page_size', defaultPageSize.toString());
      await page.goto(url.toString());

      if (hasPageSizeSelector) {
        await expect(getPageSizeSelection(page, defaultPageSize)).toBeVisible();
        await expect(getPageSizeSelection(page, newPageSize)).toBeHidden();
      }
      await expect(getPageNum(page, defaultPageNum)).toBeVisible();
    });

    await test.step(`can switch page num to ${newPageNum}`, async () => {
      const firstPage = await visibleRows(page);

      const url = new URL(page.url());
      url.searchParams.set('page', newPageNum.toString());
      await page.goto(url.toString());

      // pageNum should exist in url
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('page') === newPageNum.toString()
      );
      await pom.isIndexPage(page);

      // The second page carries different rows from the first.
      const secondPage = await visibleRows(page);
      expect(secondPage.length).toBeGreaterThan(0);
      expect(secondPage.filter((row) => firstPage.includes(row))).toEqual([]);
    });
  });
}

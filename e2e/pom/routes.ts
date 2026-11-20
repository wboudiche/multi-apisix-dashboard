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
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

const locator = {
  getRouteNavBtn: (page: Page) =>
    page.getByRole('link', { name: 'Routes', exact: true }),
  // The list's two ways to a new route: the one-screen dialog, and the full
  // form as a link of its own.
  getAddRouteBtn: (page: Page) =>
    page.getByRole('button', { name: 'Quick route', exact: true }),
  getAdvancedRouteLink: (page: Page) =>
    page.getByRole('link', { name: 'Advanced route', exact: true }),
  getAddBtn: (page: Page) =>
    page.getByRole('button', { name: 'Add', exact: true }),
  rowByName: (page: Page, name: string) =>
    page.getByRole('row').filter({ hasText: name }),
};

const assert = {
  isIndexPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/routes'));
    const title = page.getByRole('heading', { name: 'Routes' });
    await expect(title).toBeVisible();
  },
  isAddPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/routes/add'));
    const title = page.getByRole('heading', { name: 'Add Route' });
    await expect(title).toBeVisible();
  },
  isDetailPage: async (page: Page) => {
    await expect(page).toHaveURL((url) =>
      url.pathname.includes('/routes/detail')
    );
    const title = page.getByRole('heading', { name: 'Route Detail' });
    await expect(title).toBeVisible();
  },
};

const goto = {
  toIndex: (page: Page) => uiGoto(page, '/routes'),
  toAdd: (page: Page) => uiGoto(page, '/routes/add'),
  /**
   * The wizard, by the dialog's way on to it: Quick route opens the
   * quick-create dialog, and it hands over to the advanced form.
   */
  openAddWizard: async (page: Page) => {
    await page.getByRole('button', { name: 'Quick route', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New route' });
    await dialog.getByRole('button', { name: 'Continue in the advanced form' }).click();
  },
};

export const routesPom = {
  ...locator,
  ...assert,
  ...goto,
};

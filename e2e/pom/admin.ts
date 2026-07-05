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
  rowByText: (page: Page, text: string) =>
    page.getByRole('row').filter({ hasText: text }),
  // Same header Select the permission POM targets (placeholder or searchbox).
  headerInstanceSelect: (page: Page) =>
    page
      .locator('header')
      .getByPlaceholder('Select instance')
      .or(page.locator('header').getByRole('searchbox'))
      .first(),
};

const assert = {
  isTeamsPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/teams'));
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  },
  isInstancesPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/instances'));
    await expect(page.getByRole('heading', { name: 'Instances' })).toBeVisible();
  },
  isUsersPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/users'));
    await expect(
      page.getByRole('heading', { name: 'User Management' })
    ).toBeVisible();
  },
  isOverviewPage: async (page: Page) => {
    await expect(page).toHaveURL((url) => url.pathname.endsWith('/overview'));
    await expect(
      page.getByRole('heading', { name: 'Dashboard Overview' })
    ).toBeVisible();
  },
};

const goto = {
  toTeams: (page: Page) => uiGoto(page, '/teams'),
  toInstances: (page: Page) => uiGoto(page, '/instances'),
  toUsers: (page: Page) => uiGoto(page, '/users'),
  toOverview: (page: Page) => uiGoto(page, '/overview'),
};

export const adminPom = {
  ...locator,
  ...assert,
  ...goto,
};

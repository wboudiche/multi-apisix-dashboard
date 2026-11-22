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
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';

/**
 * The settings page: the password policy, the Keycloak connections
 * ("Identity providers") and the OIDC clients the dashboard created. Which
 * tabs a caller gets depends on their role (src/components/page-slice/settings/tabs.ts).
 */
const locator = {
  tab: (page: Page, key: 'settings.passwordPolicy' | 'settings.idp.title' | 'settings.oidcClients.title') =>
    page.getByRole('tab', { name: i18n.t(key), exact: true }),
  /** The table row that shows `text`: a connection by its name, a client by its id. */
  rowShowing: (page: Page, text: string) => page.getByRole('row').filter({ hasText: text }),
  idpDialog: (page: Page) => page.getByRole('dialog'),
};

const assert = {
  isSettingsPage: async (page: Page) => {
    await expect(page.getByRole('heading', { name: i18n.t('sources.settings') })).toBeVisible();
  },
};

const goto = {
  toSettings: async (page: Page) => {
    await uiGoto(page, '/settings');
    await assert.isSettingsPage(page);
  },
  toIdentityProviders: async (page: Page) => {
    await goto.toSettings(page);
    await locator.tab(page, 'settings.idp.title').click();
  },
  toOidcClients: async (page: Page) => {
    await goto.toSettings(page);
    await locator.tab(page, 'settings.oidcClients.title').click();
  },
};

export const settingsPom = {
  ...locator,
  ...assert,
  ...goto,
};

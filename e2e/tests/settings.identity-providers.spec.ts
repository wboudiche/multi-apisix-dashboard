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
import { settingsPom } from '@e2e/pom/settings';
import {
  cleanUpKeycloak,
  createIdp,
  e2eConnection,
  listIdps,
} from '@e2e/utils/keycloak';
import { loginAdmin } from '@e2e/utils/seed-client';
import {
  KEYCLOAK_ADMIN_CLIENT_ID,
  KEYCLOAK_ADMIN_CLIENT_SECRET,
  KEYCLOAK_REALM,
  stack,
} from '@e2e/utils/stack';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Page } from '@playwright/test';
import { customAlphabet } from 'nanoid';

/**
 * A super admin declares a Keycloak connection in Settings, tests it, and
 * edits it without the service account's secret ever coming back: the field
 * is write-only, and an update that leaves it empty keeps the stored one.
 */
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);
const RUN = nanoid();
const NAME_PREFIX = `e2e-idp-${RUN}`;
// A connection's client-id prefix: lowercase letters, digits and dashes.
const CLIENT_PREFIX = `e2e${RUN}-`;
const NAME = `${NAME_PREFIX}-form`;

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await cleanUpKeycloak(NAME_PREFIX, CLIENT_PREFIX);
});

const dialogField = (page: Page, key: string) =>
  settingsPom.idpDialog(page).getByLabel(i18n.t(key), { exact: false });

const testConnection = async (page: Page, name: string) => {
  await settingsPom
    .rowShowing(page, name)
    .getByRole('button', { name: i18n.t('settings.idp.test.button') })
    .click();
};

test('a super admin adds a connection and it works', async ({ page }) => {
  await settingsPom.toIdentityProviders(page);
  await page.getByRole('button', { name: i18n.t('settings.idp.add') }).click();
  const dialog = settingsPom.idpDialog(page);
  await expect(dialog.getByText(i18n.t('settings.idp.addTitle'))).toBeVisible();

  await dialog.getByRole('textbox', { name: i18n.t('settings.idp.column.name') }).fill(NAME);
  await dialog.getByRole('textbox', { name: i18n.t('settings.idp.field.baseUrl') }).fill(stack.keycloak);
  await dialog.getByRole('textbox', { name: i18n.t('settings.idp.field.realm') }).fill(KEYCLOAK_REALM);
  await dialog
    .getByRole('textbox', { name: i18n.t('settings.idp.field.adminClientId') })
    .fill(KEYCLOAK_ADMIN_CLIENT_ID);
  await dialogField(page, 'settings.idp.field.adminClientSecret').fill(KEYCLOAK_ADMIN_CLIENT_SECRET);
  await dialog
    .getByRole('textbox', { name: i18n.t('settings.idp.field.prefix') })
    .fill(CLIENT_PREFIX);
  await dialog.getByRole('textbox', { name: i18n.t('settings.idp.field.instances') }).click();
  await page.getByRole('option', { name: 'Local APISIX', exact: true }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: i18n.t('form.btn.save') }).click();

  await uiHasToastMsg(page, { hasText: i18n.t('settings.idp.created') });
  const row = settingsPom.rowShowing(page, NAME);
  await expect(row).toContainText(stack.keycloak);
  await expect(row).toContainText('Local APISIX');

  await testConnection(page, NAME);
  await uiHasToastMsg(page, { hasText: i18n.t('settings.idp.test.ok') });
});

test('the secret is never shown again, and an edit without it keeps it', async ({ page }) => {
  const token = await loginAdmin();
  const saved = (await listIdps(token)).find((p) => p.name === NAME);
  expect(saved?.has_secret).toBe(true);
  expect(JSON.stringify(saved)).not.toContain(KEYCLOAK_ADMIN_CLIENT_SECRET);

  await settingsPom.toIdentityProviders(page);
  await settingsPom
    .rowShowing(page, NAME)
    .getByRole('button', { name: i18n.t('form.btn.edit') })
    .click();
  const dialog = settingsPom.idpDialog(page);
  await expect(dialog.getByText(i18n.t('settings.idp.editTitle'))).toBeVisible();
  const secret = dialogField(page, 'settings.idp.field.adminClientSecret');
  await expect(secret).toHaveValue('');
  await expect(secret).toHaveAttribute('placeholder', i18n.t('settings.idp.field.secretUnchanged'));

  // A change that needs no secret: the name.
  const renamed = `${NAME}-renamed`;
  await dialog.getByRole('textbox', { name: i18n.t('settings.idp.column.name') }).fill(renamed);
  await dialog.getByRole('button', { name: i18n.t('form.btn.save') }).click();
  await uiHasToastMsg(page, { hasText: i18n.t('settings.idp.updated') });

  // The stored secret still signs the service account in.
  await testConnection(page, renamed);
  await uiHasToastMsg(page, { hasText: i18n.t('settings.idp.test.ok') });
});

test('a secret Keycloak refuses is reported as such', async ({ page }) => {
  const name = `${NAME_PREFIX}-wrong`;
  await createIdp(await loginAdmin(), {
    ...e2eConnection(name, `${CLIENT_PREFIX}w-`),
    admin_client_secret: 'not-the-secret',
  });

  await settingsPom.toIdentityProviders(page);
  await testConnection(page, name);
  await expect(
    page.getByRole('alert').filter({ hasText: i18n.t('settings.idp.test.auth') })
  ).toBeVisible();
});

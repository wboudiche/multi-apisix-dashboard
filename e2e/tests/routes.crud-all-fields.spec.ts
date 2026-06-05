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
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillMonacoEditor,
  uiGetMonacoEditor,
  uiHasToastMsg,
} from '@e2e/utils/ui';
import {
  ROUTE_STEP_API_INFO,
  uiAddRouteNode,
  uiGotoRouteStep,
  uiRouteWizardNext,
  uiRouteWizardSubmit,
} from '@e2e/utils/ui/routes';
import { expect } from '@playwright/test';

import { deleteAllRoutes } from '@/apis/routes';

const routeNameWithAllFields = randomId('test-route-full');
const routeUri = '/test-route-all-fields';
const description = 'This is a test description for the route with all fields';
// Define vars values for testing
const initialVars = '[["arg_name", "==", "json"], ["arg_age", ">", 18]]';
const updatedVars = '[["arg_name", "==", "updated"], ["arg_age", ">", 21]]';

test.beforeAll(async () => {
  await deleteAllRoutes(e2eReq);
});

test('should CRUD route with all fields', async ({ page }) => {
  test.slow();

  // The Vars Monaco editor lives in the field's InputWrapper, not in the
  // label's direct parent
  const varsSection = page
    .locator('.mantine-InputWrapper-root')
    .filter({ has: page.getByText('Vars', { exact: true }) })
    .first();

  // Navigate to the route list page
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);

  // Click the add route button
  await routesPom.getAddRouteBtn(page).click();
  await routesPom.isAddPage(page);

  await test.step('1: API information', async () => {
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(routeNameWithAllFields);
    await page.getByLabel('Description').first().fill(description);
    await page.getByLabel('URI', { exact: true }).fill(routeUri);

    // The add page pre-fills methods GET/POST/PUT/DELETE, so no method
    // selection is required here.

    // Fill in Host field.
    await page.getByLabel('Host', { exact: true }).first().fill('example.com');

    // Fill in Remote Address field.
    await page
      .getByLabel('Remote Address', { exact: true })
      .first()
      .fill('192.168.1.0/24');

    // Set Priority.
    await page.getByLabel('Priority', { exact: true }).first().fill('100');

    // Toggle Status to Disabled.
    const status = page.getByRole('textbox', { name: 'Status', exact: true });
    await status.click();
    await page.getByRole('option', { name: 'Disabled' }).click();
    await expect(status).toHaveValue('Disabled');

    // Fill in Vars field.
    const varsEditor = await uiGetMonacoEditor(page, varsSection);
    await uiFillMonacoEditor(page, varsEditor, initialVars);

    await uiRouteWizardNext(page);
  });

  await test.step('2: custom upstream nodes', async () => {
    await uiAddRouteNode(page, 'test.com', 80);
    await uiAddRouteNode(page, 'test2.com', 80);
    await uiRouteWizardNext(page);
  });

  await test.step('3: request override', async () => {
    await uiRouteWizardNext(page);
  });

  await test.step('4: plugins', async () => {
    const selectPluginsBtn = page.getByRole('button', {
      name: 'Select Plugins',
    });
    await selectPluginsBtn.click();

    // Add basic-auth plugin.
    const selectPluginsDialog = page.getByRole('dialog', {
      name: 'Select Plugins',
    });
    const searchInput = selectPluginsDialog.getByPlaceholder('Search');
    await searchInput.fill('basic-auth');

    await selectPluginsDialog
      .getByTestId('plugin-basic-auth')
      .getByRole('button', { name: 'Add' })
      .click();

    const addPluginDialog = page.getByRole('dialog', { name: 'Add Plugin' });
    // The editor opens in Form mode for plugins with a schema; switch to JSON
    await addPluginDialog.locator('label:has-text("JSON")').click();
    const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog);
    await uiFillMonacoEditor(page, pluginEditor, '{"hide_credentials": true}');
    await addPluginDialog.getByRole('button', { name: 'Add' }).click();
    await expect(addPluginDialog).toBeHidden();

    const pluginsSection = page.getByRole('group', { name: 'Plugins' });
    const basicAuthPlugin = pluginsSection.getByTestId('plugin-basic-auth');
    await basicAuthPlugin.getByRole('button', { name: 'Edit' }).click();

    const editPluginDialog = page.getByRole('dialog', { name: 'Edit Plugin' });
    await expect(editPluginDialog.getByText('hide_credentials')).toBeVisible();
    await editPluginDialog.getByRole('button', { name: 'Save' }).click();
    await expect(editPluginDialog).toBeHidden();

    // delete basic-auth plugin
    await basicAuthPlugin.getByRole('button', { name: 'Delete' }).click();
    await expect(basicAuthPlugin).toBeHidden();

    // add real-ip plugin
    await selectPluginsBtn.click();
    await searchInput.fill('real-ip');
    await selectPluginsDialog
      .getByTestId('plugin-real-ip')
      .getByRole('button', { name: 'Add' })
      .click();
    // The redesigned editor opens in Form mode and validates on save
    // rather than surfacing ajv messages inline; switch to JSON and
    // provide the required config directly
    await addPluginDialog.locator('label:has-text("JSON")').click();
    // Re-acquire (and clear) the editor instance for this dialog — reusing
    // the previous dialog's locator leaves the example config in place
    const realIpEditor = await uiGetMonacoEditor(page, addPluginDialog);
    await uiFillMonacoEditor(
      page,
      realIpEditor,
      '{"source": "X-Forwarded-For"}'
    );
    await addPluginDialog.getByRole('button', { name: 'Add' }).click();
    await expect(addPluginDialog).toBeHidden();

    // check real-ip plugin in edit dialog
    const realIpPlugin = page.getByTestId('plugin-real-ip');
    await realIpPlugin.getByRole('button', { name: 'Edit' }).click();
    await expect(editPluginDialog).toBeVisible();
    // Switch to JSON so the saved config is rendered as text
    await editPluginDialog.locator('label:has-text("JSON")').click();
    await expect(
      editPluginDialog.locator('.monaco-editor').getByText('X-Forwarded-For').first()
    ).toBeVisible();
    await editPluginDialog.getByRole('button', { name: 'Save' }).click();
    await expect(editPluginDialog).toBeHidden();

    // Advance to Preview and submit.
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);
    await uiHasToastMsg(page, {
      hasText: 'Add Route Successfully',
    });
  });

  await test.step('open the created route and verify all fields', async () => {
    // The wizard navigates back to the list after creation
    await routesPom.isIndexPage(page);
    await page
      .getByRole('row', { name: routeNameWithAllFields })
      .getByRole('button', { name: 'Configure' })
      .click();
    await routesPom.isDetailPage(page);

    // Read-only detail wizard: API-info step holds most fields.
    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);

    const ID = page.getByRole('textbox', { name: 'ID', exact: true });
    await expect(ID).toBeVisible();
    await expect(ID).toBeDisabled();

    const name = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(name).toHaveValue(routeNameWithAllFields);
    await expect(name).toBeDisabled();

    const desc = page.getByLabel('Description').first();
    await expect(desc).toHaveValue(description);
    await expect(desc).toBeDisabled();

    const uri = page.getByLabel('URI', { exact: true });
    await expect(uri).toHaveValue(routeUri);
    await expect(uri).toBeDisabled();

    // Verify HTTP methods
    const methods = page
      .getByRole('textbox', { name: 'HTTP Methods' })
      .locator('..');
    await expect(methods).toContainText('GET');
    await expect(methods).toContainText('POST');
    await expect(methods).toContainText('PUT');
    await expect(methods).toContainText('DELETE');

    await expect(page.getByLabel('Host', { exact: true }).first()).toHaveValue(
      'example.com'
    );
    await expect(
      page.getByLabel('Remote Address', { exact: true }).first()
    ).toHaveValue('192.168.1.0/24');
    await expect(
      page.getByLabel('Priority', { exact: true }).first()
    ).toHaveValue('100');

    const status = page.getByRole('textbox', { name: 'Status', exact: true });
    await expect(status).toHaveValue('Disabled');

    // Verify Vars field
    await expect(varsSection.getByText('arg_name').first()).toBeVisible();
    await expect(varsSection.getByText('json')).toBeVisible();

    // Verify Plugins on the Plugins step.
    await uiGotoRouteStep(page, 'Plugins Config');
    await expect(page.getByText('basic-auth')).toBeHidden();
    await expect(page.getByText('real-ip')).toBeVisible();
  });

  await test.step('edit and update route in detail page', async () => {
    await page.getByRole('button', { name: 'Edit' }).click();

    // Edit mode starts at step 1.
    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
    const nameField = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(nameField).toBeEnabled();

    await page
      .getByLabel('Description')
      .first()
      .fill('Updated description for testing all fields');
    await page.getByLabel('URI', { exact: true }).fill(`${routeUri}-updated`);
    await page
      .getByLabel('Host', { exact: true })
      .first()
      .fill('updated-example.com');
    await page.getByLabel('Priority', { exact: true }).first().fill('200');

    const varsEditor = await uiGetMonacoEditor(page, varsSection);
    await uiFillMonacoEditor(page, varsEditor, updatedVars);

    // Walk to Preview (Upstream, Request Override, Plugins, Preview)
    // and submit.
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);

    await uiHasToastMsg(page, {
      hasText: 'success',
    });

    await routesPom.isDetailPage(page);

    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
    await expect(page.getByLabel('Description').first()).toHaveValue(
      'Updated description for testing all fields'
    );
    await expect(page.getByLabel('URI', { exact: true })).toHaveValue(
      `${routeUri}-updated`
    );
    await expect(page.getByLabel('Host', { exact: true }).first()).toHaveValue(
      'updated-example.com'
    );
    await expect(
      page.getByLabel('Priority', { exact: true }).first()
    ).toHaveValue('200');
    await expect(varsSection.getByText('arg_name').first()).toBeVisible();
    await expect(varsSection.getByText('updated')).toBeVisible();

    await routesPom.getRouteNavBtn(page).click();
    await routesPom.isIndexPage(page);
    const row = page.getByRole('row', { name: routeNameWithAllFields });
    await expect(row).toBeVisible();
  });

  await test.step('delete route in detail page', async () => {
    await page
      .getByRole('row', { name: routeNameWithAllFields })
      .getByRole('button', { name: 'Configure' })
      .click();
    await routesPom.isDetailPage(page);

    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Route' })
      .getByRole('button', { name: 'Delete' })
      .click();

    await routesPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Route Successfully',
    });
    await expect(
      page.getByRole('cell', { name: routeNameWithAllFields })
    ).toBeHidden();

    await page.reload();
    await routesPom.isIndexPage(page);
    await expect(
      page.getByRole('cell', { name: routeNameWithAllFields })
    ).toBeHidden();
  });
});

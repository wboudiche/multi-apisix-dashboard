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
import { expect, type Page } from '@playwright/test';

import { uiHasToastMsg } from '.';

/**
 * The route add page (and the route detail page) were redesigned into a
 * multi-step FormWizard:
 *   step 1 "Define API Information" — name, uri, methods, host, priority, vars
 *   step 2 "Define Upstream"        — UpstreamModeSelector (custom/existing/service)
 *   step 3 "Request Override"
 *   step 4 "Plugins"                — FormSectionPlugins
 *   step 5 "Preview"                — read-only summary, "Submit" lives here
 *
 * Navigation is driven by the "Next" button (per-step validation blocks
 * silently). The final step exposes "Submit". There is no "Add" button on the
 * wizard. In read-only detail mode the wizard renders tab-style step buttons
 * (one per step label) that allow free navigation; only the active step's
 * content is mounted, so any field read in detail mode must first click its
 * step tab.
 *
 * The custom-upstream node editor is the Mantine `FormItemNodes` ("Add a Node"
 * button, "Hostname or IP" / "Port" placeholders), not the old antd table.
 */

const NODE_HOST_PH = 'Hostname or IP';
const NODE_PORT_PH = 'Port';

export const ROUTE_STEP_API_INFO = 'Define API Information';
export const ROUTE_STEP_UPSTREAM = 'Define Upstream';
export const ROUTE_STEP_REQUEST_OVERRIDE = 'Request Override';
export const ROUTE_STEP_PREVIEW = 'Preview';

/** Click the wizard "Next" button to advance one step. */
export const uiRouteWizardNext = async (page: Page) => {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
};

/** Click the wizard "Submit" button on the final (Preview) step. */
export const uiRouteWizardSubmit = async (page: Page) => {
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
};

/**
 * In read-only detail mode the wizard renders one tab button per step; click
 * the tab to mount that step's fields.
 */
export const uiGotoRouteStep = async (page: Page, label: string) => {
  // Read-only mode renders plain label buttons; edit mode renders Stepper
  // buttons whose accessible name includes the number and description —
  // match on the label substring to handle both
  await page.getByRole('button', { name: label }).first().click();
};

/** Add a custom-upstream node via the Mantine node editor. */
export const uiAddRouteNode = async (page: Page, host: string, port?: number) => {
  await page.getByRole('button', { name: 'Add a Node' }).click();
  const hostInputs = page.getByPlaceholder(NODE_HOST_PH);
  const idx = (await hostInputs.count()) - 1;
  const hostInput = hostInputs.nth(idx);
  await hostInput.fill(host);
  await expect(hostInput).toHaveValue(host);
  if (port != null) {
    await page.getByPlaceholder(NODE_PORT_PH).nth(idx).fill(String(port));
  }
  // Commit changes (FormItemNodes commits on blur / click-outside).
  await page.locator('h1').first().click();
};

/** Select one or more HTTP methods from the tags input on step 1. */
export const uiSelectHttpMethods = async (page: Page, methods: string[]) => {
  // Clear the pre-selected defaults (GET/POST/PUT/DELETE) first — selected
  // methods are hidden from the dropdown, so re-selecting them hangs
  const wrapper = page
    .locator('.mantine-InputWrapper-root')
    .filter({ hasText: 'HTTP Methods' });
  const removeButtons = wrapper.locator('.mantine-Pill-remove');
  while ((await removeButtons.count()) > 0) {
    await removeButtons.first().click();
  }
  await page.getByRole('textbox', { name: 'HTTP Methods' }).click();
  for (const m of methods) {
    await page.getByRole('option', { name: m, exact: true }).click();
  }
  // Close the dropdown by clicking a neutral element (Escape would trigger
  // the wizard's go-back keyboard shortcut)
  await page.locator('h1').first().click();
};

/**
 * Add a plugin via the "Select Plugins" drawer + JSON config dialog. Works on
 * the wizard Plugins step (and on the legacy single-page plugins section).
 */
export const uiAddPluginWithJson = async (
  page: Page,
  pluginName: string,
  config: string,
  uiFillMonacoEditor: (page: Page, editor: unknown, value: string) => Promise<void>,
  uiGetMonacoEditor: (page: Page, ctx: unknown) => Promise<unknown>
) => {
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const dialog = page.getByRole('dialog', { name: 'Select Plugins' });
  await dialog.getByPlaceholder('Search').fill(pluginName);
  await dialog
    .getByTestId(`plugin-${pluginName}`)
    .getByRole('button', { name: 'Add' })
    .click();

  const addPluginDialog = page.getByRole('dialog', { name: 'Add Plugin' });
  // The editor opens in Form mode for plugins with a schema; switch to JSON
  await addPluginDialog.locator('label:has-text("JSON")').click();
  const editor = await uiGetMonacoEditor(page, addPluginDialog);
  await uiFillMonacoEditor(page, editor, config);
  await addPluginDialog.getByRole('button', { name: 'Add' }).click();
  await expect(addPluginDialog).toBeHidden();
};

/**
 * Drive the route add wizard with the minimum required fields and submit.
 * Fills name + uri + methods on step 1, adds the given custom upstream nodes on
 * step 2, then walks through Request Override + Plugins to the Preview step and
 * submits.
 */
export const uiCreateRouteWithCustomUpstream = async (
  page: Page,
  opts: {
    name: string;
    uri: string;
    methods?: string[];
    nodes: { host: string; port?: number }[];
  }
) => {
  // Step 1 — API info.
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .first()
    .fill(opts.name);
  await page.getByLabel('URI', { exact: true }).fill(opts.uri);
  if (opts.methods?.length) {
    await uiSelectHttpMethods(page, opts.methods);
  }
  await uiRouteWizardNext(page);

  // Step 2 — custom upstream nodes (custom is the default mode).
  for (const node of opts.nodes) {
    await uiAddRouteNode(page, node.host, node.port);
  }
  await uiRouteWizardNext(page);

  // Step 3 -> 4 -> 5 (Request Override / Plugins / Preview).
  await uiRouteWizardNext(page);
  await uiRouteWizardNext(page);
  await uiRouteWizardSubmit(page);
};

export async function uiDeleteRoute(page: Page) {
  // Delete the route for cleanup
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Route' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await uiHasToastMsg(page, {
    hasText: 'Delete Route Successfully',
  });
  await routesPom.isIndexPage(page);
}

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
import { expect, type Page } from '@playwright/test';

import type { APISIXType } from '@/types/schema/apisix';

import type { Test } from '../test';

/**
 * The service add page was redesigned into a multi-step FormWizard:
 *   step 1 "Basic"    — name (required), description, hosts
 *   step 2 "Upstream" — simplified FormSectionUpstream (Mantine node editor)
 *   step 3 "Plugins"
 *   step 4 "Preview"  — read-only summary, "Submit" lives here
 *
 * The service schema requires at least one upstream node (the default upstream
 * mode is "custom"), so the required-fields flow must add a node before it can
 * advance past the Upstream step. Navigation is via the "Next" button; the
 * final step exposes "Submit" (there is no "Add" button on the wizard).
 *
 * The service detail page is also a FormWizard. In read-only mode it renders
 * tab-style step buttons (labels: "Basic Information", "Upstream", "Plugin",
 * "Preview"); only the active step's content is mounted.
 */

const NODE_HOST_PH = 'Hostname or IP';
const NODE_PORT_PH = 'Port';

const nameField = (page: Page) =>
  page.getByRole('textbox', { name: 'Name', exact: true }).first();

const uiWizardNext = async (page: Page) => {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
};

/** Discard any restored draft so the wizard starts from a clean step 1. */
export const uiDiscardServiceDraftIfPresent = async (page: Page) => {
  const discardBtn = page.getByRole('button', { name: 'Discard Draft' });
  if (await discardBtn.isVisible().catch(() => false)) {
    await discardBtn.click();
    await expect(discardBtn).toBeHidden();
  }
};

/** Add an upstream node via the Mantine node editor on the Upstream step. */
export const uiAddServiceNode = async (
  page: Page,
  host: string,
  port?: number
) => {
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

/**
 * Drive the service add wizard with the required fields and stop on the Preview
 * step (the caller submits via the "Submit" button). Fills the name on step 1
 * and adds a single upstream node on step 2 (the schema requires one).
 */
export async function uiFillServiceRequiredFields(
  page: Page,
  service: Partial<APISIXType['Service']>
) {
  await uiDiscardServiceDraftIfPresent(page);

  // Step 1 — Basic.
  await nameField(page).fill(service.name);
  await expect(nameField(page)).toHaveValue(service.name);
  await uiWizardNext(page);

  // Step 2 — Upstream (custom mode requires >= 1 node).
  await uiAddServiceNode(page, '127.0.0.1', 80);
  await uiWizardNext(page);

  // Step 3 -> 4 (Plugins -> Preview).
  await uiWizardNext(page);
}

/**
 * Verify the required fields on the read-only detail wizard. In read-only mode
 * the wizard renders tab-style step buttons; the name lives on the "Basic
 * Information" step.
 */
export async function uiCheckServiceRequiredFields(
  page: Page,
  service: Partial<APISIXType['Service']>
) {
  await page
    .getByRole('button', { name: 'Basic Information', exact: true })
    .click();
  const name = nameField(page);
  await expect(name).toHaveValue(service.name);
  await expect(name).toBeDisabled();
}

/**
 * Drive the service add wizard filling all the fields the redesigned wizard
 * exposes (name, description, hosts, upstream nodes) and stop on the Preview
 * step. Labels and the WebSocket switch are no longer part of the add wizard.
 */
export async function uiFillServiceAllFields(
  test: Test,
  page: Page,
  service: Partial<APISIXType['Service']>
) {
  await test.step('step 1: basic fields', async () => {
    await uiDiscardServiceDraftIfPresent(page);
    await nameField(page).fill(service.name);
    await page.getByLabel('Description').first().fill(service.desc);

    // Hosts is a list of text inputs (FormItemHostsList).
    const hostInput = page.getByPlaceholder('e.g. api.example.com').first();
    await hostInput.fill('api.example.com');

    await uiWizardNext(page);
  });

  await test.step('step 2: upstream nodes', async () => {
    await uiAddServiceNode(page, 'service-node1.example.com', 8080);
    await uiAddServiceNode(page, 'service-node2.example.com', 8081);
    await uiWizardNext(page);
  });

  await test.step('step 3 -> preview', async () => {
    // Step 3 (Plugins) -> step 4 (Preview).
    await uiWizardNext(page);
  });
}

/**
 * Verify the all-fields service on the read-only detail wizard.
 */
export async function uiCheckServiceAllFields(
  page: Page,
  service: Partial<APISIXType['Service']>
) {
  // Step 1 — name + description (disabled) + hosts.
  await page
    .getByRole('button', { name: 'Basic Information', exact: true })
    .click();
  const name = nameField(page);
  await expect(name).toHaveValue(service.name);
  await expect(name).toBeDisabled();

  const descriptionField = page.getByLabel('Description').first();
  await expect(descriptionField).toHaveValue(service.desc);
  await expect(descriptionField).toBeDisabled();

  // In the read-only view the host stays in a (disabled) input, so check
  // its value rather than a text node
  await expect(
    page.getByPlaceholder('e.g. api.example.com').first()
  ).toHaveValue('api.example.com');

  // NOTE: the read-only Upstream step only renders the (disabled) upstream
  // reference select — inline upstream nodes are not displayed, so they
  // cannot be verified here. Creation already proves them: the wizard's
  // Upstream step refuses to advance without at least one valid node.
}

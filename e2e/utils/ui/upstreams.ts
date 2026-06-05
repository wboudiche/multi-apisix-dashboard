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
 * The upstream add/detail pages were redesigned into a multi-step FormWizard:
 *   step 1 Basic       — name, description, labels
 *   step 2 Nodes       — Mantine node editor ("Add a Node", host/port/weight)
 *   step 3 Connection  — scheme, load balancing, retries, advanced settings,
 *                        and health checks
 *   step 4 Preview     — read-only summary, the "Submit" button lives here
 *
 * Navigation is driven by the "Next" button, which runs per-step validation
 * (FormWizard.trigger) and refuses to advance while the current step is
 * invalid. The final step exposes "Submit".
 *
 * The old single-page antd form (antd table nodes, "No Data", "Delete"
 * buttons, grouped fieldsets) no longer exists — these helpers drive the new
 * DOM instead.
 *
 * Locator notes (learned from live failures):
 *  - The wizard registers a *global* Escape keydown handler that navigates one
 *    step back (or opens the cancel-confirm modal on step 0). So the Next
 *    helper must NOT press Escape — doing so silently bounces the wizard
 *    backwards and the form never advances.
 *  - The Basic-step Name field is a Mantine TextInput; locate it by its
 *    accessible role/name and take `.first()` (the read-only detail view can
 *    render extra disabled inputs).
 *  - "Type" is reused by the load-balancing select *and* both health-check
 *    selects, so any "Type" read on the Connection step must be scoped to the
 *    first (load-balancing) match.
 */

const NODE_HOST_PH = 'Hostname or IP';
const NODE_PORT_PH = 'Port';

const nameField = (page: Page) =>
  page.getByRole('textbox', { name: 'Name', exact: true }).first();

/** Discard any restored draft so the wizard starts from a clean step 1. */
async function uiDiscardDraftIfPresent(page: Page) {
  const discardBtn = page.getByRole('button', { name: 'Discard Draft' });
  if (await discardBtn.isVisible().catch(() => false)) {
    await discardBtn.click();
    await expect(discardBtn).toBeHidden();
  }
}

/**
 * Click the wizard "Next" button to advance one step.
 *
 * We intentionally do NOT press Escape here (the wizard's global Escape handler
 * would navigate backwards). Open Mantine dropdowns close on their own once an
 * option is picked, so there is nothing to dismiss before advancing.
 */
async function uiWizardNext(page: Page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
}

/** Add a node and fill its host (+ optional port) using the Mantine editor. */
async function uiAddNode(page: Page, host: string, port?: number) {
  await page.getByRole('button', { name: 'Add a Node' }).click();
  const hostInputs = page.getByPlaceholder(NODE_HOST_PH);
  const idx = (await hostInputs.count()) - 1;
  const hostInput = hostInputs.nth(idx);
  await hostInput.fill(host);
  await expect(hostInput).toHaveValue(host);
  if (port != null) {
    const portInput = page.getByPlaceholder(NODE_PORT_PH).nth(idx);
    await portInput.fill(String(port));
  }
  // Commit changes (FormItemNodes commits on blur / click-outside).
  await page.locator('h1').first().click();
}

/**
 * Fill the required fields of a new upstream via the wizard.
 * Step 1: name. Step 2: two nodes (+ exercise add/remove of a third). Then the
 * caller submits from the preview step via `getAddBtn`.
 */
export async function uiFillUpstreamRequiredFields(
  page: Page,
  upstream: Partial<APISIXType['Upstream']>
) {
  // Clear any restored draft so the form starts empty.
  await uiDiscardDraftIfPresent(page);

  // Step 1 — Basic
  await nameField(page).fill(upstream.name);
  await expect(nameField(page)).toHaveValue(upstream.name);
  await uiWizardNext(page);

  // Step 2 — Nodes (tests always pass the array form of nodes).
  const nodes = (upstream.nodes ?? []) as APISIXType['UpstreamNode'][];
  const addNodeBtn = page.getByRole('button', { name: 'Add a Node' });
  await expect(addNodeBtn).toBeVisible();

  // Add the two required nodes.
  await uiAddNode(page, nodes[1].host);
  await uiAddNode(page, nodes[0].host);

  // Add a third node, then remove it again to exercise deletion. The remove
  // control is the ActionIcon (a button) whose only text is a literal "-" at
  // the end of each node row.
  await addNodeBtn.click();
  let hosts = page.getByPlaceholder(NODE_HOST_PH);
  await expect(hosts).toHaveCount(3);
  const removeButtons = page.getByRole('button').filter({ hasText: /^\s*-\s*$/ });
  await removeButtons.last().click();
  hosts = page.getByPlaceholder(NODE_HOST_PH);
  await expect(hosts).toHaveCount(2);

  // Advance through Connection (defaults are valid) to the Preview step.
  await uiWizardNext(page);
  await uiWizardNext(page);
}

/**
 * Verify the required fields on the read-only detail wizard. In read-only mode
 * the wizard renders tab-style step buttons that allow free navigation.
 */
export async function uiCheckUpstreamRequiredFields(
  page: Page,
  upstream: Partial<APISIXType['Upstream']>
) {
  // Step 1 — name (read-only / disabled).
  const name = nameField(page);
  await expect(name).toHaveValue(upstream.name);
  await expect(name).toBeDisabled();

  // Step 2 — nodes. Click the "Nodes" tab, then assert each host input value.
  // The tests always pass node arrays (never the object form).
  const nodes = (upstream.nodes ?? []) as APISIXType['UpstreamNode'][];
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  const hosts = page.getByPlaceholder(NODE_HOST_PH);
  await expect(hosts).toHaveCount(nodes.length);
  const values = await hosts.evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value)
  );
  for (const node of nodes) {
    expect(values).toContain(node.host);
  }
}

/**
 * Fill all the upstream fields the new wizard renders. Compared to the old
 * single-page form, several fields were dropped or collapsed; assertions for
 * fields that no longer exist have been trimmed (see comments).
 */
export async function uiFillUpstreamAllFields(
  test: Test,
  page: Page,
  upstream: Partial<APISIXType['Upstream']>
) {
  await test.step('step 1: basic info', async () => {
    await uiDiscardDraftIfPresent(page);
    await nameField(page).fill(upstream.name);
    await expect(nameField(page)).toHaveValue(upstream.name);
    await page.getByLabel('Description').first().fill(upstream.desc);
    await uiWizardNext(page);
  });

  await test.step('step 2: nodes', async () => {
    await uiAddNode(page, 'node1.example.com', 8080);
    await uiAddNode(page, 'node2.example.com', 8081);
    await uiWizardNext(page);
  });

  await test.step('step 3: connection', async () => {
    // Scheme select (Mantine). Pick https.
    await page.getByLabel('Scheme').first().click();
    await page.getByRole('option', { name: 'https', exact: true }).click();

    // Load balancing Type -> chash exposes Hash On + Key. Scope to the first
    // "Type" (the health-check sections also expose "Type" selects, but those
    // only render once their checks are enabled — still, stay defensive).
    await page.getByLabel('Type', { exact: true }).first().click();
    await page.getByRole('option', { name: 'chash', exact: true }).click();

    await page.getByLabel('Hash On', { exact: true }).first().click();
    await page.getByRole('option', { name: 'header', exact: true }).click();

    await page.getByLabel('Key', { exact: true }).first().fill('X-Custom-Header');

    // Retries and timeout / keepalive / TLS are collapsed behind the
    // Advanced Settings toggle; expand it before filling them.
    await page
      .getByText('Advanced Settings', { exact: false })
      .first()
      .click();

    // Retries.
    await page.getByLabel('Retries').first().fill('5');

    await page.getByLabel('Connect', { exact: true }).first().fill('3');
    await page.getByLabel('Send', { exact: true }).first().fill('3');
    await page.getByLabel('Read', { exact: true }).first().fill('3');

    // Health checks: enable active + passive via their Mantine switches.
    await page.getByTestId('checksEnabled').locator('..').click();
    await page.getByTestId('checksPassiveEnabled').locator('..').click();

    await uiWizardNext(page);
  });

  // Now on the Preview step — caller submits via getAddBtn.
}

/**
 * Verify the all-fields upstream on the read-only detail wizard. Read-only mode
 * renders tab-style step buttons; we click through them and assert the values
 * that survive the round-trip. Fields the redesigned form no longer surfaces in
 * the detail view (priority columns, retry-timeout suffix formatting, the old
 * grouped Pass Host / Keepalive fieldsets, granular health-check value reads)
 * are intentionally not asserted here.
 */
export async function uiCheckUpstreamAllFields(
  page: Page,
  upstream: Partial<APISIXType['Upstream']>
) {
  // Step 1 — name + description (disabled).
  const name = nameField(page);
  await expect(name).toHaveValue(upstream.name);
  await expect(name).toBeDisabled();

  const description = page.getByLabel('Description').first();
  await expect(description).toHaveValue(upstream.desc);
  await expect(description).toBeDisabled();

  // Step 2 — nodes.
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  const hosts = page.getByPlaceholder(NODE_HOST_PH);
  const hostValues = await hosts.evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value)
  );
  expect(hostValues).toContain('node1.example.com');
  expect(hostValues).toContain('node2.example.com');

  // Step 3 — connection. Scheme + load balancing type survive the round-trip.
  // Health-check sections also render a "Type" select, so scope to the first
  // (load balancing) one.
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByLabel('Scheme').first()).toHaveValue('https');
  await expect(page.getByLabel('Type', { exact: true }).first()).toHaveValue(
    'chash'
  );

  // Step 4 — preview summary surfaces the chosen scheme/algorithm as badges.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('https').first()).toBeVisible();
}

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
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  ROUTE_STEP_API_INFO,
  uiCreateRouteWithCustomUpstream,
  uiGotoRouteStep,
  uiRouteWizardNext,
  uiRouteWizardSubmit,
} from '@e2e/utils/ui/routes';
import { expect } from '@playwright/test';

import { deleteAllRoutes } from '@/apis/routes';

const routeName = randomId('test-route');
const routeUri = '/test-route';

test.beforeAll(async () => {
  await deleteAllRoutes(e2eReq);
});

test('should CRUD route with required fields', async ({ page }) => {
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);

  await routesPom.getAddRouteBtn(page).click();
  await routesPom.isAddPage(page);

  await test.step('cannot advance past upstream step without a node', async () => {
    // The add page pre-fills uri "/*" and methods, but the custom upstream
    // starts with 0 nodes. Step 1 -> 2 succeeds; step 2 -> 3 is blocked
    // silently until a node is added (the wizard stays on the Upstream step).
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(routeName);
    await page.getByLabel('URI', { exact: true }).fill(routeUri);
    await uiRouteWizardNext(page);

    // On the Upstream step, advancing without a node keeps us here.
    await uiRouteWizardNext(page);
    await expect(
      page.getByRole('button', { name: 'Add a Node' })
    ).toBeVisible();
  });

  await test.step('submit with required fields', async () => {
    // Restart from a clean add page to use the shared create helper.
    await routesPom.toIndex(page);
    await page.evaluate(() => localStorage.removeItem('apisix-route-draft'));
    await routesPom.getAddRouteBtn(page).click();
    await routesPom.isAddPage(page);

    await uiCreateRouteWithCustomUpstream(page, {
      name: routeName,
      uri: routeUri,
      methods: ['GET'],
      nodes: [
        { host: 'test.com', port: 80 },
        { host: 'test2.com', port: 80 },
      ],
    });

    await uiHasToastMsg(page, {
      hasText: 'Add Route Successfully',
    });
  });

  await test.step('open the created route from the list', async () => {
    // The wizard navigates back to the routes list after creation;
    // open the detail page via the row Configure action
    await routesPom.isIndexPage(page);
    await page
      .getByRole('row', { name: routeName })
      .getByRole('button', { name: 'Configure' })
      .click();
    await routesPom.isDetailPage(page);

    // Step 1 of the read-only detail wizard exposes ID / Name / URI.
    const ID = page.getByRole('textbox', { name: 'ID', exact: true });
    await expect(ID).toBeVisible();
    await expect(ID).toBeDisabled();

    const name = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(name).toHaveValue(routeName);
    await expect(name).toBeDisabled();

    const uri = page.getByLabel('URI', { exact: true });
    await expect(uri).toHaveValue(routeUri);
    await expect(uri).toBeDisabled();
  });

  await test.step('edit and update route in detail page', async () => {
    // Enter edit mode (wizard becomes editable, starting at step 1).
    await page.getByRole('button', { name: 'Edit' }).click();

    const nameField = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(nameField).toBeEnabled();

    // Update fields on the API-info step.
    await page.getByLabel('Description').first().fill('Updated description for testing');
    await page.getByLabel('URI', { exact: true }).fill(`${routeUri}-updated`);

    // Walk to the Preview step (4 hops: Upstream, Request Override,
    // Plugins, Preview) and submit the edit.
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);

    await uiHasToastMsg(page, {
      hasText: 'success',
    });

    await routesPom.isDetailPage(page);

    // Verify the updated fields on the read-only API-info step.
    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
    await expect(page.getByLabel('Description').first()).toHaveValue(
      'Updated description for testing'
    );
    await expect(page.getByLabel('URI', { exact: true })).toHaveValue(
      `${routeUri}-updated`
    );

    await routesPom.getRouteNavBtn(page).click();
    await routesPom.isIndexPage(page);
    const row = page.getByRole('row', { name: routeName });
    await expect(row).toBeVisible();
  });

  await test.step('route should exist in list page', async () => {
    await routesPom.getRouteNavBtn(page).click();
    await routesPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: routeName })).toBeVisible();

    await page
      .getByRole('row', { name: routeName })
      .getByRole('button', { name: 'Configure' })
      .click();
    await routesPom.isDetailPage(page);
  });

  await test.step('delete route in detail page', async () => {
    await page.getByRole('button', { name: 'Delete' }).click();

    await page
      .getByRole('dialog', { name: 'Delete Route' })
      .getByRole('button', { name: 'Delete' })
      .click();

    await routesPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Route Successfully',
    });
    await expect(page.getByRole('cell', { name: routeName })).toBeHidden();
  });
});

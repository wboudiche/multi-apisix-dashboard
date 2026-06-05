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
import { servicesPom } from '@e2e/pom/services';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  ROUTE_STEP_API_INFO,
  ROUTE_STEP_UPSTREAM,
  uiGotoRouteStep,
  uiRouteWizardNext,
  uiRouteWizardSubmit,
  uiSelectHttpMethods,
} from '@e2e/utils/ui/routes';
import { expect } from '@playwright/test';

import { deleteAllRoutes } from '@/apis/routes';
import { deleteAllServices, postServiceReq } from '@/apis/services';

test.describe.configure({ mode: 'serial' });

const serviceName = randomId('test-service');
const routeName = randomId('test-route');
const routeUri = '/test-route';

let testServiceId: string;

test.beforeAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);

  // Create a test service for testing service routes
  const serviceResponse = await postServiceReq(e2eReq, {
    name: serviceName,
    desc: 'Test service for route testing',
  });

  testServiceId = serviceResponse.data.value.id;
});

test.afterAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
});

test('should CRUD route under service with required fields', async ({
  page,
}) => {
  // Navigate to service detail page
  await servicesPom.toIndex(page);
  await servicesPom.isIndexPage(page);

  await page
    .getByRole('row', { name: serviceName })
    .getByRole('button', { name: 'View' })
    .click();
  await servicesPom.isDetailPage(page);

  // The service detail page has no tabs; navigate to the nested routes page
  const serviceId = page.url().split('/detail/')[1].split('/')[0];
  await servicesPom.toServiceRoutes(page, serviceId);
  await servicesPom.isServiceRoutesPage(page);

  // The nested routes list has no toolbar; navigate to the add page directly
  await servicesPom.toServiceRouteAdd(page, serviceId);
  await servicesPom.isServiceRouteAddPage(page);

  await test.step('cannot advance past API-info step without required fields', async () => {
    // The nested route add page does not pre-fill uri/methods; clicking Next
    // with an empty uri keeps the wizard on the API-info step.
    await uiRouteWizardNext(page);
    await expect(page.getByLabel('URI', { exact: true })).toBeVisible();
  });

  await test.step('submit with required fields', async () => {
    // Step 1 — API info.
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(routeName);
    await page.getByLabel('URI', { exact: true }).fill(routeUri);
    await uiSelectHttpMethods(page, ['GET']);
    await uiRouteWizardNext(page);

    // Step 2 — Upstream. The route is bound to the service (service mode is
    // pre-selected from the service_id default), so the Service select shows the
    // bound service. The Mantine Select displays the service name, not the id.
    await expect(page.getByRole('textbox', { name: 'Service', exact: true })).toHaveValue(
      serviceName
    );

    // Walk to Preview (Request Override -> Plugins -> Preview) and submit.
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);
    await uiHasToastMsg(page, {
      hasText: 'Add Route Successfully',
    });
  });

  await test.step('auto navigate to route detail page', async () => {
    await servicesPom.isServiceRouteDetailPage(page);

    // API-info step holds ID / Name / URI.
    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
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

    // Service binding lives on the Upstream step (FormSectionService). The
    // Mantine Select displays the service name.
    await uiGotoRouteStep(page, ROUTE_STEP_UPSTREAM);
    await expect(page.getByRole('textbox', { name: 'Service', exact: true })).toHaveValue(
      serviceName
    );
  });

  await test.step('edit and update route in detail page', async () => {
    await page.getByRole('button', { name: 'Edit' }).click();

    // Edit mode; update fields on the API-info step.
    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
    const nameField = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(nameField).toBeEnabled();

    await page
      .getByLabel('Description')
      .first()
      .fill('Updated description for testing');
    await page.getByLabel('URI', { exact: true }).fill(`${routeUri}-updated`);

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

    await servicesPom.isServiceRouteDetailPage(page);

    await uiGotoRouteStep(page, ROUTE_STEP_API_INFO);
    await expect(page.getByLabel('Description').first()).toHaveValue(
      'Updated description for testing'
    );
    await expect(page.getByLabel('URI', { exact: true })).toHaveValue(
      `${routeUri}-updated`
    );
  });

  await test.step('route should exist in service routes list', async () => {
    await servicesPom.toServiceRoutes(page, testServiceId);
    await servicesPom.isServiceRoutesPage(page);

    await expect(page.getByRole('cell', { name: routeName })).toBeVisible();

    await page
      .getByRole('row', { name: routeName })
      .getByRole('button', { name: 'Configure' })
      .click();
    // Configure opens the global route detail page
    await routesPom.isDetailPage(page);
  });

  await test.step('delete route in detail page', async () => {
    await page.getByRole('button', { name: 'Delete' }).click();

    await page
      .getByRole('dialog', { name: 'Delete Route' })
      .getByRole('button', { name: 'Delete' })
      .click();

    // Deleting from the global detail page redirects to the global list
    await routesPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Route Successfully',
    });

    // The route is gone from the nested service routes list too
    await servicesPom.toServiceRoutes(page, serviceId);
    await servicesPom.isServiceRoutesPage(page);
    await expect(page.getByRole('cell', { name: routeName })).toBeHidden();
  });
});

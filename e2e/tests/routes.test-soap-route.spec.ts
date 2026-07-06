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
import { env } from '@e2e/utils/env';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Locator, type Page } from '@playwright/test';

import { postRouteReq } from '@/apis/routes';
import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';
import { SOAP_ACTION_VAR } from '@/utils/soap-route';

// The exact SOAPAction value a WSDL per-operation import stores in the route's
// `vars` — kept quoted because that is what a SOAP 1.1 client sends and thus
// what APISIX compares against.
const SOAP_ACTION = '"urn:GetInvoice"';
const inlineUpstream: APISIXType['Upstream'] = {
  type: 'roundrobin',
  nodes: { 'example.com:80': 1 },
};

const routesUrl = (query = '') =>
  `${env.E2E_TARGET_URL.replace(/\/$/, '')}/routes${query}`;

// Only the routes this spec creates are cleaned up — deleting every route
// would clobber other specs running against the same instance in parallel.
const createdRouteIds: string[] = [];

// The route payload here carries an array-shaped `vars` (what APISIX wants),
// whereas postRouteReq is typed for the form's serialized string; cast at the
// boundary rather than reshaping the test data.
const createRoute = async (data: Partial<APISIXType['Route']>) => {
  const res = await postRouteReq(
    e2eReq,
    data as unknown as Parameters<typeof postRouteReq>[1]
  );
  createdRouteIds.push(res.data.value.id);
};

// Open the Test Route drawer for a route already visible in the list, without
// reloading — so the persistently mounted drawer is reused across opens.
const openTestRouteFor = async (page: Page, routeName: string) => {
  const row = routesPom.rowByName(page, routeName);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Test Route' }).click();
  return page.locator('.mantine-Drawer-content');
};

// Navigate to the list filtered to a single route, then open its Test Route
// drawer. The name filter keeps the row on the first page regardless of how
// many other routes exist.
const openTestDrawer = async (page: Page, routeName: string) => {
  await page.goto(routesUrl(`?name=${routeName}`));
  await routesPom.isIndexPage(page);
  return openTestRouteFor(page, routeName);
};

// Current values of every input in the drawer (header key/value fields render
// as controlled inputs, so the seeded values live on the value property).
const drawerInputValues = (drawer: Locator): Promise<string[]> =>
  drawer
    .locator('input')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.afterAll(async () => {
  await Promise.all(
    createdRouteIds.map((id) =>
      e2eReq.delete(`${API_ROUTES}/${id}`).catch(() => undefined)
    )
  );
});

test('Route seeds the SOAPAction header for a per-operation SOAP route', async ({
  page,
}) => {
  const routeName = randomId('soap-op-route');
  await createRoute({
    name: routeName,
    uri: '/services/Billing',
    methods: ['POST'],
    vars: [[SOAP_ACTION_VAR, '==', SOAP_ACTION]],
    upstream: inlineUpstream,
  });

  const drawer = await openTestDrawer(page, routeName);

  // The routing discriminator is pre-filled as a request header, and the JSON
  // default content type is switched to SOAP 1.1's text/xml.
  await expect
    .poll(() => drawerInputValues(drawer))
    .toEqual(expect.arrayContaining(['SOAPAction', SOAP_ACTION, 'text/xml']));
});

test('Route leaves a non-SOAP route untouched', async ({ page }) => {
  const routeName = randomId('plain-route');
  await createRoute({
    name: routeName,
    uri: `/${routeName}`,
    methods: ['GET'],
    upstream: inlineUpstream,
  });

  const drawer = await openTestDrawer(page, routeName);

  // No SOAPAction header is added, and the default JSON content type stays.
  await expect
    .poll(() => drawerInputValues(drawer))
    .toContain('application/json');
  expect(await drawerInputValues(drawer)).not.toContain('SOAPAction');
});

test('reopening the drawer for a non-SOAP route clears seeded SOAP headers', async ({
  page,
}) => {
  const soapName = randomId('soap-seq-route');
  const plainName = randomId('plain-seq-route');
  await createRoute({
    name: soapName,
    uri: '/services/Billing',
    methods: ['POST'],
    vars: [[SOAP_ACTION_VAR, '==', SOAP_ACTION]],
    upstream: inlineUpstream,
  });
  await createRoute({
    name: plainName,
    uri: `/${plainName}`,
    methods: ['GET'],
    upstream: inlineUpstream,
  });

  // Load both routes on one page so the drawer is opened twice without a
  // reload — exercising the reuse of the persistently mounted component.
  await page.goto(routesUrl('?page=1&page_size=100'));
  await routesPom.isIndexPage(page);

  const drawer = await openTestRouteFor(page, soapName);
  await expect(drawer).toBeVisible();
  await expect
    .poll(() => drawerInputValues(drawer))
    .toContain('SOAPAction');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Reopening for a plain route must not carry the SOAP route's headers over.
  await openTestRouteFor(page, plainName);
  await expect(drawer).toBeVisible();
  await expect
    .poll(() => drawerInputValues(drawer))
    .toContain('application/json');
  const values = await drawerInputValues(drawer);
  expect(values).not.toContain('SOAPAction');
  expect(values).not.toContain('text/xml');
});

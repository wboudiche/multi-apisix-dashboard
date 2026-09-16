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
import { servicesPom } from '@e2e/pom/services';
import { deleteByPrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { uiRouteWizardNext, uiRouteWizardSubmit } from '@e2e/utils/ui/routes';
import { expect, type Page } from '@playwright/test';

import { postRouteReq } from '@/apis/routes';
import { postServiceReq } from '@/apis/services';
import { API_ROUTES, API_SERVICES, API_STREAM_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * The route and stream route pages under a service set service_id and mark it
 * read-only. FormSectionService asked FormSection to disable the Service
 * select, but FormSection passed `disabled` to a Paper, where it did nothing:
 * the select could still be cleared or changed there (#233).
 */

// The tests share one service and edit what beforeAll seeded, so they run in
// order rather than seeding a service each.
test.describe.configure({ mode: 'serial' });

const prefix = randomId('e2e_ro_svc');
const serviceName = `${prefix}_service`;
const routeName = `${prefix}_route`;
let serviceId: string;
let routeId: string;
let streamRouteId: string;
// The stream route add page asks for confirmation when another stream route
// anywhere on the instance matches the same traffic, so each one here matches
// its own.
const serverPort = 20000 + Math.floor(Math.random() * 40000);

type List<T> = { data: { list: { value: T }[] } };

/** The Service select shows the page's service, and cannot be changed or cleared. */
const expectServiceFrozen = async (page: Page) => {
  const service = page.getByRole('textbox', { name: 'Service', exact: true });
  await expect(service).toHaveValue(serviceName);
  await expect(service).toBeDisabled();
  // A field that holds no button, rather than a wrapper that matched nothing.
  const field = page.locator('.mantine-InputWrapper-root').filter({ has: service });
  await expect(field).toHaveCount(1);
  await expect(field.locator('button')).toHaveCount(0);
};

const storedRoute = async (id: string) => {
  const res = await e2eReq.get<unknown, List<APISIXType['Route']>>(API_ROUTES);
  return res.data.list.find((r) => r.value.id === id)?.value;
};

const storedStreamRoute = async (id: string) => {
  const res = await e2eReq.get<unknown, List<APISIXType['StreamRoute']>>(API_STREAM_ROUTES);
  return res.data.list.find((r) => r.value.id === id)?.value;
};

test.beforeAll(async () => {
  serviceId = (await postServiceReq(e2eReq, { name: serviceName })).data.value.id;
  const route = await postRouteReq(e2eReq, {
    name: routeName,
    uri: `/${routeName}`,
    methods: ['GET'],
    service_id: serviceId,
  });
  routeId = route.data.value.id;
  const streamRoute = await e2eReq.post<unknown, { data: { value: { id: string } } }>(
    API_STREAM_ROUTES,
    { service_id: serviceId, server_addr: '127.0.0.1', server_port: serverPort }
  );
  streamRouteId = streamRoute.data.value.id;
});

test.afterAll(async () => {
  await deleteByPrefix(API_ROUTES, 'name', prefix);
  await deleteByPrefix(API_STREAM_ROUTES, 'service_id', serviceId);
  await deleteByPrefix(API_SERVICES, 'name', prefix);
});

test('a route edited on its service page keeps that service', async ({ page }) => {
  await page.goto(`services/detail/${serviceId}/routes/detail/${routeId}`);
  await servicesPom.isServiceRouteDetailPage(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Description').first().fill('edited on the service page');

  // Edit mode opens on the API information step; the Service select is on the next.
  await uiRouteWizardNext(page);
  await expectServiceFrozen(page);

  // Walk to Preview (Request Override -> Plugins -> Preview) and save.
  await uiRouteWizardNext(page);
  await uiRouteWizardNext(page);
  await uiRouteWizardNext(page);
  await uiRouteWizardSubmit(page);
  await uiHasToastMsg(page, { hasText: 'success' });

  const route = await storedRoute(routeId);
  expect(route?.desc).toBe('edited on the service page');
  expect(route?.service_id).toBe(serviceId);
});

test('a stream route added on a service page keeps to that service', async ({ page }) => {
  await servicesPom.toServiceStreamRouteAdd(page, serviceId);
  await servicesPom.isServiceStreamRouteAddPage(page);
  await expectServiceFrozen(page);
  await page.getByLabel('Server Address', { exact: true }).fill('127.0.0.3');
  await page.getByLabel('Server Port', { exact: true }).fill(String(serverPort));

  await servicesPom.getAddBtn(page).click();
  await uiHasToastMsg(page, { hasText: 'Add Stream Route Successfully' });
  await servicesPom.isServiceStreamRouteDetailPage(page);

  const createdId = page.url().split('/stream_routes/detail/')[1];
  const streamRoute = await storedStreamRoute(createdId);
  expect(streamRoute?.server_addr).toBe('127.0.0.3');
  expect(streamRoute?.service_id).toBe(serviceId);
});

test('a stream route edited on its service page keeps that service', async ({ page }) => {
  await page.goto(`services/detail/${serviceId}/stream_routes/detail/${streamRouteId}`);
  await servicesPom.isServiceStreamRouteDetailPage(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Server Address', { exact: true }).fill('127.0.0.2');
  await expectServiceFrozen(page);

  await page.getByRole('button', { name: 'Save' }).click();
  await uiHasToastMsg(page, { hasText: 'success' });

  const streamRoute = await storedStreamRoute(streamRouteId);
  expect(streamRoute?.server_addr).toBe('127.0.0.2');
  expect(streamRoute?.service_id).toBe(serviceId);
});

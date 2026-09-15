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
import {
  uiRouteWizardNext,
  uiRouteWizardSubmit,
  uiSelectHttpMethods,
} from '@e2e/utils/ui/routes';
import { expect } from '@playwright/test';

import { postServiceReq } from '@/apis/services';
import { API_ROUTES, API_SERVICES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * A service's route add page is for a route of that service: the page sets
 * service_id and does not let it change. Picking a custom or an existing
 * upstream there used to clear it, and the route was created outside the
 * service, from the service's own page (#231).
 */

const serviceName = randomId('e2e_fixed_svc');
const routeName = randomId('e2e_fixed_svc_route');
let serviceId: string;

const draftKey = () => `apisix-route-draft:service:${serviceId}`;

test.beforeAll(async () => {
  const res = await postServiceReq(e2eReq, { name: serviceName });
  serviceId = res.data.value.id;
});

test.afterEach(async ({ page }) => {
  await page.evaluate((key) => localStorage.removeItem(key), draftKey());
});

test.afterAll(async () => {
  await deleteByPrefix(API_ROUTES, 'name', routeName);
  await deleteByPrefix(API_SERVICES, 'name', serviceName);
});

test('a route added on a service page keeps to that service', async ({ page }) => {
  await servicesPom.toServiceRouteAdd(page, serviceId);
  await servicesPom.isServiceRouteAddPage(page);
  await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill(routeName);
  await page.getByLabel('URI', { exact: true }).fill(`/${routeName}`);
  await uiSelectHttpMethods(page, ['GET']);
  await uiRouteWizardNext(page);

  // The service is the page's, and it provides the upstream.
  await expect(page.getByRole('button', { name: 'Custom Upstream' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use Existing Upstream' })).toBeDisabled();
  await expect(
    page.getByText('Routes added here belong to this service, which provides their upstream')
  ).toBeVisible();
  const service = page.getByRole('textbox', { name: 'Service', exact: true });
  await expect(service).toHaveValue(serviceName);
  await expect(service).toBeDisabled();
  // Nor does the select offer to clear it.
  await expect(
    page.locator('.mantine-InputWrapper-root').filter({ has: service }).locator('button')
  ).toHaveCount(0);

  // Walk to Preview (Request Override -> Plugins -> Preview) and submit.
  await uiRouteWizardNext(page);
  await uiRouteWizardNext(page);
  await uiRouteWizardNext(page);
  await uiRouteWizardSubmit(page);
  await uiHasToastMsg(page, { hasText: 'Add Route Successfully' });

  const res = await e2eReq.get<unknown, { data: { list: { value: APISIXType['Route'] }[] } }>(
    API_ROUTES
  );
  const route = res.data.list.find((r) => r.value.name === routeName)?.value;
  expect(route?.service_id).toBe(serviceId);
});

test('a draft that lost the service is not restored on its page', async ({ page }) => {
  // What the page saved once another upstream mode had cleared service_id.
  const draft = {
    name: `${routeName}_draft`,
    uri: '/draft',
    methods: ['GET'],
    upstream_id: 'custom',
    upstream: {
      type: 'roundrobin',
      scheme: 'http',
      nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }],
    },
  };
  await servicesPom.toServiceRouteAdd(page, serviceId);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    draftKey(),
    JSON.stringify(draft),
  ] as const);
  await page.reload();
  await servicesPom.isServiceRouteAddPage(page);

  await expect(page.locator('input[name="name"]')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Discard Draft' })).toBeHidden();
});

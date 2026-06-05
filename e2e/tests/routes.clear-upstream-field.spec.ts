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
/* eslint-disable playwright/expect-expect -- assertions live in the
   verifyRouteData / uiHasToastMsg helpers */
import { routesPom } from '@e2e/pom/routes';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  uiRouteWizardNext,
  uiRouteWizardSubmit,
} from '@e2e/utils/ui/routes';
import { expect, type Page } from '@playwright/test';

import { deleteAllRoutes } from '@/apis/routes';
import { deleteAllServices, postServiceReq } from '@/apis/services';
import { deleteAllUpstreams, postUpstreamReq } from '@/apis/upstreams';
import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

const upstreamName = randomId('test-upstream');
const serviceName = randomId('test-service');
const routeNameForUpstreamId = randomId('test-route-upstream-id');
const routeNameForServiceId = randomId('test-route-service-id');
const routeUri1 = '/test-route-upstream-id';
const routeUri2 = '/test-route-service-id';

const upstreamNodes: APISIXType['UpstreamNode'][] = [
  { host: 'test.com', port: 80, weight: 100 },
  { host: 'test2.com', port: 80, weight: 100 },
];

let testUpstreamId: string;
let testServiceId: string;

/**
 * The redesigned route add page uses a multi-step FormWizard with an
 * UpstreamModeSelector on step 2. Picking an existing upstream or binding a
 * service is mutually exclusive with the inline custom upstream, so the UI can
 * no longer submit *both* an inline upstream and an upstream_id at once. These
 * tests therefore assert the simpler invariant the redesign guarantees: when an
 * existing upstream / service is selected, the persisted route carries the id
 * and no inline `upstream` object.
 */

// Pick a mode card on the Upstream step by its title.
async function selectUpstreamMode(page: Page, title: string) {
  await page.getByText(title, { exact: true }).click();
}

// Pick a value in a Mantine searchable select by its visible label.
async function selectOption(page: Page, label: string) {
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function fillBasicRouteFields(
  page: Page,
  routeName: string,
  routeUri: string
) {
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .first()
    .fill(routeName);
  await page.getByLabel('URI', { exact: true }).fill(routeUri);
  // The add page pre-fills HTTP methods (GET/POST/PUT/DELETE), so no method
  // selection is needed here.
}

async function verifyRouteData(
  page: Page,
  routeName: string,
  expectedIdField: 'upstream_id' | 'service_id',
  expectedIdValue: string
) {
  // The wizard navigates back to the routes list after creation; resolve
  // the created route through the Admin API by its unique name
  await routesPom.isIndexPage(page);

  const res = await e2eReq.get<unknown, { data: { list: { value: APISIXType['Route'] }[] } }>(API_ROUTES);
  const match = res.data.list.find((r) => r.value.name === routeName);
  expect(match).toBeDefined();

  const routeData = match!.value;
  expect(routeData[expectedIdField]).toBe(expectedIdValue);
  expect(routeData.upstream).toBeUndefined();
}

test.beforeAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
  await deleteAllUpstreams(e2eReq);

  const upstreamResponse = await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: upstreamNodes,
  });
  testUpstreamId = upstreamResponse.data.value.id;

  const serviceResponse = await postServiceReq(e2eReq, {
    name: serviceName,
    desc: 'Test service for route upstream field clearing',
  });
  testServiceId = serviceResponse.data.value.id;
});

test.afterAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
  await deleteAllUpstreams(e2eReq);
});

test('selecting an existing upstream stores upstream_id without inline upstream', async ({
  page,
}) => {
  await routesPom.toAdd(page);
  await routesPom.isAddPage(page);

  await test.step('create route bound to an existing upstream', async () => {
    await fillBasicRouteFields(page, routeNameForUpstreamId, routeUri1);
    await uiRouteWizardNext(page);

    // Step 2: switch to "existing upstream" mode and pick the upstream.
    await selectUpstreamMode(page, 'Use Existing Upstream');
    await page.getByRole('textbox', { name: 'Upstream', exact: true }).click();
    await selectOption(page, upstreamName);

    // Walk to Preview (Request Override -> Plugins -> Preview) and submit.
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);
    await uiHasToastMsg(page, {
      hasText: 'Add Route Successfully',
    });
  });

  await test.step('verify upstream_id persisted and inline upstream cleared', async () => {
    await verifyRouteData(page, routeNameForUpstreamId, 'upstream_id', testUpstreamId);
  });
});

test('binding a service stores service_id without inline upstream', async ({
  page,
}) => {
  await routesPom.toAdd(page);
  await routesPom.isAddPage(page);

  await test.step('create route bound to a service', async () => {
    await fillBasicRouteFields(page, routeNameForServiceId, routeUri2);
    await uiRouteWizardNext(page);

    // Step 2: switch to "bind to service" mode and pick the service.
    await selectUpstreamMode(page, 'Bind to Service');
    await page.getByRole('textbox', { name: 'Service', exact: true }).click();
    await selectOption(page, serviceName);

    // Walk to Preview (Request Override -> Plugins -> Preview) and submit.
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardNext(page);
    await uiRouteWizardSubmit(page);
    await uiHasToastMsg(page, {
      hasText: 'Add Route Successfully',
    });
  });

  await test.step('verify service_id persisted and inline upstream cleared', async () => {
    await verifyRouteData(page, routeNameForServiceId, 'service_id', testServiceId);
  });
});

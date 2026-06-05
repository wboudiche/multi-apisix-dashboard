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
import { upstreamsPom } from '@e2e/pom/upstreams';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillMonacoEditor,
  uiGetMonacoEditor,
  uiHasToastMsg,
} from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

import { deleteAllRoutes, getRouteReq } from '@/apis/routes';
import { deleteAllServices, getServiceReq } from '@/apis/services';
import { deleteAllUpstreams, getUpstreamReq } from '@/apis/upstreams';
import {
  API_ROUTES,
  API_SERVICES,
  API_UPSTREAMS,
} from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

test.afterAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
  await deleteAllUpstreams(e2eReq);
});

/**
 * The add pages are multi-step FormWizards (Next per step, Submit on the
 * Preview step, navigation back to the list after creation), so each
 * creation drives its wizard and captures the created id from the POST
 * response. Cross-references (service -> upstream, route -> service) are
 * verified through the Admin API, which is what the chain is about.
 */

const wizardNext = (page: Page) =>
  page.getByRole('button', { name: 'Next', exact: true }).click();
const wizardSubmit = (page: Page) =>
  page.getByRole('button', { name: 'Submit', exact: true }).click();

const addPluginWithJson = async (
  page: Page,
  pluginName: string,
  config: string
) => {
  await page.getByRole('button', { name: 'Select Plugins' }).click();
  const selectPluginsDialog = page.getByRole('dialog', {
    name: 'Select Plugins',
  });
  await selectPluginsDialog.getByPlaceholder('Search').fill(pluginName);
  await selectPluginsDialog
    .getByTestId(`plugin-${pluginName}`)
    .getByRole('button', { name: 'Add' })
    .click();

  const addPluginDialog = page.getByRole('dialog', { name: 'Add Plugin' });
  // The editor opens in Form mode for plugins with a schema; switch to JSON
  await addPluginDialog.locator('label:has-text("JSON")').click();
  const pluginEditor = await uiGetMonacoEditor(page, addPluginDialog);
  await uiFillMonacoEditor(page, pluginEditor, config);
  await addPluginDialog.getByRole('button', { name: 'Add' }).click();
  await expect(addPluginDialog).toBeHidden();
};

test('can create upstream -> service -> route', async ({ page }) => {
  test.slow();

  const upstream: Partial<APISIXType['Upstream']> = {
    id: undefined,
    name: randomId('HTTPBIN Server'),
    scheme: 'https',
    nodes: [{ host: 'httpbin.org', port: 443, weight: 100 }],
  };

  await test.step('create upstream', async () => {
    await upstreamsPom.toIndex(page);
    await upstreamsPom.isIndexPage(page);
    await upstreamsPom.getAddUpstreamBtn(page).click();
    await upstreamsPom.isAddPage(page);

    // Step 1 — Basic
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(upstream.name);
    await wizardNext(page);

    // Step 2 — Nodes (Mantine node editor)
    await page.getByRole('button', { name: 'Add a Node' }).click();
    await page
      .getByPlaceholder('Hostname or IP')
      .fill(upstream.nodes[0].host);
    await page
      .getByPlaceholder('Port')
      .first()
      .fill(String(upstream.nodes[0].port));
    await page.locator('h1').first().click(); // commit on blur
    await wizardNext(page);

    // Step 3 — Connection: scheme https
    await page.getByLabel('Scheme').first().click();
    await page
      .getByRole('option', { name: upstream.scheme, exact: true })
      .click();
    await wizardNext(page);

    // Step 4 — Preview: submit and capture the created id
    const postReq = page.waitForResponse(
      (r) => r.url().includes(API_UPSTREAMS) && r.request().method() === 'POST'
    );
    await wizardSubmit(page);
    const res = await postReq;
    const data = (await res.json()) as APISIXType['RespUpstreamDetail']['data'];
    expect(data).toHaveProperty('value.id');
    upstream.id = data.value.id;

    await uiHasToastMsg(page, { hasText: 'Add Upstream Successfully' });
    // The wizard navigates back to the list after creation
    await upstreamsPom.isIndexPage(page);
  });

  const servicePluginName = 'limit-count';
  const service: { id?: string; name: string } = {
    id: undefined,
    name: randomId('HTTPBIN Service'),
  };
  const servicePluginConfig = {
    count: 10,
    time_window: 60,
    rejected_code: 429,
    key: 'remote_addr',
    policy: 'local',
  };

  await test.step('create service', async () => {
    expect(upstream.id).not.toBeUndefined();

    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);
    await servicesPom.getAddServiceBtn(page).click();
    await servicesPom.isAddPage(page);

    // Step 1 — Basic
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(service.name);
    await wizardNext(page);

    // Step 2 — Upstream: reference the created upstream by name
    await page.getByRole('textbox', { name: 'Upstream', exact: true }).click();
    await page
      .getByRole('option', { name: upstream.name, exact: true })
      .click();
    await wizardNext(page);

    // Step 3 — Plugins
    await addPluginWithJson(
      page,
      servicePluginName,
      JSON.stringify(servicePluginConfig)
    );
    await wizardNext(page);

    // Step 4 — Preview: submit and capture the created id
    const postReq = page.waitForResponse(
      (r) => r.url().includes(API_SERVICES) && r.request().method() === 'POST'
    );
    await wizardSubmit(page);
    const res = await postReq;
    const data = (await res.json()) as APISIXType['RespServiceDetail']['data'];
    expect(data).toHaveProperty('value.id');
    service.id = data.value.id;

    await uiHasToastMsg(page, { hasText: 'Add Service Successfully' });
    await servicesPom.isIndexPage(page);
  });

  const routePluginName = 'cors';
  const route: { id?: string; name: string; uri: string } = {
    id: undefined,
    name: randomId('Generate UUID'),
    uri: '/uuid',
  };
  const routePluginConfig = { allow_origins: 'https://httpbin.local:80' };

  await test.step('create route', async () => {
    expect(service.id).not.toBeUndefined();

    await routesPom.toIndex(page);
    await routesPom.isIndexPage(page);
    await routesPom.getAddRouteBtn(page).click();
    await routesPom.isAddPage(page);

    // Step 1 — API info (methods are pre-filled with sensible defaults)
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first()
      .fill(route.name);
    await page.locator('input[name="uri"]').fill(route.uri);
    await wizardNext(page);

    // Step 2 — bind the created service
    await page.getByText('Bind to Service', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Service', exact: true }).click();
    await page.getByRole('option', { name: service.name, exact: true }).click();
    await wizardNext(page);

    // Step 3 — Request Override (skip)
    await wizardNext(page);

    // Step 4 — Plugins
    await addPluginWithJson(
      page,
      routePluginName,
      JSON.stringify(routePluginConfig)
    );
    await wizardNext(page);

    // Step 5 — Preview: submit and capture the created id
    const postReq = page.waitForResponse(
      (r) => r.url().includes(API_ROUTES) && r.request().method() === 'POST'
    );
    await wizardSubmit(page);
    const res = await postReq;
    const data = (await res.json()) as APISIXType['RespRouteDetail']['data'];
    expect(data).toHaveProperty('value.id');
    route.id = data.value.id;

    await uiHasToastMsg(page, { hasText: 'Add Route Successfully' });
    await routesPom.isIndexPage(page);
  });

  await test.step('verify all created resources', async () => {
    // Lists show all three resources
    await upstreamsPom.toIndex(page);
    await upstreamsPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: upstream.name })).toBeVisible();

    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: service.name })).toBeVisible();

    await routesPom.toIndex(page);
    await routesPom.isIndexPage(page);
    await expect(page.getByRole('cell', { name: route.name })).toBeVisible();

    // Verify the chain through the Admin API
    const routeData = await getRouteReq(e2eReq, route.id!);
    expect(routeData.value.service_id).toBe(service.id);
    expect(routeData.value.plugins).toHaveProperty(routePluginName);

    const serviceData = await getServiceReq(e2eReq, service.id!);
    expect(serviceData.value.upstream_id).toBe(upstream.id);
    expect(serviceData.value.plugins).toHaveProperty(servicePluginName);

    const upstreamData = await getUpstreamReq(e2eReq, upstream.id!);
    const nodes = upstreamData.value.nodes;
    // APISIX may store nodes as an array or a "host:port" keyed object
    // eslint-disable-next-line playwright/no-conditional-in-test
    const hosts = Array.isArray(nodes)
      ? nodes.map((n) => n.host)
      : Object.keys(nodes || {}).map((k) => k.split(':')[0]);
    expect(hosts).toContain(upstream.nodes[0].host);
  });
});

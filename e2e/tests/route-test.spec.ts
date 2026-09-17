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
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiGoto } from '@e2e/utils/ui';
import { expect, type Page } from '@playwright/test';

import { API_ROUTES } from '@/config/constant';

/**
 * The Test Route drawer, against the gateway rather than against whatever the
 * header happened to select.
 *
 * The spec logged in by hand instead of using the worker fixture, so it never
 * pinned an instance and ran against whichever one /api/v1/instances listed
 * first - one with no gateway_url, whose route tests the backend refuses. Its
 * check for an answer matched the first badge in the drawer, which is a count
 * on the Headers tab, so a refused request took the "we got a response" branch
 * and asserted a duration that could not be there. On CI it found no route to
 * open at all and skipped, all five tests, for as long as it has existed (#152).
 *
 * It now seeds the route it tests, and the route answers: through the gateway
 * to etcd's /version, which is reachable from the gateway container and gives a
 * 200 with a body of its own.
 */
const ROUTE_ID = randomId('e2e-route-test');
const ROUTE_PATH = `/${ROUTE_ID}`;

test.beforeAll(async () => {
  await e2eReq.put(`${API_ROUTES}/${ROUTE_ID}`, {
    name: ROUTE_ID,
    uri: ROUTE_PATH,
    methods: ['GET', 'POST'],
    // etcd answers /version with a small JSON body, and the gateway container
    // reaches it under that name - it reads its own configuration from it.
    plugins: { 'proxy-rewrite': { uri: '/version' } },
    upstream: { type: 'roundrobin', nodes: { 'etcd:2379': 1 } },
  });
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_ROUTES}/${ROUTE_ID}`).catch(() => null);
});

const openDrawer = async (page: Page) => {
  await uiGoto(page, '/routes/detail/$id', { id: ROUTE_ID });
  await page.getByRole('button', { name: 'Test Route' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  return drawer;
};

/** The tab panel of the request, which the answer's own tabs follow. */
const requestPanel = (drawer: ReturnType<Page['getByRole']>) =>
  drawer.getByRole('tabpanel').first();

test('opens on the route it was opened from', async ({ page }) => {
  const drawer = await openDrawer(page);

  await expect(drawer.getByText('Test Route')).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: 'URI' })).toHaveValue(ROUTE_PATH);
});

test('sends the request through the gateway and shows what came back', async ({ page }) => {
  const drawer = await openDrawer(page);

  await drawer.getByRole('button', { name: 'Send', exact: true }).click();

  // The status of the answer, not a count badge on a request tab.
  await expect(drawer.getByTestId('route-test-status')).toHaveText(/^200\b/, { timeout: 20000 });
  await expect(drawer.getByTestId('route-test-duration')).toHaveText(/^\d+ms$/);
  // etcd's own answer, so the request really reached it through the gateway.
  await expect(drawer).toContainText('etcdserver');
});

test('adds and removes a header', async ({ page }) => {
  const drawer = await openDrawer(page);
  // The drawer opens with a Content-Type of its own, which the tab counts.
  const headersTab = drawer.getByRole('tab', { name: /^Headers/ });
  await expect(headersTab).toHaveText(/1$/);

  await drawer.getByRole('button', { name: 'Add Header' }).click();
  // The added row, after the two fields of the one already there.
  const fields = requestPanel(drawer).getByRole('textbox');
  await fields.nth(2).fill('X-E2E');
  await fields.nth(3).fill('sent');
  await expect(headersTab).toHaveText(/2$/);

  // That row's own delete button, after the first row's and before Add Header.
  await requestPanel(drawer).getByRole('button').nth(1).click();
  await expect(headersTab).toHaveText(/1$/);
  await expect(fields).toHaveCount(2);
});

test('adds a query parameter', async ({ page }) => {
  const drawer = await openDrawer(page);
  const queryTab = drawer.getByRole('tab', { name: /^Query/ });

  await queryTab.click();
  await drawer.getByRole('button', { name: 'Add Parameter' }).click();
  const fields = requestPanel(drawer).getByRole('textbox');
  await fields.first().fill('answer');
  await fields.nth(1).fill('42');

  await expect(queryTab).toHaveText(/1$/);
});

test('offers a body once the method can carry one', async ({ page }) => {
  const drawer = await openDrawer(page);
  const bodyTab = drawer.getByRole('tab', { name: 'Body' });

  await expect(bodyTab).toBeHidden();

  await drawer.getByRole('textbox', { name: 'HTTP Methods' }).click();
  await page.getByRole('option', { name: 'POST' }).click();

  await expect(bodyTab).toBeVisible();
  await bodyTab.click();
  const body = requestPanel(drawer).getByRole('textbox');
  await body.fill('{"test": true}');
  await expect(body).toHaveValue('{"test": true}');
});

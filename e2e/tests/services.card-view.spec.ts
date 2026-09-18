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
import { expect } from '@playwright/test';

import { postUpstreamReq } from '@/apis/upstreams';
import { API_ROUTES, API_SERVICES, API_UPSTREAMS } from '@/config/constant';

/**
 * The services table shows an id, a name, a truncated description and a date -
 * not the upstream the service sends to, which is the first thing asked about
 * one (#143).
 */
const upstreamName = randomId('e2e-143-up');
const serviceName = randomId('e2e-143-svc');
const routeName = randomId('e2e-143-route');
let serviceId: string;
let upstreamId: string;
let routeId: string;

test.beforeAll(async () => {
  const upstream = await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }],
  });
  upstreamId = upstream.data.value.id;

  const service = await e2eReq.post(API_SERVICES, {
    name: serviceName,
    desc: 'A description long enough that the table would cut it short',
    upstream_id: upstreamId,
  });
  serviceId = service.data.value.id;

  const route = await e2eReq.post(API_ROUTES, {
    name: routeName,
    uri: `/${routeName}`,
    service_id: serviceId,
  });
  routeId = route.data.value.id;
});

test.afterAll(async () => {
  for (const [api, id] of [
    [API_ROUTES, routeId],
    [API_SERVICES, serviceId],
    [API_UPSTREAMS, upstreamId],
  ] as const) {
    if (id) await e2eReq.delete(`${api}/${id}`).catch(() => undefined);
  }
});

test('shows a service’s upstream and its description in full', async ({ page }) => {
  await page.goto('/ui/services?view=cards&page_size=100');

  const card = page.locator('.mantine-Card-root').filter({ hasText: serviceName });
  await expect(card).toHaveCount(1, { timeout: 20000 });

  // The upstream by name, not by id: the id is what the table would have had
  // to show, and it says nothing to whoever is reading.
  await expect(card.getByText(upstreamName, { exact: true })).toBeVisible();
  // And the description whole.
  await expect(
    card.getByText('A description long enough that the table would cut it short')
  ).toBeVisible();
});

test('keeps the table as the default, and the choice in the URL', async ({ page }) => {
  await page.goto('/ui/services?page_size=100');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.mantine-Card-root')).toHaveCount(0);

  // The radio inputs are visually hidden behind their labels, which is what a
  // person clicks.
  const viewLabel = (name: string) =>
    page.locator('.mantine-SegmentedControl-label').filter({ hasText: name });
  await viewLabel('Cards').click();
  await expect(page).toHaveURL(/view=cards/);
  await expect(page.locator('.mantine-Card-root').first()).toBeVisible();

  // A reload lands on the same view: the choice is in the link, not in the
  // component.
  await page.reload();
  await expect(page.locator('.mantine-Card-root').first()).toBeVisible();

  await viewLabel('Table').click();
  await expect(page.getByRole('table')).toBeVisible();
});

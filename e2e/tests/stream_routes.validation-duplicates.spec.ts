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
import { streamRoutesPom } from '@e2e/pom/stream_routes';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillStreamRouteRequiredFields,
  uiSelectStreamRouteUpstream,
} from '@e2e/utils/ui/stream_routes';
import { expect, type Page } from '@playwright/test';

import { getStreamRouteListReq } from '@/apis/stream_routes';
import { API_STREAM_ROUTES, API_UPSTREAMS, PAGE_SIZE_MAX } from '@/config/constant';

/**
 * A stream route could be saved with nothing in it at all — APISIX answers a
 * completely empty body with 201 — producing a list row of dashes that can
 * never forward traffic. Submitting the same configuration twice also created
 * two indistinguishable entries.
 */

// Re-created per test under a fixed id so re-seeding is idempotent. No spec
// empties the gateway any more (#82), but per-test seeding is still the more
// robust arrangement and costs nothing.
const UPSTREAM_ID = 'e2e-sr-dup-upstream';
const upstreamName = 'e2e-sr-dup-upstream';
const SERVER_ADDR = '127.0.9.9';
const SERVER_PORT = 9399;

const countMatching = async (): Promise<number> => {
  const res = await getStreamRouteListReq(e2eReq, {
    page: 1,
    page_size: PAGE_SIZE_MAX,
  });
  return res.list.filter(
    (r) => r.value.server_addr === SERVER_ADDR && r.value.server_port === SERVER_PORT
  ).length;
};

const gotoAdd = async (page: Page) => {
  await streamRoutesPom.toIndex(page);
  await streamRoutesPom.toAdd(page);
  await expect(page.getByRole('heading', { name: 'Add Stream Route' })).toBeVisible({
    timeout: 30000,
  });
};

const submit = (page: Page) =>
  page.getByRole('button', { name: 'Add', exact: true }).click();

test.beforeEach(async () => {
  await e2eReq.put(`${API_UPSTREAMS}/${UPSTREAM_ID}`, {
    name: upstreamName,
    type: 'roundrobin',
    nodes: { '127.0.0.1:1980': 1 },
  });
});

test.afterEach(async () => {
  const res = await getStreamRouteListReq(e2eReq, {
    page: 1,
    page_size: PAGE_SIZE_MAX,
  });
  await Promise.all(
    res.list
      .filter((r) => r.value.server_addr === SERVER_ADDR)
      .map((r) => e2eReq.delete(`${API_STREAM_ROUTES}/${r.value.id}`))
  );
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_UPSTREAMS}/${UPSTREAM_ID}`).catch(() => null);
});

test('refuses to save a stream route with nowhere to send traffic', async ({
  page,
}) => {
  await gotoAdd(page);

  // Submit with everything blank, which used to create a row of dashes.
  await submit(page);

  await expect(
    page.getByText(
      'Select an upstream, bind a service, or configure a custom upstream with at least one node'
    )
  ).toBeVisible();

  // Match conditions alone are still not a destination.
  await uiFillStreamRouteRequiredFields(page, {
    server_addr: SERVER_ADDR,
    server_port: SERVER_PORT,
  });
  await submit(page);
  await expect(
    page.getByText(
      'Select an upstream, bind a service, or configure a custom upstream with at least one node'
    )
  ).toBeVisible();

  expect(await countMatching()).toBe(0);

  // With an upstream chosen it saves.
  await uiSelectStreamRouteUpstream(page, upstreamName);
  await submit(page);
  await streamRoutesPom.isDetailPage(page);
  expect(await countMatching()).toBe(1);
});

test('warns before creating a second stream route matching the same traffic', async ({
  page,
}) => {
  // Seed one through the API so the form has something to collide with.
  await e2eReq.put(`${API_STREAM_ROUTES}/${randomId('sr-dup')}`, {
    server_addr: SERVER_ADDR,
    server_port: SERVER_PORT,
    upstream_id: UPSTREAM_ID,
  });
  expect(await countMatching()).toBe(1);

  await gotoAdd(page);
  await uiFillStreamRouteRequiredFields(page, {
    server_addr: SERVER_ADDR,
    server_port: SERVER_PORT,
  });
  await uiSelectStreamRouteUpstream(page, upstreamName);
  await submit(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${SERVER_ADDR}:${SERVER_PORT}`);

  // Backing out leaves the gateway alone.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(await countMatching()).toBe(1);

  // Confirming goes ahead: the warning informs, it does not forbid.
  await submit(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Create anyway' }).click();
  await streamRoutesPom.isDetailPage(page);
  expect(await countMatching()).toBe(2);
});

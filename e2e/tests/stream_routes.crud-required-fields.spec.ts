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
import { deleteByPrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg, uiShowAllRows } from '@e2e/utils/ui';
import {
  uiCheckStreamRouteRequiredFields,
  uiFillStreamRouteRequiredFields,
  uiSelectStreamRouteUpstream,
} from '@e2e/utils/ui/stream_routes';
import { expect } from '@playwright/test';

import { postUpstreamReq } from '@/apis/upstreams';
import { API_STREAM_ROUTES, API_UPSTREAMS } from '@/config/constant';

// The redesigned form references an existing upstream; seed one via the API
const upstreamName = randomId('sr-req-upstream');

test.beforeAll(async () => {
  await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: [{ host: '127.0.0.2', port: 8080, weight: 1 }],
  });
});

// A /24 of loopback picked at random per run: 127.X.Y.0, X at least 2, so it
// never meets the fixed 127.0.x addresses other specs use. A row an earlier,
// interrupted run left behind is all but certain to sit in another /24 — two
// runs draw the same one about once in 65,000 — and afterAll can sweep this
// run's stream routes by prefix without touching anyone else's (#151).
const RUN_NET = `127.${2 + Math.floor(Math.random() * 253)}.${Math.floor(
  Math.random() * 256
)}.`;

// Only the upstream this spec seeded; the gateway's other ones are not
// this spec's to remove.
test.afterAll(async () => {
  // The stream route first. The test deletes it through the UI, which only
  // happens once every step before it has passed, so a failing run used to
  // leave it behind — pushing the next run's row onto page 2 and failing that
  // one too.
  await deleteByPrefix(API_STREAM_ROUTES, 'server_addr', RUN_NET);
  await deleteByPrefix(API_UPSTREAMS, 'name', upstreamName);
});


test.describe.configure({ mode: 'serial' });

test('CRUD stream route with required fields', async ({ page }) => {
  // Navigate to stream routes page
  await streamRoutesPom.toIndex(page);
  await expect(page.getByRole('heading', { name: 'Stream Routes' })).toBeVisible();

  // Navigate to add page
  await streamRoutesPom.toAdd(page);
  await expect(page.getByRole('heading', { name: 'Add Stream Route' })).toBeVisible({ timeout: 30000 });

  // Use unique server addresses to avoid collisions when running tests in parallel
  const uniqueId = randomId('test');
  const uniqueIpSuffix = parseInt(uniqueId.slice(-6), 36) % 240 + 10; // 10-249
  const streamRouteData = {
    server_addr: `${RUN_NET}${uniqueIpSuffix}`,
    server_port: 9000 + parseInt(uniqueId.slice(-4), 36) % 1000, // Unique port
  };

  // Fill required fields
  await uiFillStreamRouteRequiredFields(page, streamRouteData);

  // Reference the API-seeded upstream (the form has no inline node editor).
  await uiSelectStreamRouteUpstream(page, upstreamName);

  // Submit and land on detail page
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Wait for success toast before checking detail page
  await uiHasToastMsg(page, {
    hasText: 'Add Stream Route Successfully',
  });

  await streamRoutesPom.isDetailPage(page);

  // Verify created values in detail view
  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  // Enter edit mode from detail page
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Stream Route' })).toBeVisible();

  // Verify pre-filled values
  await uiCheckStreamRouteRequiredFields(page, streamRouteData);

  // Edit fields - add description and labels
  const updatedData = {
    ...streamRouteData,
    desc: `Updated stream route description - ${uniqueId}`,
    labels: {
      env: 'test',
      version: '1.0',
    },
  };

  await uiFillStreamRouteRequiredFields(page, {
    desc: updatedData.desc,
    labels: updatedData.labels,
  });

  // Submit edit and return to detail page
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await streamRoutesPom.isDetailPage(page);

  // Verify updated values on detail page
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Navigate back to index and ensure the row exists
  await streamRoutesPom.toIndex(page);
  await uiShowAllRows(page);
  const row = page.getByRole('row').filter({ hasText: streamRouteData.server_addr });
  await expect(row.first()).toBeVisible({ timeout: 10000 }); // Longer timeout for parallel tests

  // View detail page from the list
  await row.first().getByRole('link', { name: 'View' }).click();
  await streamRoutesPom.isDetailPage(page);
  await uiCheckStreamRouteRequiredFields(page, updatedData);

  // Delete from the detail page
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.waitForURL((url) => url.pathname.endsWith('/stream_routes'));

  await streamRoutesPom.isIndexPage(page);
  // On every row, not page 1: there a row pushed to page 2 reads as deleted.
  await uiShowAllRows(page);
  await expect(
    page.getByRole('row').filter({ hasText: streamRouteData.server_addr })
  ).toHaveCount(0);
});

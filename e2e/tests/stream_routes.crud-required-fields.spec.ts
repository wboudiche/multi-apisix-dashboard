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
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  uiCheckStreamRouteRequiredFields,
  uiFillStreamRouteRequiredFields,
  uiSelectStreamRouteUpstream,
} from '@e2e/utils/ui/stream_routes';
import { expect } from '@playwright/test';

import { deleteAllUpstreams, postUpstreamReq } from '@/apis/upstreams';

// The redesigned form references an existing upstream; seed one via the API
const upstreamName = randomId('sr-req-upstream');

test.beforeAll(async () => {
  await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: [{ host: '127.0.0.2', port: 8080, weight: 1 }],
  });
});

test.afterAll(async () => {
  await deleteAllUpstreams(e2eReq);
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
    server_addr: `127.0.1.${uniqueIpSuffix}`,
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
  await expect(
    page.getByRole('row').filter({ hasText: streamRouteData.server_addr })
  ).toHaveCount(0);
});

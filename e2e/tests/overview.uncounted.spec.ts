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
import { adminPom } from '@e2e/pom/admin';
import { adminToken, deleteInstancesByPrefix, getOverview } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The overview's totals are a sum over the gateways it could count. One it
 * could not - unreachable, or answering something that is not the Admin API -
 * used to drop out of the sum without a word, so the page showed a smaller
 * estate rather than an incomplete answer (#286).
 */
const PREFIX = randomId('uncounted');
// Nothing listens there. A gateway that cannot be counted is what this needs,
// and a closed port is the cheapest one to arrange.
const DEAD_ADMIN_URL = 'http://127.0.0.1:8';

test.afterAll(async () => {
  await deleteInstancesByPrefix(PREFIX);
});

test('says how many gateways are missing from its totals', async ({ page }) => {
  // A delta, not an absolute: other specs register unreachable gateways of
  // their own while this one runs - instances.admin and
  // maintenance.orphaned-ownership both do - and a dead instance left behind
  // by an earlier run on a shared stack would fail an exact count with a
  // message that names none of that.
  const before = (await getOverview({ refresh: true })).uncounted_instances ?? 0;

  await ensureInstance(await adminToken(), {
    name: `${PREFIX}-dead`,
    admin_api_url: DEAD_ADMIN_URL,
    admin_key: 'unused-by-this-spec',
  });

  // Read through the API first: the page caches its overview for thirty
  // seconds, and this is about what the backend now reports.
  await expect
    .poll(async () => (await getOverview({ refresh: true })).uncounted_instances ?? 0)
    .toBeGreaterThan(before);

  // And the page says so. The number it prints is the backend's, which the
  // poll above has already pinned down; what this asserts is that the caveat
  // reaches the operator at all - it did not exist before.
  await adminPom.toOverview(page);
  await expect(page.getByTestId('overview-uncounted')).toBeVisible();
  await expect(page.getByTestId('overview-uncounted')).toContainText(
    'could not be fully counted'
  );
});

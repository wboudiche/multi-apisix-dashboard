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
import { adminToken, deleteInstancesByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { env } from '@e2e/utils/env';
import { ensureInstance } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { expect } from '@playwright/test';

/**
 * An address that answers, but not as a gateway, used to pass the connection
 * test: it only looked at the status (#288). That is the one answer this test
 * must not give, because it is pressed precisely to find out whether the
 * address is right.
 *
 * The dashboard's own address is the example to use: a single-page app serves
 * its index for any path it does not know, so it answers 200 to the probe -
 * and pasting the dashboard's URL where the gateway's belongs is the mistake
 * this catches.
 */
const PREFIX = randomId('not-a-gateway');

// E2E_TARGET_URL ends in /ui/; the probe appends /apisix/admin/services to
// whatever is stored, and that path is not proxied under /ui.
const DASHBOARD_URL = env.E2E_TARGET_URL.replace(/\/$/, '');

test.afterAll(async () => {
  await deleteInstancesByPrefix(PREFIX);
});

test('refuses an address that answers without being a gateway', async ({ page }) => {
  const name = `${PREFIX}-dashboard-itself`;
  await ensureInstance(await adminToken(), {
    name,
    admin_api_url: DASHBOARD_URL,
    admin_key: 'irrelevant',
  });

  await adminPom.toInstances(page);
  await adminPom.isInstancesPage(page);

  // The badge first: it is what an operator reads without pressing anything.
  const badge = adminPom.rowByText(page, name).getByText('Unreachable');
  await expect(badge).toBeVisible();

  // And why, which is what keeps this spec honest: a dead port would badge
  // Unreachable too, and this one is meant to prove that an address which
  // *answers* is refused for the shape of its answer.
  await badge.hover();
  await expect(page.getByRole('tooltip')).toContainText('not as an APISIX Admin API');

  await adminPom
    .rowByText(page, name)
    .getByRole('button', { name: 'Test Connection' })
    .click();

  await uiHasToastMsg(page, { hasText: 'Connection Failed' });
});

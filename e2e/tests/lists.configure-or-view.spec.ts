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
import { permission } from '@e2e/pom/permission';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

import { API_CONSUMER_GROUPS, API_SERVICES } from '@/config/constant';

/**
 * Every list page offered the same control under the same word, whatever the
 * account could do with it: "View" everywhere, in the primary blue, including
 * for the admins who could edit - and, after #188, "Configure" on the routes
 * page alone. One word per meaning now, decided per resource rather than per
 * account, because a role reads some resources and writes others (#270).
 *
 * Two pages, because they render that control two ways: services writes its own
 * button, consumer_groups uses the shared ToDetailPageBtn, where the word is
 * the icon's accessible name.
 */
const serviceId = randomId('e2e-270-svc');
const groupId = randomId('e2e-270-cg');

const onViewersTeam = () => ({
  headers: {
    'X-Instance-ID': getFixtures().localInstanceId,
    'X-Team-ID': getFixtures().viewersTeamId,
  },
});

test.beforeAll(async () => {
  // Owned by the viewer's team: a viewer sees their team's resources and
  // nothing else, so an unowned one would not be on their page at all.
  await e2eReq.put(
    `${API_SERVICES}/${serviceId}`,
    { name: serviceId, upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }] } },
    onViewersTeam()
  );
  await e2eReq.put(`${API_CONSUMER_GROUPS}/${groupId}`, { plugins: {} }, onViewersTeam());
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_SERVICES}/${serviceId}`).catch(() => undefined);
  await e2eReq.delete(`${API_CONSUMER_GROUPS}/${groupId}`).catch(() => undefined);
});

const serviceRow = (page: Page) => page.getByRole('row').filter({ hasText: serviceId });
const groupRow = (page: Page) => page.getByRole('row').filter({ hasText: groupId });

test('offers an admin the edit it can perform, on both kinds of list', async ({ page }) => {
  await page.goto(`/ui/services?name=${serviceId}`);
  await expect(serviceRow(page)).toHaveCount(1, { timeout: 20000 });
  await expect(serviceRow(page).getByRole('button', { name: 'Configure' })).toBeVisible();

  // Every row on one page: other specs create consumer groups in parallel and
  // a group has no name to filter by.
  await page.goto('/ui/consumer_groups?page_size=100');
  await expect(groupRow(page)).toHaveCount(1, { timeout: 20000 });
  await expect(groupRow(page).getByRole('link', { name: 'Configure' })).toBeVisible();
});

test('offers a viewer the reading it is allowed instead', async ({ browser }) => {
  // 90s: loginAs and switchInstance reload the page more than once.
  test.setTimeout(90_000);
  const fx = getFixtures();
  // A context of its own: the worker's stored session belongs to the admin.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    await permission.loginAs(page, fx.users.viewer.username, fx.users.viewer.password);
    await permission.switchInstance(page, 'Local APISIX');

    await page.goto(`/ui/services?name=${serviceId}`);
    await expect(serviceRow(page)).toHaveCount(1, { timeout: 30000 });
    await expect(serviceRow(page).getByRole('button', { name: 'View' })).toBeVisible();
    await expect(serviceRow(page).getByRole('button', { name: 'Configure' })).toHaveCount(0);

    // Every row on one page: other specs create consumer groups in parallel and
  // a group has no name to filter by.
  await page.goto('/ui/consumer_groups?page_size=100');
    await expect(groupRow(page)).toHaveCount(1, { timeout: 30000 });
    await expect(groupRow(page).getByRole('link', { name: 'View' })).toBeVisible();
    await expect(groupRow(page).getByRole('link', { name: 'Configure' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

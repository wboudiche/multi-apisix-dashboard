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
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * `/api/v1/user-access/<id>/instances` is the list a role is read out of. It is
 * read in two places, and both used to absorb a failure into an empty list —
 * the users table showed the account as having no assignments, and the header
 * left `userInstancesAtom` empty with nothing said.
 *
 * Neither widens what anyone may do: usePermission falls back to `user.role`,
 * which the backend keeps empty for every non-super_admin. They narrow it, and
 * they do it silently, which is the thing #165 is about — "could not be read"
 * shown as "there is none".
 *
 * A real misrouted proxy answers 200 with the SPA's own index.html, so that is
 * what these send.
 */
const misrouted = (page: import('@playwright/test').Page) =>
  page.route('**/api/v1/user-access/*/instances', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>index</body></html>',
    })
  );

test('the users table says an assignment could not be read, not that there is none', async ({
  page,
}) => {
  await misrouted(page);
  await page.goto('/ui/users');

  // The em dash is what "no assignments" looks like, and it is what this used
  // to show: a super admin auditing who may do what could not tell the two
  // apart on the one screen that answers that question.
  await expect(page.getByText('Could not be read').first()).toBeVisible({
    timeout: 20000,
  });
  // The body too, and the endpoint in it: this is the one report that passes
  // the backend's reason through an i18next interpolation, which escapes for
  // markup by default - a path would arrive as "&#x2F;api&#x2F;v1&#x2F;...".
  const report = page
    .locator('.mantine-Notification-root')
    .filter({ hasText: 'Assignments unavailable' });
  await expect(report).toBeVisible({ timeout: 20000 });
  // Scoped to this report: the header's own read of the same endpoint fails
  // here too, and reports it separately - which is the point of that split.
  await expect(report.getByText('/api/v1/user-access/')).toBeVisible();
});

test('the header says the account’s access list could not be read', async ({ page }) => {
  // Away from the users page: this one is the header's own read, on every
  // page, and it fed the role badge and usePermission.
  await misrouted(page);
  await page.goto('/ui/routes');

  await expect(
    page
      .locator('.mantine-Notification-root')
      .filter({ hasText: 'Access list unavailable' })
  ).toBeVisible({ timeout: 20000 });
});

test('and says nothing when the list reads fine', async ({ page }) => {
  // The other side of the distinction: no toast, and no "could not be read" in
  // the table, on a session where the endpoint answers normally.
  await page.goto('/ui/users');

  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText('Could not be read')).toHaveCount(0);
  await expect(
    page.locator('.mantine-Notification-root').filter({ hasText: 'unavailable' })
  ).toHaveCount(0);
});

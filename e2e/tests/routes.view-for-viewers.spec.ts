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
import { expect } from '@playwright/test';

import { API_ROUTES } from '@/config/constant';

/**
 * A viewer saw the same primary blue "Configure" button an admin does. The word
 * promises an edit, and the detail page it opens is read-only for them: every
 * field refuses to save, and the proxy answers 403 to the write if one got
 * through. The label and the weight now follow the role (#188).
 */

// Random rather than time-based: the file's two tests can land in two workers,
// each running this module's hooks, and a shared name would have one worker's
// cleanup pull the route out from under the other's read.
const routeName = randomId('e2e-188-route');

test.beforeAll(async () => {
  const fx = getFixtures();
  // Owned by the viewer's team: a viewer sees their team's resources and
  // nothing else, so an unowned route would simply not be on their page.
  await e2eReq.put(
    `${API_ROUTES}/${routeName}`,
    {
      name: routeName,
      uri: `/${routeName}`,
      upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 1980, weight: 1 }] },
    },
    {
      headers: {
        'X-Instance-ID': fx.localInstanceId,
        'X-Team-ID': fx.viewersTeamId,
      },
    }
  );
});

test.afterAll(async () => {
  await e2eReq.delete(`${API_ROUTES}/${routeName}`).catch(() => undefined);
});

test('offers an admin the edit it can actually perform', async ({ page }) => {
  await page.goto(`/ui/routes?name=${routeName}`);
  const row = page.getByRole('row').filter({ hasText: routeName });
  // 20s, not 30: this test keeps the default 30s budget, and the fixture has
  // already spent some of it loading the app once.
  await expect(row).toHaveCount(1, { timeout: 20000 });

  const configure = row.getByRole('button', { name: 'Configure' });
  await expect(configure).toBeVisible();
  // The weight as well as the word: filled is the row's primary action.
  await expect(configure).toHaveAttribute('data-variant', 'filled');
  await expect(row.getByRole('button', { name: 'View' })).toHaveCount(0);
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
    await page.goto(`/ui/routes?name=${routeName}`);

    const row = page.getByRole('row').filter({ hasText: routeName });
    await expect(row).toHaveCount(1, { timeout: 30000 });

    const view = row.getByRole('button', { name: 'View' });
    await expect(view).toBeVisible();
    // Lighter, but still the row's primary action - reading a route is the
    // thing this account came to do.
    await expect(view).toHaveAttribute('data-variant', 'light');
    await expect(row.getByRole('button', { name: 'Configure' })).toHaveCount(0);

    // The way in is the same page, and it is still offered: reading a route is
    // something a viewer may do, and this is how they get there.
    await view.click();
    await expect(page).toHaveURL(/\/routes\/detail\//);
  } finally {
    await context.close();
  }
});

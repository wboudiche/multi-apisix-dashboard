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
import { getFixtures } from '@e2e/utils/fixtures';
import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The shape a resource POM needs to expose to be drivable by the
 * ownership matrix helper. All existing POMs in e2e/pom/ already
 * expose `goto.toIndex` — only `rowByName` needs to be added per
 * resource (a one-liner: page.getByRole('row').filter({ hasText: name })).
 */
export type ResourcePOMShape = {
  goto: { toIndex: (page: Page) => Promise<unknown> };
  locator: {
    /** Returns the table row for a resource by its visible name. */
    rowByName: (page: Page, name: string) => Locator;
  };
};

export type OwnershipMatrixOpts = {
  /** Singular noun, used in test titles. e.g. 'route', 'service'. */
  resourceLabel: string;
  pom: ResourcePOMShape;
  /**
   * Drives the UI to create a minimal resource of this type with
   * the given name, leaving the page on the list view. The seed
   * pre-logs in as dev_user (Backend Team) before this is called.
   */
  createMinimal: (page: Page, name: string) => Promise<void>;
  /**
   * Removes the resource after the suite. Called from afterAll as
   * admin so cleanup never fails on ownership rules. If the resource
   * no longer exists, must return silently.
   */
  cleanup: (page: Page, name: string) => Promise<void>;
  /**
   * Opt in to asserting that the resource row shows a 'Backend Team'
   * chip after creation. Only the routes list currently renders a
   * Teams column; the other resource list pages don't expose team
   * ownership in their table yet (the data is enforced server-side
   * but not surfaced in the list). Default: false.
   */
  assertTeamChipInRow?: boolean;
};

const INSTANCE_NAME = 'Local APISIX';

export function ownershipMatrixSuite(opts: OwnershipMatrixOpts) {
  const fx = getFixtures();
  const resourceName = `ownership-${opts.resourceLabel}-${Date.now()}`;

  test.describe.configure({ mode: 'serial' });

  test.describe(`${opts.resourceLabel} — team ownership matrix`, () => {
    // The first test walks the resource's add form, which is a 5-step
    // wizard for routes and a single dialog-heavy form for consumer
    // groups; either can edge past Playwright's 30s default on CI's
    // slower runners. The other 3 tests are short list-page checks.
    test.setTimeout(60000);

    test.afterAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        await permission.loginAs(
          page,
          fx.users.admin.username,
          fx.users.admin.password
        );
        await permission.switchInstance(page, INSTANCE_NAME);
        await opts.cleanup(page, resourceName);
      } finally {
        await page.close();
      }
    });

    test(`dev_user (Backend Team) can create a ${opts.resourceLabel}`, async ({
      page,
    }) => {
      await permission.loginAs(
        page,
        fx.users.dev.username,
        fx.users.dev.password
      );
      await permission.switchInstance(page, INSTANCE_NAME);
      await opts.createMinimal(page, resourceName);

      const row = opts.pom.locator.rowByName(page, resourceName);
      await expect(row).toBeVisible();
      if (opts.assertTeamChipInRow) {
        await expect(row.getByText('Backend Team')).toBeVisible();
      }
    });

    test(`frontend_dev (Frontend Team) does NOT see the ${opts.resourceLabel} in the list`, async ({
      page,
    }) => {
      await permission.loginAs(
        page,
        fx.users.frontend.username,
        fx.users.frontend.password
      );
      await permission.switchInstance(page, INSTANCE_NAME);
      await opts.pom.goto.toIndex(page);
      await expect(
        opts.pom.locator.rowByName(page, resourceName)
      ).toHaveCount(0);
    });

    test(`viewer_user (Viewers Team) does NOT see the ${opts.resourceLabel} in the list`, async ({
      page,
    }) => {
      await permission.loginAs(
        page,
        fx.users.viewer.username,
        fx.users.viewer.password
      );
      await permission.switchInstance(page, INSTANCE_NAME);
      await opts.pom.goto.toIndex(page);
      await expect(
        opts.pom.locator.rowByName(page, resourceName)
      ).toHaveCount(0);
    });

    test(`admin sees the ${opts.resourceLabel} regardless of team ownership`, async ({
      page,
    }) => {
      await permission.loginAs(
        page,
        fx.users.admin.username,
        fx.users.admin.password
      );
      await permission.switchInstance(page, INSTANCE_NAME);
      await opts.pom.goto.toIndex(page);
      await expect(
        opts.pom.locator.rowByName(page, resourceName)
      ).toBeVisible();
    });
  });
}

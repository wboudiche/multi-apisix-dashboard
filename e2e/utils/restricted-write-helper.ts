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
import { expect, type Page, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8086';
const INSTANCE_NAME = 'Local APISIX';

export type RestrictedWriteOpts = {
  /** Singular noun, used in test titles. e.g. 'ssl', 'global_rule'. */
  resourceLabel: string;
  /**
   * The APISIX Admin API path segment, used to construct the
   * /api/v1/apisix/admin/<resourcePath>/<id> URL. Examples:
   *   - 'ssls', 'global_rules', 'plugin_configs', 'protos'
   *   - 'secrets/aws' (the manager subtype is part of the path)
   */
  resourcePath: string;
  /**
   * Navigates the page to the resource list view. Typically
   * <resourcePom>.goto.toIndex.
   */
  gotoIndex: (page: Page) => Promise<void>;
  /**
   * The visible label on the add-button that admins see. The
   * test asserts dev_user does NOT see this button. The match
   * is exact via getByRole('button', { name: ... }).
   */
  createButtonName: string;
};

export function restrictedWriteSuite(opts: RestrictedWriteOpts) {
  const fx = getFixtures();

  test.describe(`${opts.resourceLabel} — developer write denied`, () => {
    test(`dev_user does NOT see the create-${opts.resourceLabel} CTA`, async ({
      page,
    }) => {
      await permission.loginAs(
        page,
        fx.users.dev.username,
        fx.users.dev.password
      );
      await permission.switchInstance(page, INSTANCE_NAME);
      await opts.gotoIndex(page);

      await expect(
        page.getByRole('button', { name: opts.createButtonName })
      ).toHaveCount(0);
    });

    test(`dev_user PUT to /apisix/admin/${opts.resourcePath} returns 403`, async ({
      page,
      request,
    }) => {
      // Defense-in-depth: even if the UI gate is bypassed, the
      // backend RBAC layer must reject the write. We pull the
      // JWT out of localStorage (set by the apiClient login flow)
      // and call the Go backend directly.
      await permission.loginAs(
        page,
        fx.users.dev.username,
        fx.users.dev.password
      );
      const token = await page.evaluate(() =>
        localStorage
          .getItem('auth:access_token')
          ?.replaceAll('"', '')
      );

      const id = `dev-denied-${Date.now()}`;
      const res = await request.put(
        `${API}/api/v1/apisix/admin/${opts.resourcePath}/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Instance-ID': fx.localInstanceId,
          },
          // Empty body — RBAC must reject before validation.
          data: {},
        }
      );
      expect(res.status()).toBe(403);
    });
  });
}

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
 * InstanceGuard decides whether any page may render, so whatever it does with a
 * bad answer, it does to the whole dashboard.
 *
 * It checked `instances.length` before `instances.some(...)`, and a string has
 * a length: 28 characters of HTML read as 28 registered instances, and the next
 * line threw. axios resolves any 2xx, so a misrouted proxy handing back the
 * SPA's own index.html arrives here as success.
 */

const NOT_A_LIST = [
  { name: 'the SPA index.html a misrouted proxy returns', body: '"<!doctype html><html></html>"' },
  { name: 'an object where a list belongs', body: '{"total":0}' },
  { name: 'null', body: 'null' },
];

for (const shape of NOT_A_LIST) {
  test(`survives ${shape.name}`, async ({ page }) => {
    await page.route('**/api/v1/instances', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: shape.body })
    );

    await page.goto('/ui/routes');

    // Not the router's error component, which takes the shell down with it.
    await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0, {
      timeout: 20000,
    });

    // The guard's own explanation instead: nothing usable came back, so there
    // is no instance to work with — which is the truthful reading of it.
    await expect(
      page.getByText('No APISIX gateway connected')
    ).toBeVisible({ timeout: 20000 });

    // And the shell is still there to navigate away with.
    await expect(page.locator('header')).toBeVisible();
  });
}

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
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { test as baseTest } from '@playwright/test';

import { fileExists } from './common';
import { env } from './env';
import { getFixtures } from './fixtures';

export type Test = typeof test;
export const test = baseTest.extend<object, { workerStorageState: string }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),
  workerStorageState: [
    async ({ browser }, use) => {
      const id = test.info().parallelIndex;
      const fileName = path.resolve(
        test.info().project.outputDir,
        `.auth/${id}.json`
      );

      // Reuse existing auth state if available (must also carry the pinned
      // instance id — older caches without it would hit the auto-select race)
      if (await fileExists(fileName)) {
        const cached = (await readFile(fileName)).toString();
        if (
          cached.includes('auth:access_token') &&
          cached.includes('instance:current_id')
        ) {
          return use(fileName);
        }
      }

      const page = await browser.newPage({ storageState: undefined });
      await page.goto(env.E2E_TARGET_URL);

      // Authenticate via JWT login form
      await page.waitForURL((url) => url.pathname.includes('/login'), { timeout: 10000 });
      await page.getByRole('textbox', { name: 'Username' }).fill('admin');
      await page.getByPlaceholder('Enter your password').fill('admin');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Wait for redirect away from login
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

      // Pin the seeded "Local APISIX" instance. e2eReq seeds all test data
      // with X-Instance-ID = localInstanceId, while the header would
      // otherwise auto-select instances[0] (non-deterministic order, often
      // Staging) — leaving every list page querying the wrong gateway.
      const fx = getFixtures();
      // Wait for the header's auto-select to settle first — its async
      // effect captured an empty instance id at mount and would otherwise
      // overwrite our pin when it resolves
      await page
        .waitForFunction(() => !!localStorage.getItem('instance:current_id'), {
          timeout: 10000,
        })
        .catch(() => {
          /* no instances yet — pin below still applies */
        });
      await page.evaluate(
        (instanceId) => localStorage.setItem('instance:current_id', instanceId),
        fx.localInstanceId
      );
      // Setting localStorage alone races the header's auto-select effect
      // (it sees an empty atom from the pre-pin page load and overwrites the
      // pin with instances[0]). Reload so the app re-initializes from the
      // pinned id — a valid id is never overwritten — then verify it stuck.
      await page.reload();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1500);
      const pinned = await page.evaluate(() =>
        localStorage.getItem('instance:current_id')
      );
      if (pinned !== fx.localInstanceId) {
        throw new Error(
          `instance pin failed: expected ${fx.localInstanceId}, got ${pinned}`
        );
      }

      await page.context().storageState({ path: fileName });
      await page.close();
      await use(fileName);
    },
    { scope: 'worker' },
  ],
  page: async ({ baseURL, page }, use) => {
    await page.goto(baseURL);
    await use(page);
  },
});

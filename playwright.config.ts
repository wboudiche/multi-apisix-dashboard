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
import { defineConfig, devices } from '@playwright/test';

import { env } from './e2e/utils/env';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './test-results',
  globalSetup: './e2e/utils/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  /**
   * A change that breaks rendering breaks every spec that drives the UI, and
   * each one then burns its retries in series. That is how #121 played out: the
   * shard passed the 40-minute ceiling, GitHub cancelled it, and Playwright
   * never printed its summary — so three PRs went by without anyone seeing the
   * one-line console error that explained it.
   *
   * Capped, a shard in that state ends on its own and prints its summary
   * instead of being cancelled mid-flight. Note that the gain is the summary
   * rather than speed: retries stay at 2 because they earn their place against
   * real flake, so five failures still cost fifteen executions, and in this
   * scenario every one of them is a locator timeout: reproducing #121's blank
   * page and running under CI settings, the shard gave up after 10m17s with
   * "Testing stopped early after 5 maximum allowed failures" and a list of
   * them, against a 40-minute ceiling and no summary at all before.
   *
   * CI only: a local run is where the whole picture is wanted, and no ceiling
   * is cancelling it.
   */
  maxFailures: process.env.CI ? 5 : undefined,
  reporter: [
    ['html'],
    ['list'],
    [
      '@estruyf/github-actions-reporter',
      {
        useDetails: true,
        showError: true,
      },
    ],
  ],
  use: {
    baseURL: env.E2E_TARGET_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        permissions: ['clipboard-read'],
        // use chrome
        // channel: "chrome",
      },
    },
  ],
});

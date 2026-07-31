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
import { getFixtures } from '@e2e/utils/fixtures';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

/**
 * The Plugin Metadata screen issues one request per plugin. A developer may not
 * read plugin metadata, so every one of those came back 403 — and a 403 from
 * this backend carries its text in `error`, which the interceptor did not read.
 * The result was a notification per plugin, each of them empty, and each with
 * an undefined id so nothing deduplicated them. They stacked over the page and
 * blocked the controls underneath.
 */

const fx = () => getFixtures();

test('a developer sees one explanation, not a tower of empty toasts', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto('/ui/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(fx().users.dev.username);
    await page.getByPlaceholder('Enter your password').fill(fx().users.dev.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

    await page.goto('/ui/plugin_metadata');

    // The refusal is stated once, in the page rather than over it.
    await expect(
      page.getByText(
        'Your role on this instance may not read plugin metadata. Ask an admin if you need access.'
      )
    ).toBeVisible({ timeout: 20000 });

    // Sampled over a window rather than checked once: the requests are fired
    // per plugin and resolve at different times, and notifications auto-close,
    // so a single reading can miss them entirely and pass for the wrong
    // reason. The most that was ever on screen is what matters.
    // Targeted at the notification container rather than role=alert, since the
    // inline notice above is an Alert and carries that role too.
    /* eslint-disable playwright/no-wait-for-timeout --
       Sampling is the point: there is no state to wait for, since what is
       being asserted is that something never appears. */
    let peakToasts = 0;
    for (let i = 0; i < 12; i++) {
      const count = await page.locator('.mantine-Notification-root').count();
      peakToasts = Math.max(peakToasts, count);
      await page.waitForTimeout(250);
    }
    /* eslint-enable playwright/no-wait-for-timeout */
    expect(peakToasts).toBe(0);

    // And the controls the toasts used to cover are still reachable.
    await expect(page.getByRole('button', { name: 'Select Plugins' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an admin is not shown the permission notice', async ({ page }) => {
  await page.goto('/ui/plugin_metadata');
  await expect(page.getByRole('button', { name: 'Select Plugins' })).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText('Your role on this instance may not read plugin metadata.')
  ).toHaveCount(0);
});

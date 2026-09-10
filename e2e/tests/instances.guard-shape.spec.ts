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
 * The shapes themselves are covered by src/utils/list-shape.test.ts, which is a
 * predicate over a value and belongs in a unit test. What needs a browser is
 * the reach of the thing: a malformed instance list used to take the whole
 * dashboard down, and the pages it reaches are the point.
 *
 * A real misrouted proxy sends text/html and a raw body, so that is what is
 * sent here — a JSON-encoded string would only exercise axios's fallback
 * parsing and would keep passing if the client ever stopped doing that.
 */

const misroutedProxy = (page: import('@playwright/test').Page) =>
  page.route('**/api/v1/instances', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>index</body></html>',
    })
  );

test('the guarded pages explain themselves instead of falling over', async ({
  page,
}) => {
  await misroutedProxy(page);
  await page.goto('/ui/routes');

  // Asserted first: it is the positive claim, and it is what fails when the
  // guard regresses. The absence check below only means something once the
  // page has settled — placed first it passes on an empty document.
  //
  // And it says what actually happened. "No APISIX gateway connected" would be
  // a lie here and a costly one: it invites someone to register a gateway they
  // may already have, when the truth is that the list could not be read.
  await expect(page.getByText('Instance list unavailable')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText('No APISIX gateway connected')).toHaveCount(0);
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
  await expect(page.locator('header')).toBeVisible();
});

test('and still says "none registered" when that is the truth', async ({ page }) => {
  // The distinction only means something if the other side of it still works.
  await page.route('**/api/v1/instances', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('/ui/routes');

  await expect(page.getByText('No APISIX gateway connected')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText('Instance list unavailable')).toHaveCount(0);
});

test('and so does the page its only way out leads to', async ({ page }) => {
  // The empty state offers one escape: "Add an instance". It led to /ui/instances,
  // which is outside the guard, wrote the same unvalidated payload into the
  // atom, and threw on `instances.map` — the crash the fix removed, one click
  // away from where it was removed.
  await misroutedProxy(page);
  await page.goto('/ui/instances');

  await expect(page.getByRole('button', { name: 'Add Instance' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText('Failed to load the dashboard')).toHaveCount(0);
});

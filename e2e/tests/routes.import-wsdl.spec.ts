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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { routesPom } from '@e2e/pom/routes';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

const wsdl = readFileSync(
  fileURLToPath(new URL('../fixtures/billing.wsdl', import.meta.url)),
  'utf8',
);

test('imports per-operation routes from pasted WSDL', async ({ page }) => {
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);

  await page.getByRole('button', { name: 'Import from WSDL' }).click();

  // Paste mode (Upload / Paste tab is the default), per-operation (default),
  // switch upstream binding to auto-create.
  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  // Preview shows 1 service / 2 operations.
  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();

  // Trigger import and assert success banner.
  await page.getByRole('button', { name: /Create 2 route\(s\)/ }).click();
  await expect(page.getByText('2 route(s) created from WSDL')).toBeVisible({
    timeout: 15000,
  });
});

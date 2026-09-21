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
import { upstreamsPom } from '@e2e/pom/upstreams';
import { test } from '@e2e/utils/test';
import {
  uiAddNode,
  uiDiscardDraftIfPresent,
  uiWizardNext,
} from '@e2e/utils/ui/upstreams';
import { expect } from '@playwright/test';

// The dashboard refuses to connect to an internal address, so Test Connection
// never tries one. It used to show such a node as down, which in a Docker or
// Kubernetes deployment is nearly every upstream (#304). A node it did try and
// could not reach still reads as a failure.
test('an internal address reads as not tested, not as down', async ({ page }) => {
  await upstreamsPom.toAdd(page);
  await upstreamsPom.isAddPage(page);
  await uiDiscardDraftIfPresent(page);

  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .first()
    .fill('e2e-test-connection');
  await uiWizardNext(page);

  await uiAddNode(page, '10.0.0.1', 8080);
  await uiAddNode(page, 'no-such-host.invalid', 80);
  await page.getByRole('button', { name: 'Test Connection' }).click();

  const internal = page.getByRole('alert').filter({ hasText: '10.0.0.1:8080' });
  await expect(internal).toContainText(
    'Not tested: the dashboard does not connect to internal addresses'
  );
  await expect(internal).not.toContainText('Connection failed');

  const unknown = page
    .getByRole('alert')
    .filter({ hasText: 'no-such-host.invalid:80' });
  await expect(unknown).toContainText('Connection failed');
});

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
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  uiCheckUpstreamRequiredFields,
  uiFillUpstreamRequiredFields,
} from '@e2e/utils/ui/upstreams';
import { expect } from '@playwright/test';

import { deleteAllUpstreams } from '@/apis/upstreams';
import type { APISIXType } from '@/types/schema/apisix';

const upstreamName = randomId('test-upstream');
const nodes: APISIXType['UpstreamNode'][] = [
  { host: 'test.com' },
  { host: 'test2.com', port: 80 },
];

test.beforeAll(async () => {
  await deleteAllUpstreams(e2eReq);
});

test('should CRUD upstream with required fields', async ({ page }) => {
  await upstreamsPom.toIndex(page);
  await upstreamsPom.isIndexPage(page);

  await upstreamsPom.getAddUpstreamBtn(page).click();
  await upstreamsPom.isAddPage(page);

  await test.step('cannot advance without required fields', async () => {
    // The wizard replaced the old "invalid configuration" toast with per-step
    // validation: clicking "Next" with an empty required field keeps the
    // wizard on the current step (the Name input stays visible).
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  });

  await test.step('submit with required fields', async () => {
    await uiFillUpstreamRequiredFields(page, {
      name: upstreamName,
      nodes,
    });
    await upstreamsPom.getAddBtn(page).click();
    await uiHasToastMsg(page, {
      hasText: 'Add Upstream Successfully',
    });
    // The wizard redirects back to the list page on success.
    await upstreamsPom.isIndexPage(page);
  });

  await test.step('can see upstream in list page', async () => {
    await expect(page.getByRole('cell', { name: upstreamName })).toBeVisible();
  });

  await test.step('navigate to upstream detail page', async () => {
    await page
      .getByRole('row', { name: upstreamName })
      .getByRole('button', { name: 'View' })
      .click();
    await upstreamsPom.isDetailPage(page);
    // Verify ID exists (step 1 of the read-only wizard).
    const ID = page.getByRole('textbox', { name: 'ID', exact: true });
    await expect(ID).toBeVisible();
    await expect(ID).toBeDisabled();
    await uiCheckUpstreamRequiredFields(page, {
      name: upstreamName,
      nodes,
    });
  });

  await test.step('edit and update upstream in detail page', async () => {
    // Enter edit mode — the wizard fields become editable.
    await page.getByRole('button', { name: 'Edit' }).click();


    // The wizard keeps whatever step the read-only view was on;
    // go back to step 1 (Basic) explicitly.
    await page.getByRole('button', { name: /Basic/ }).first().click();
    // Step 1 (Basic) is active: update description + add a label.
    const nameField = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(nameField).toBeEnabled();

    await page.getByLabel('Description').fill('Updated description for testing');

    const labelsField = page.getByRole('textbox', { name: 'Labels' });
    await expect(labelsField).toBeEnabled();
    await labelsField.click();
    await labelsField.fill('version:v1');
    await labelsField.press('Enter');
    await expect(labelsField).toHaveValue('');

    // Advance to the Nodes step and update the first node's host.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const firstHost = page.getByPlaceholder('Hostname or IP').first();
    await firstHost.fill('updated-test.com');
    await expect(firstHost).toHaveValue('updated-test.com');
    await page.locator('h1').first().click();

    // Advance through Connection to the Preview step, then Submit.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();

    await uiHasToastMsg(page, {
      hasText: 'success',
    });

    // Back in read-only detail mode.
    await upstreamsPom.isDetailPage(page);

    // Verify the updated description + label (step 1 / Basic tab).
    await page.getByRole('button', { name: 'Basic', exact: true }).click();
    await expect(page.getByLabel('Description')).toHaveValue(
      'Updated description for testing'
    );
    await expect(page.getByText('version:v1')).toBeVisible();

    // Verify the updated node host (step 2).
    await page.getByRole('button', { name: 'Nodes', exact: true }).click();
    await expect(
      page.getByPlaceholder('Hostname or IP').first()
    ).toHaveValue('updated-test.com');

    // Return to list page and verify the upstream exists.
    await upstreamsPom.getUpstreamNavBtn(page).click();
    await upstreamsPom.isIndexPage(page);
    const row = page.getByRole('row', { name: upstreamName });
    await expect(row).toBeVisible();
  });

  await test.step('delete upstream in detail page', async () => {
    await page
      .getByRole('row', { name: upstreamName })
      .getByRole('button', { name: 'View' })
      .click();
    await upstreamsPom.isDetailPage(page);

    await page.getByRole('button', { name: 'Delete' }).click();

    await page
      .getByRole('dialog', { name: 'Delete Upstream' })
      .getByRole('button', { name: 'Delete' })
      .click();

    // will redirect to upstreams page
    await upstreamsPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Upstream Successfully',
    });
    await expect(page.getByRole('cell', { name: upstreamName })).toBeHidden();
  });
});

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
import { servicesPom } from '@e2e/pom/services';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import {
  uiCheckServiceRequiredFields,
  uiFillServiceRequiredFields,
} from '@e2e/utils/ui/services';
import { expect } from '@playwright/test';

import { deleteAllServices } from '@/apis/services';

test.describe.configure({ mode: 'serial' });

const serviceName = randomId('test-service');

test.beforeAll(async () => {
  await deleteAllServices(e2eReq);
});

test('should CRUD service with required fields', async ({ page }) => {
  await servicesPom.toIndex(page);
  await servicesPom.isIndexPage(page);

  await servicesPom.getAddServiceBtn(page).click();
  await servicesPom.isAddPage(page);

  await test.step('submit with required fields', async () => {
    // Walk the wizard (name + a single upstream node) to the Preview step.
    await uiFillServiceRequiredFields(page, {
      name: serviceName,
    });

    await servicesPom.getSubmitBtn(page).click();

    await uiHasToastMsg(page, {
      hasText: 'Add Service Successfully',
    });
  });

  await test.step('lands on list page; open the created service', async () => {
    // The wizard navigates back to the services list after creation
    await servicesPom.isIndexPage(page);
    await page
      .getByRole('row', { name: serviceName })
      .getByRole('button', { name: 'View' })
      .click();
    await servicesPom.isDetailPage(page);
    await uiCheckServiceRequiredFields(page, {
      name: serviceName,
    });
  });

  await test.step('can see service in list page', async () => {
    await servicesPom.getServiceNavBtn(page).click();
    await expect(page.getByRole('cell', { name: serviceName })).toBeVisible();
  });

  await test.step('navigate to service detail page', async () => {
    await page
      .getByRole('row', { name: serviceName })
      .getByRole('button', { name: 'View' })
      .click();
    await servicesPom.isDetailPage(page);
    await uiCheckServiceRequiredFields(page, { name: serviceName });
  });

  await test.step('edit and update service in detail page', async () => {
    // Enter edit mode (wizard becomes editable, starting at step 1).
    await page.getByRole('button', { name: 'Edit' }).click();

    const nameField = page
      .getByRole('textbox', { name: 'Name', exact: true })
      .first();
    await expect(nameField).toBeEnabled();

    // Update the description on the Basic step.
    await page
      .getByLabel('Description')
      .first()
      .fill('Updated description for testing');

    // Walk to the Preview step (Basic -> Upstream -> Plugin -> Preview) and
    // submit the edit.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();

    await uiHasToastMsg(page, {
      hasText: 'success',
    });

    await servicesPom.isDetailPage(page);

    // Verify the updated description on the Basic step.
    await page
      .getByRole('button', { name: 'Basic Information', exact: true })
      .click();
    await expect(page.getByLabel('Description').first()).toHaveValue(
      'Updated description for testing'
    );

    // Return to list page and verify the service exists.
    await servicesPom.getServiceNavBtn(page).click();
    await servicesPom.isIndexPage(page);
    const row = page.getByRole('row', { name: serviceName });
    await expect(row).toBeVisible();
  });

  await test.step('delete service in detail page', async () => {
    await page
      .getByRole('row', { name: serviceName })
      .getByRole('button', { name: 'View' })
      .click();
    await servicesPom.isDetailPage(page);

    await page.getByRole('button', { name: 'Delete' }).click();

    await page
      .getByRole('dialog', { name: 'Delete Service' })
      .getByRole('button', { name: 'Delete' })
      .click();

    await servicesPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Service Successfully',
    });
    await expect(page.getByRole('cell', { name: serviceName })).toBeHidden();
  });
});

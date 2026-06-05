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
  uiCheckServiceAllFields,
  uiFillServiceAllFields,
} from '@e2e/utils/ui/services';
import { expect } from '@playwright/test';

import { deleteAllServices } from '@/apis/services';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await deleteAllServices(e2eReq);
});

test('should CRUD service with all fields', async ({ page }) => {
  const serviceNameWithAllFields = randomId('test-service-full');
  const description =
    'This is a test description for the service with all fields';

  // Navigate to the service list page
  await servicesPom.toIndex(page);
  await servicesPom.isIndexPage(page);

  // Click the add service button
  await servicesPom.getAddServiceBtn(page).click();
  await servicesPom.isAddPage(page);

  // Walk the wizard filling all fields the redesign exposes.
  await uiFillServiceAllFields(test, page, {
    name: serviceNameWithAllFields,
    desc: description,
  });

  // Submit from the Preview step.
  await servicesPom.getSubmitBtn(page).click();

  await uiHasToastMsg(page, {
    hasText: 'Add Service Successfully',
  });

  // The wizard navigates back to the services list after creation;
  // open the created service from the list
  await servicesPom.isIndexPage(page);
  await page
    .getByRole('row', { name: serviceNameWithAllFields })
    .getByRole('button', { name: 'View' })
    .click();
  await servicesPom.isDetailPage(page);

  await test.step('verify all fields in detail page', async () => {
    await uiCheckServiceAllFields(page, {
      name: serviceNameWithAllFields,
      desc: description,
    });
  });

  await test.step('return to list page and verify', async () => {
    await servicesPom.getServiceNavBtn(page).click();
    await servicesPom.isIndexPage(page);

    await expect(page.locator('.ant-table-tbody')).toBeVisible();
    await expect(page.getByText(serviceNameWithAllFields)).toBeVisible();
  });

  await test.step('delete the created service', async () => {
    const row = page.locator('tr').filter({ hasText: serviceNameWithAllFields });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'View' }).click();
    await servicesPom.isDetailPage(page);

    await page.getByRole('button', { name: 'Delete' }).click();

    const deleteDialog = page.getByRole('dialog', { name: 'Delete Service' });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();

    await servicesPom.isIndexPage(page);
    await uiHasToastMsg(page, {
      hasText: 'Delete Service Successfully',
    });

    await expect(page.getByText(serviceNameWithAllFields)).toBeHidden();

    await page.reload();
    await servicesPom.isIndexPage(page);
    await expect(page.getByText(serviceNameWithAllFields)).toBeHidden();
  });
});

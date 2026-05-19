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
import { consumerGroupsPom } from '@e2e/pom/consumer_groups';
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { e2eReq } from '@e2e/utils/req';

ownershipMatrixSuite({
  resourceLabel: 'consumer_group',
  pom: {
    goto: { toIndex: consumerGroupsPom.toIndex },
    locator: {
      rowByName: (page, name) =>
        page.getByRole('row').filter({ hasText: name }),
    },
  },
  createMinimal: async (page, name) => {
    // Consumer groups don't have a UI "name" — they're keyed by ID,
    // which is what shows up in the list. So we use the ownership
    // helper's `name` argument as the ID. The form also requires at
    // least one plugin; we add basic-auth with default config.
    await consumerGroupsPom.toIndex(page);
    await consumerGroupsPom.getAddConsumerGroupBtn(page).click();

    const idField = page.getByRole('textbox', { name: 'ID', exact: true });
    await idField.clear();
    await idField.fill(name);

    await page.getByRole('button', { name: 'Select Plugins' }).click();
    const dialog = page.getByRole('dialog', { name: 'Select Plugins' });
    await dialog.getByPlaceholder('Search').fill('basic-auth');
    await dialog
      .getByTestId('plugin-basic-auth')
      .getByRole('button', { name: 'Add' })
      .click();
    const pluginDialog = page.getByRole('dialog', { name: 'Add Plugin' });
    await pluginDialog.getByRole('button', { name: 'Add' }).click();

    await consumerGroupsPom.getAddBtn(page).click();
    await consumerGroupsPom.toIndex(page);
  },
  cleanup: async (_page, name) => {
    try {
      await e2eReq.delete(`/consumer_groups/${name}`);
    } catch {
      /* best-effort */
    }
  },
});

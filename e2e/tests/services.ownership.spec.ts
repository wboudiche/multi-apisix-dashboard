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
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { e2eReq } from '@e2e/utils/req';
import { uiFillServiceRequiredFields } from '@e2e/utils/ui/services';

ownershipMatrixSuite({
  resourceLabel: 'service',
  pom: {
    goto: { toIndex: servicesPom.toIndex },
    locator: {
      rowByName: (page, name) =>
        page.getByRole('row').filter({ hasText: name }),
    },
  },
  createMinimal: async (page, name) => {
    await servicesPom.toIndex(page);
    await servicesPom.getAddServiceBtn(page).click();
    await uiFillServiceRequiredFields(page, { name });
    await servicesPom.getSubmitBtn(page).click();
    await servicesPom.toIndex(page);
  },
  cleanup: async (_page, name) => {
    try {
      const list = await e2eReq.get('/services');
      const row = list.data?.list?.find(
        (r: { value: { name?: string } }) => r.value?.name === name
      );
      if (row?.value?.id) {
        await e2eReq.delete(`/services/${row.value.id}`);
      }
    } catch {
      /* best-effort */
    }
  },
});

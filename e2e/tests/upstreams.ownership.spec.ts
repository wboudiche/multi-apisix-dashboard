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
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { e2eReq } from '@e2e/utils/req';
import { uiFillUpstreamRequiredFields } from '@e2e/utils/ui/upstreams';

ownershipMatrixSuite({
  resourceLabel: 'upstream',
  pom: {
    goto: { toIndex: upstreamsPom.toIndex },
    locator: {
      rowByName: (page, name) =>
        page.getByRole('row').filter({ hasText: name }),
    },
  },
  createMinimal: async (page, name) => {
    await upstreamsPom.toIndex(page);
    await upstreamsPom.getAddUpstreamBtn(page).click();
    await uiFillUpstreamRequiredFields(page, {
      name,
      nodes: [
        { host: 'httpbin.org' },
        { host: 'example.com' },
      ],
    });
    await upstreamsPom.getAddBtn(page).click();
    await upstreamsPom.toIndex(page);
  },
  cleanup: async (_page, name) => {
    try {
      const list = await e2eReq.get('/upstreams');
      const row = list.data?.list?.find(
        (r: { value: { name?: string } }) => r.value?.name === name
      );
      if (row?.value?.id) {
        await e2eReq.delete(`/upstreams/${row.value.id}`);
      }
    } catch {
      /* best-effort */
    }
  },
});

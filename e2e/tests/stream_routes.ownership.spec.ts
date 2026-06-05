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
import { streamRoutesPom } from '@e2e/pom/stream_routes';
import { getFixtures } from '@e2e/utils/fixtures';
import { ownershipMatrixSuite } from '@e2e/utils/ownership-test-helper';
import { e2eReq } from '@e2e/utils/req';
import {
  uiFillStreamRouteRequiredFields,
  uiSelectStreamRouteUpstream,
} from '@e2e/utils/ui/stream_routes';

import { API_UPSTREAMS } from '@/config/constant';

// Stream routes have no human name. We synthesise a unique server_port
// from the ownership helper's `name` argument (deterministic hash into
// the 9000-9999 range) and use that port as the visible row identifier.
const portFromName = (name: string): number => {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return 9000 + (Math.abs(hash) % 1000);
};

ownershipMatrixSuite({
  resourceLabel: 'stream_route',
  pom: {
    goto: { toIndex: streamRoutesPom.toIndex },
    locator: {
      rowByName: (page, name) =>
        page
          .getByRole('row')
          .filter({ hasText: String(portFromName(name)) }),
    },
  },
  createMinimal: async (page, name) => {
    const port = portFromName(name);
    // Seed an upstream via the API (the redesigned form references an
    // existing upstream instead of an inline node editor). It must be owned
    // by the Backend Team, otherwise dev_user's select won't list it —
    // admins may set the owning team via the X-Team-ID header.
    const upstreamName = `sr-own-upstream-${port}`;
    await e2eReq
      .post(
        API_UPSTREAMS,
        {
          name: upstreamName,
          nodes: [{ host: '127.0.0.2', port: 8080, weight: 1 }],
        },
        { headers: { 'X-Team-ID': getFixtures().backendTeamId } }
      )
      .catch(() => {
        /* may already exist from a retry */
      });

    await streamRoutesPom.toAdd(page);
    await uiFillStreamRouteRequiredFields(page, {
      server_addr: '127.0.1.99',
      server_port: port,
    });
    await uiSelectStreamRouteUpstream(page, upstreamName);

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await streamRoutesPom.toIndex(page);
  },
  cleanup: async (_page, name) => {
    const port = portFromName(name);
    try {
      const list = await e2eReq.get('/stream_routes');
      const row = list.data?.list?.find(
        (r: { value: { server_port?: number } }) =>
          r.value?.server_port === port
      );
      if (row?.value?.id) {
        await e2eReq.delete(`/stream_routes/${row.value.id}`);
      }
    } catch {
      /* best-effort */
    }
  },
});

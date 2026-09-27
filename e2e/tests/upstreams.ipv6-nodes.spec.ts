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
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { NODE_HOST_PH, NODE_PORT_PH } from '@e2e/utils/ui/nodes';
import { expect } from '@playwright/test';

/**
 * APISIX stores an IPv6 node bracketed, `{"[fd00::1]:8080": 1}`. The editor
 * and the preview used to read that key with two different parsers: the
 * editor showed `fd00::1`, the preview `[fd00::1]`, and a bare `fd00::1` key
 * was cut into host `fd00:` on port 1 (#315).
 */

const UPSTREAM_ID = 'e2e-ipv6-nodes';
const PATH = `/api/v1/apisix/admin/upstreams/${UPSTREAM_ID}`;

test('the editor and the preview read an IPv6 node the same way', async ({
  page,
}) => {
  const fx = getFixtures();
  const token = await loginAdmin();
  const headers = { 'X-Instance-ID': fx.localInstanceId };
  await apiFetch(PATH, token, {
    method: 'PUT',
    headers,
    json: {
      name: UPSTREAM_ID,
      type: 'roundrobin',
      nodes: { '[fd00::1]:8080': 1 },
    },
  });

  try {
    await page.goto(`/ui/upstreams/detail/${UPSTREAM_ID}`);
    await page.getByRole('button', { name: 'Nodes' }).click();

    await expect(
      page.getByPlaceholder(NODE_HOST_PH, { exact: true })
    ).toHaveValue('fd00::1', { timeout: 30000 });
    await expect(
      page.getByPlaceholder(NODE_PORT_PH, { exact: true })
    ).toHaveValue('8080');

    await page.getByRole('button', { name: 'Preview' }).click();
    const row = page.getByRole('row').filter({ hasText: 'fd00' });
    await expect(row).toContainText('fd00::1');
    await expect(row).toContainText('8080');
  } finally {
    await apiFetch(PATH, token, { method: 'DELETE', headers }).catch(
      () => undefined
    );
  }
});

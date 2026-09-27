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
import { deleteUpstreamsByNamePrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { NODE_HOST_PH, NODE_PORT_PH } from '@e2e/utils/ui/nodes';
import { expect, type Page } from '@playwright/test';

/**
 * APISIX stores an IPv6 node bracketed, `{"[fd00::1]:8080": 1}`. The editor
 * and the preview used to read that key with two different parsers: the
 * editor showed `fd00::1`, the preview `[fd00::1]`, and a bare `fd00::1` key
 * was cut into host `fd00:` on port 1 (#315).
 */

const PREFIX = 'e2e-ipv6-nodes';

// Two runs against one gateway would otherwise share an id, and the second
// would delete the first one's upstream mid-assertion.
test.afterAll(async () => {
  await deleteUpstreamsByNamePrefix(PREFIX);
});

const seed = async (id: string, nodes: Record<string, number>) => {
  const fx = getFixtures();
  const token = await loginAdmin();
  const headers = { 'X-Instance-ID': fx.localInstanceId };
  const path = `/api/v1/apisix/admin/upstreams/${id}`;
  await apiFetch(path, token, {
    method: 'PUT',
    headers,
    json: { name: id, type: 'roundrobin', nodes },
  });
  return () =>
    apiFetch(path, token, { method: 'DELETE', headers }).catch(() => undefined);
};

/** The host and port as the editor reads them, then as the preview shows them. */
const readBothViews = async (page: Page, id: string) => {
  await page.goto(`/ui/upstreams/detail/${id}`);
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();

  const host = page.getByPlaceholder(NODE_HOST_PH, { exact: true });
  await expect(host).not.toHaveValue('', { timeout: 30000 });
  const editor = {
    host: await host.inputValue(),
    port: await page.getByPlaceholder(NODE_PORT_PH, { exact: true }).inputValue(),
  };

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const cells = page.getByRole('row').filter({ hasText: 'fd00' }).getByRole('cell');
  await expect(cells.first()).toBeVisible({ timeout: 30000 });
  return {
    editor,
    preview: {
      host: (await cells.nth(0).textContent())?.trim(),
      port: (await cells.nth(1).textContent())?.trim(),
    },
  };
};

test('the editor and the preview read a bracketed IPv6 node the same way', async ({
  page,
}) => {
  const id = randomId(PREFIX);
  const clean = await seed(id, { '[fd00::1]:8080': 1 });
  try {
    const { editor, preview } = await readBothViews(page, id);

    // Exactly the address, brackets and all removed: the previews used to
    // show "[fd00::1]", which a substring check would have accepted.
    expect(editor).toEqual({ host: 'fd00::1', port: '8080' });
    expect(preview).toEqual({ host: 'fd00::1', port: '8080' });
  } finally {
    await clean();
  }
});

test('a bare IPv6 address is not cut in half', async ({ page }) => {
  const id = randomId(PREFIX);
  const clean = await seed(id, { 'fd00::1': 2 });
  try {
    const { editor, preview } = await readBothViews(page, id);

    // The previews used to read this as host "fd00:" on port 1, and the
    // editor offered to save it that way.
    expect(editor).toEqual({ host: 'fd00::1', port: '' });
    expect(preview).toEqual({ host: 'fd00::1', port: '-' });
  } finally {
    await clean();
  }
});

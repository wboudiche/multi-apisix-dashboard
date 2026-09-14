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
import { randomId } from '@e2e/utils/common';
import { getFixtures } from '@e2e/utils/fixtures';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';

/**
 * Cancel on a detail page put it back to read-only and nothing more: the form
 * kept the values being edited, showed them as the resource's, and the next
 * Edit and save sent them (#219).
 */

const PROXY = '/api/v1/apisix/admin';
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });
const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };
const limitCount = { 'limit-count': { count: 2, time_window: 60, rejected_code: 503 } };

type Kind = {
  name: string;
  type: string;
  singular: string;
  wizard: boolean;
  body: (id: string) => Record<string, unknown>;
  /** Where the resource is written; a consumer is written to the collection. */
  seedPath?: (id: string) => string;
  /** The field edited and cancelled; the description unless the form has none. */
  field?: { label: string; key: string; original: string; changed: string };
};

const DESCRIPTION = { label: 'Description', key: 'desc', original: 'original', changed: 'changed' };
const PROTO_CONTENT = 'syntax = "proto3"; package e2e; message A { string a = 1; }';

const KINDS: Kind[] = [
  { name: 'route', type: 'routes', singular: 'Route', wizard: true,
    body: (id) => ({ name: id, desc: 'original', uri: `/${id}`, upstream }) },
  { name: 'service', type: 'services', singular: 'Service', wizard: true,
    body: (id) => ({ name: id, desc: 'original', upstream }) },
  { name: 'upstream', type: 'upstreams', singular: 'Upstream', wizard: true,
    body: (id) => ({ name: id, desc: 'original', ...upstream }) },
  { name: 'consumer group', type: 'consumer_groups', singular: 'Consumer Group', wizard: false,
    body: () => ({ desc: 'original', plugins: limitCount }) },
  { name: 'plugin config', type: 'plugin_configs', singular: 'Plugin Config', wizard: false,
    body: () => ({ desc: 'original', plugins: limitCount }) },
  { name: 'consumer', type: 'consumers', singular: 'Consumer', wizard: false,
    body: (id) => ({ username: id, desc: 'original' }),
    seedPath: () => `${PROXY}/consumers` },
  // A proto's form has no description: its content is what is edited.
  { name: 'proto', type: 'protos', singular: 'Proto', wizard: false,
    body: () => ({ content: PROTO_CONTENT }),
    field: {
      label: 'Content',
      key: 'content',
      original: PROTO_CONTENT,
      changed: PROTO_CONTENT.replace('message A', 'message B'),
    } },
  { name: 'stream route', type: 'stream_routes', singular: 'Stream Route', wizard: false,
    body: () => ({ desc: 'original', server_port: 9100 + Math.floor(Math.random() * 800), upstream }) },
];

/** Leave editing with Cancel, confirming it where the wizard asks. */
const cancelEdit = async (page: Page, wizard: boolean) => {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  if (wizard) await page.getByRole('button', { name: 'Leave', exact: true }).click();
};

/** Save what the form holds: the wizard from its last step, a plain form with Save. */
const saveEdit = async (page: Page, wizard: boolean) => {
  if (!wizard) {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return;
  }
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  for (let step = 0; step < 6 && !(await submit.isVisible()); step++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await submit.click();
};

for (const kind of KINDS) {
  test(`${kind.name}: a cancelled edit is neither shown nor saved later`, async ({ page }) => {
    const token = await loginAdmin();
    const id = randomId(`e2e_cancel_${kind.type}`);
    await apiFetch(kind.seedPath?.(id) ?? `${PROXY}/${kind.type}/${id}`, token, {
      method: 'PUT',
      headers: onLocal(),
      json: kind.body(id),
    });

    const field = kind.field ?? DESCRIPTION;
    try {
      await page.goto(`/ui/${kind.type}/detail/${id}`);
      const input = page.getByRole('textbox', { name: field.label, exact: true });
      await expect(input).toHaveValue(field.original, { timeout: 15000 });

      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await input.fill(field.changed);
      await cancelEdit(page, kind.wizard);
      // The page shows the resource again, not the edit that was cancelled.
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
      await expect(input).toHaveValue(field.original);

      // And an untouched save afterwards keeps it.
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await saveEdit(page, kind.wizard);
      await expect(page.getByText(`Edit ${kind.singular} Successfully`)).toBeVisible({
        timeout: 15000,
      });
      const stored = (await apiFetch(`${PROXY}/${kind.type}/${id}`, token, {
        headers: onLocal(),
      })) as { value: Record<string, unknown> };
      expect(stored.value[field.key]).toBe(field.original);
    } finally {
      await apiFetch(`${PROXY}/${kind.type}/${id}`, token, {
        method: 'DELETE',
        headers: onLocal(),
      }).catch(() => undefined);
    }
  });
}

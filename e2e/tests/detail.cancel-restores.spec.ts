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
  /** The wizard's steps, for walking from the first to the last; 0 for a plain form. */
  steps: number;
  body: (id: string) => Record<string, unknown>;
  /** Where the resource is written; a consumer is written to the collection. */
  seedPath?: (id: string) => string;
  /** The field edited and cancelled; the description unless the form has none. */
  field?: { label: string; key: string; original: string; changed: string };
};

const DESCRIPTION = { label: 'Description', key: 'desc', original: 'original', changed: 'changed' };
const PROTO_CONTENT = 'syntax = "proto3"; package e2e; message A { string a = 1; }';

const KINDS: Kind[] = [
  { name: 'route', type: 'routes', singular: 'Route', steps: 5,
    body: (id) => ({ name: id, desc: 'original', uri: `/${id}`, upstream }) },
  { name: 'service', type: 'services', singular: 'Service', steps: 4,
    body: (id) => ({ name: id, desc: 'original', upstream }) },
  { name: 'upstream', type: 'upstreams', singular: 'Upstream', steps: 4,
    body: (id) => ({ name: id, desc: 'original', ...upstream }) },
  { name: 'consumer group', type: 'consumer_groups', singular: 'Consumer Group', steps: 0,
    body: () => ({ desc: 'original', plugins: limitCount }) },
  { name: 'plugin config', type: 'plugin_configs', singular: 'Plugin Config', steps: 0,
    body: () => ({ desc: 'original', plugins: limitCount }) },
  { name: 'consumer', type: 'consumers', singular: 'Consumer', steps: 0,
    body: (id) => ({ username: id, desc: 'original' }),
    seedPath: () => `${PROXY}/consumers` },
  // A proto's form has no description: its content is what is edited.
  { name: 'proto', type: 'protos', singular: 'Proto', steps: 0,
    body: () => ({ content: PROTO_CONTENT }),
    field: {
      label: 'Content',
      key: 'content',
      original: PROTO_CONTENT,
      changed: PROTO_CONTENT.replace('message A', 'message B'),
    } },
  { name: 'stream route', type: 'stream_routes', singular: 'Stream Route', steps: 0,
    body: () => ({ desc: 'original', server_port: 9100 + Math.floor(Math.random() * 800), upstream }) },
];

/** Leave editing with Cancel, confirming it where the wizard asks. */
const cancelEdit = async (page: Page, wizard: boolean) => {
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  if (wizard) await page.getByRole('button', { name: 'Leave', exact: true }).click();
};

/**
 * Save what the form holds: a plain form with Save, the wizard by walking
 * `nexts` steps on and submitting. A fixed number of Nexts rather than "until
 * Submit shows": each press advances once, however soon the next one comes.
 */
const saveEdit = async (page: Page, nexts: number | null) => {
  if (nexts === null) {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    return;
  }
  for (let step = 0; step < nexts; step++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
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
      await cancelEdit(page, kind.steps > 0);
      // The page shows the resource again, not the edit that was cancelled.
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
      await expect(input).toHaveValue(field.original);

      // And an untouched save afterwards keeps it.
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await saveEdit(page, kind.steps > 0 ? kind.steps - 1 : null);
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

test('route: a cancelled request override is neither shown nor saved later', async ({ page }) => {
  // The Request Override section keeps its own state and copied it from the
  // form only when the route had a proxy-rewrite. An override added to a route
  // without one outlived the reset: the read-only page showed it, and the next
  // change to any override field wrote it back into the plugins (#219).
  const token = await loginAdmin();
  const id = randomId('e2e_cancel_override');
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { name: id, uri: `/${id}`, upstream },
  });

  try {
    await page.goto(`/ui/routes/detail/${id}`);
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(id, {
      timeout: 15000,
    });
    // To the Request Override step, the third, and add a scheme override.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await saveEditTo(page, 2);
    await page.locator('label:has-text("HTTPS")').click();
    await cancelEdit(page, true);

    // Read-only, the section shows only when there is an override to show.
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByText('Scheme', { exact: true })).toHaveCount(0);

    // Edit again, change only the URI, and save: the scheme stays as stored.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('label:has-text("Static")').first().click();
    await page.locator('input[placeholder="/new/path"]').fill('/rewritten');
    await saveEdit(page, 2);
    await expect(page.getByText('Edit Route Successfully')).toBeVisible({ timeout: 15000 });

    const stored = (await apiFetch(`${PROXY}/routes/${id}`, token, { headers: onLocal() })) as {
      value: { plugins?: Record<string, { scheme?: string; uri?: string }> };
    };
    expect(stored.value.plugins?.['proxy-rewrite']?.uri).toBe('/rewritten');
    expect(stored.value.plugins?.['proxy-rewrite']?.scheme).toBeUndefined();
  } finally {
    await apiFetch(`${PROXY}/routes/${id}`, token, { method: 'DELETE', headers: onLocal() }).catch(
      () => undefined
    );
  }
});

/** Walk `nexts` steps on in an editing wizard, without submitting. */
async function saveEditTo(page: Page, nexts: number) {
  for (let step = 0; step < nexts; step++) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
}

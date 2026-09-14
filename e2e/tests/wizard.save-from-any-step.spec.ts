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
 * While a detail page is read-only, any step of its wizard can be clicked.
 * Going straight to a later one that way, then Edit, Next and Submit, saved
 * without the fields of the first step: those were registered while the form
 * was disabled, and react-hook-form leaves every such field out of what it
 * submits until it is registered again — which only a step on screen does. On
 * a route that meant PUT /routes/undefined, refused with a schema error the
 * page showed as "Failed to submit" (#215).
 */

const PROXY = '/api/v1/apisix/admin';
const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });
const upstream = { type: 'roundrobin', nodes: { '127.0.0.1:1980': 1 } };

/** The PUTs a page sends for one kind of resource, by path. */
const putsTo = (page: Page, type: string) => {
  const paths: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes(`/apisix/admin/${type}/`)) {
      paths.push(new URL(request.url()).pathname);
    }
  });
  return paths;
};

/** Open a detail page, jump to `step` while read-only, and save from there. */
const saveFromJumpedStep = async (page: Page, url: string, name: string, step: RegExp) => {
  await page.goto(url);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name, {
    timeout: 15000,
  });
  await page.getByRole('button', { name: step }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Exact: the last step's own button is named "Preview Review and submit".
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
};

const stored = async (token: string, type: string, id: string) =>
  ((await apiFetch(`${PROXY}/${type}/${id}`, token, { headers: onLocal() })) as {
    value: Record<string, unknown>;
  }).value;

const remove = async (token: string, type: string, ids: string[]) => {
  for (const id of ids) {
    await apiFetch(`${PROXY}/${type}/${id}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
};

test('a route saves whole from a step reached while read-only', async ({ page }) => {
  const token = await loginAdmin();
  const id = randomId('e2e-jumped-route');
  const puts = putsTo(page, 'routes');
  await apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { name: id, uri: `/${id}`, upstream },
  });

  try {
    await saveFromJumpedStep(page, `/ui/routes/detail/${id}`, id, /^Plugins Config/);
    await expect(page.getByText('Edit Route Successfully')).toBeVisible({ timeout: 15000 });
    expect(puts).toEqual([`${PROXY}/routes/${id}`]);

    const value = await stored(token, 'routes', id);
    expect(value.name).toBe(id);
    expect(value.uri).toBe(`/${id}`);
    expect((value.upstream as { nodes?: unknown } | undefined)?.nodes).toBeTruthy();
  } finally {
    await remove(token, 'routes', [id, 'undefined']);
  }
});

test('a service saves whole from a step reached while read-only', async ({ page }) => {
  const token = await loginAdmin();
  const id = randomId('e2e-jumped-service');
  const puts = putsTo(page, 'services');
  await apiFetch(`${PROXY}/services/${id}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { name: id, desc: 'kept', upstream },
  });

  try {
    await saveFromJumpedStep(page, `/ui/services/detail/${id}`, id, /^Plugin/);
    await expect(page.getByText('Edit Service Successfully')).toBeVisible({ timeout: 15000 });
    expect(puts).toEqual([`${PROXY}/services/${id}`]);

    const value = await stored(token, 'services', id);
    expect(value.name).toBe(id);
    expect(value.desc).toBe('kept');
  } finally {
    await remove(token, 'services', [id, 'undefined']);
  }
});

test('an upstream saves whole from a step reached while read-only', async ({ page }) => {
  const token = await loginAdmin();
  const id = randomId('e2e-jumped-upstream');
  const puts = putsTo(page, 'upstreams');
  await apiFetch(`${PROXY}/upstreams/${id}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: { name: id, desc: 'kept', ...upstream },
  });

  try {
    await saveFromJumpedStep(page, `/ui/upstreams/detail/${id}`, id, /^Connection/);
    await expect(page.getByText('Edit Upstream Successfully')).toBeVisible({ timeout: 15000 });
    expect(puts).toEqual([`${PROXY}/upstreams/${id}`]);

    const value = await stored(token, 'upstreams', id);
    expect(value.name).toBe(id);
    expect(value.desc).toBe('kept');
    expect(value.nodes).toBeTruthy();
  } finally {
    await remove(token, 'upstreams', [id, 'undefined']);
  }
});

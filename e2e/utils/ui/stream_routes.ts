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
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { APISIXType } from '@/types/schema/apisix';

/**
 * The redesigned stream route form has no inline node editor — the upstream
 * is referenced through a searchable Select of pre-existing upstreams
 * (seed one via the API first, then select it here by name).
 */
export const uiSelectStreamRouteUpstream = async (
  page: Page,
  upstreamName: string
) => {
  await page.getByRole('textbox', { name: 'Upstream', exact: true }).click();
  await page.getByRole('option', { name: upstreamName, exact: true }).click();
};

export const uiFillStreamRouteRequiredFields = async (
  page: Page,
  data: Partial<APISIXType['StreamRoute']>
) => {
  if (data.server_addr) {
    await page
      .getByLabel('Server Address', { exact: true })
      .fill(data.server_addr);
  }

  if (data.server_port) {
    await page
      .getByLabel('Server Port', { exact: true })
      .fill(data.server_port.toString());
  }

  if (data.remote_addr) {
    await page.getByLabel('Remote Address').fill(data.remote_addr);
  }

  if (data.sni) {
    await page.getByLabel('SNI').fill(data.sni);
  }

  if (data.desc) {
    await page.getByLabel('Description').first().fill(data.desc);
  }

  if (data.labels) {
    const labelsField = page.getByPlaceholder('Input text like `key:value`,').first();
    for (const [key, value] of Object.entries(data.labels)) {
      await labelsField.fill(`${key}:${value}`);
      await labelsField.press('Enter');
    }
  }
};

export const uiCheckStreamRouteRequiredFields = async (
  page: Page,
  data: Partial<APISIXType['StreamRoute']>
) => {
  if (data.server_addr) {
    await expect(page.getByLabel('Server Address', { exact: true })).toHaveValue(
      data.server_addr
    );
  }

  if (data.server_port) {
    await expect(page.getByLabel('Server Port', { exact: true })).toHaveValue(
      data.server_port.toString()
    );
  }

  if (data.remote_addr) {
    await expect(page.getByLabel('Remote Address')).toHaveValue(
      data.remote_addr
    );
  }

  if (data.sni) {
    await expect(page.getByLabel('SNI')).toHaveValue(data.sni);
  }

  if (data.desc) {
    await expect(page.getByLabel('Description').first()).toHaveValue(data.desc);
  }

  if (data.labels) {
    // Labels are displayed as tags, check if the tags exist
    for (const [key, value] of Object.entries(data.labels)) {
      const labelTag = page.getByText(`${key}:${value}`, { exact: true });
      await expect(labelTag).toBeVisible();
    }
  }
};

export const uiFillStreamRouteAllFields = async (
  page: Page,
  data: Partial<APISIXType['StreamRoute']>
) => {
  // Fill basic fields
  await uiFillStreamRouteRequiredFields(page, {
    server_addr: data.server_addr,
    server_port: data.server_port,
    remote_addr: data.remote_addr,
    sni: data.sni,
    desc: data.desc,
    labels: data.labels,
  });

  // Fill protocol fields
  if (data.protocol?.name) {
    await page.getByLabel('Protocol Name').fill(data.protocol.name);
  }

  if (data.protocol?.superior_id) {
    await page.getByLabel('Superior ID').fill(data.protocol.superior_id);
  }
};

export const uiCheckStreamRouteAllFields = async (
  page: Page,
  data: Partial<APISIXType['StreamRoute']>
) => {
  // Check basic fields
  await uiCheckStreamRouteRequiredFields(page, {
    server_addr: data.server_addr,
    server_port: data.server_port,
    remote_addr: data.remote_addr,
    sni: data.sni,
    desc: data.desc,
    labels: data.labels,
  });

  // Check protocol fields
  if (data.protocol?.name) {
    await expect(page.getByLabel('Protocol Name')).toHaveValue(
      data.protocol.name
    );
  }

  if (data.protocol?.superior_id) {
    await expect(page.getByLabel('Superior ID')).toHaveValue(
      data.protocol.superior_id
    );
  }
};

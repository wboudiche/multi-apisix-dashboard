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
import { expect, type Page } from '@playwright/test';

/** The node editor's fields, as every spec that drives it locates them. */
export const NODE_HOST_PH = 'Hostname or IP';
export const NODE_PORT_PH = 'Port';

/**
 * Add a node on the node editor (FormItemNodes), which the upstream, route and
 * service forms share, and fill its host and, when given, its port.
 */
export async function uiAddNode(page: Page, host: string, port?: number) {
  const hostInputs = page.getByPlaceholder(NODE_HOST_PH, { exact: true });
  const idx = await hostInputs.count();
  await page.getByRole('button', { name: 'Add a Node' }).click();
  // count() does not wait: wait for the new row, or idx could still name the
  // one before it.
  await expect(hostInputs).toHaveCount(idx + 1);
  const hostInput = hostInputs.nth(idx);
  await hostInput.fill(host);
  await expect(hostInput).toHaveValue(host);
  if (port != null) {
    // Read back: this used to keep its default of 1, silently, because
    // leaving the Host field replaced the input fill() had written to (#306).
    const portInput = page.getByPlaceholder(NODE_PORT_PH, { exact: true }).nth(idx);
    await portInput.fill(String(port));
    await expect(portInput).toHaveValue(String(port));
  }
  // Leave the row, the way someone filling the form does.
  await page.locator('h1').first().click();
}

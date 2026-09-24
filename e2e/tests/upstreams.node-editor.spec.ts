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
import { test } from '@e2e/utils/test';
import { uiDiscardDraftIfPresent, uiWizardNext } from '@e2e/utils/ui/upstreams';
import { expect } from '@playwright/test';

/**
 * Leaving a node's Host field commits the rows, and the rows used to be
 * rebuilt from that commit with new ids. The ids key the inputs, so every
 * field in the list was replaced: the one the caret had just moved into
 * disappeared under it, and what was typed or pasted there went with it
 * (#306).
 */

const goToNodes = async (page: import('@playwright/test').Page) => {
  await upstreamsPom.toAdd(page);
  await upstreamsPom.isAddPage(page);
  await uiDiscardDraftIfPresent(page);
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .first()
    .fill('e2e-node-editor');
  await uiWizardNext(page);
  await page.getByRole('button', { name: 'Add a Node' }).click();
};

test('the port keeps what is typed after tabbing out of the host', async ({ page }) => {
  await goToNodes(page);

  const host = page.getByPlaceholder('Hostname or IP');
  const port = page.getByPlaceholder('Port');
  await host.fill('node.example.com');
  await host.press('Tab');

  // The caret is in the Port field, on the field that is still there.
  await expect(port).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('8080');

  await expect(port).toHaveValue('8080');
  await expect(host).toHaveValue('node.example.com');
});

test('a port written in one go is kept', async ({ page }) => {
  await goToNodes(page);

  const host = page.getByPlaceholder('Hostname or IP');
  const port = page.getByPlaceholder('Port');
  await host.fill('node.example.com');
  // fill() sets the value in one event, the way a paste does. It used to
  // land on an input that the commit above had already replaced.
  await port.fill('8080');
  await page.locator('h1').first().click();

  await expect(port).toHaveValue('8080');
});

test('a second node does not disturb the first', async ({ page }) => {
  await goToNodes(page);

  const hosts = page.getByPlaceholder('Hostname or IP');
  const ports = page.getByPlaceholder('Port');
  await hosts.first().fill('first.example.com');
  await ports.first().fill('8080');

  await page.getByRole('button', { name: 'Add a Node' }).click();
  await expect(hosts).toHaveCount(2);
  await hosts.nth(1).fill('second.example.com');
  await ports.nth(1).fill('8081');
  await page.locator('h1').first().click();

  await expect(hosts.first()).toHaveValue('first.example.com');
  await expect(ports.first()).toHaveValue('8080');
  await expect(hosts.nth(1)).toHaveValue('second.example.com');
  await expect(ports.nth(1)).toHaveValue('8081');
});

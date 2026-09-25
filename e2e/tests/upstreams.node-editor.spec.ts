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
import { deleteUpstreamsByNamePrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { NODE_HOST_PH, NODE_PORT_PH } from '@e2e/utils/ui/nodes';
import {
  nameField,
  uiDiscardDraftIfPresent,
  uiWizardNext,
} from '@e2e/utils/ui/upstreams';
import { expect, type Page } from '@playwright/test';

import { API_UPSTREAMS } from '@/config/constant';

/**
 * Leaving a node's Host field commits the rows, and the rows used to be
 * rebuilt from that commit with new ids. The ids key the inputs, so every
 * field in the list was replaced: the one the caret had just moved into
 * disappeared under it, and what was typed or pasted there went with it
 * (#306). A node was also born with a weight of 0, which APISIX's roundrobin
 * never picks beside a node that has one (#303).
 */

const PREFIX = 'e2e-node-editor';

const hostFields = (page: Page) => page.getByPlaceholder(NODE_HOST_PH, { exact: true });
const portFields = (page: Page) => page.getByPlaceholder(NODE_PORT_PH, { exact: true });

const goToNodes = async (page: Page, name: string) => {
  await upstreamsPom.toAdd(page);
  await upstreamsPom.isAddPage(page);
  await uiDiscardDraftIfPresent(page);
  await nameField(page).fill(name);
  await uiWizardNext(page);
  await page.getByRole('button', { name: 'Add a Node' }).click();
};

test.afterAll(async () => {
  await deleteUpstreamsByNamePrefix(PREFIX);
});

test('the port keeps what is typed after tabbing out of the host', async ({ page }) => {
  await goToNodes(page, randomId(PREFIX));

  const host = hostFields(page);
  const port = portFields(page);
  await host.fill('node.example.com');
  await host.press('Tab');

  // The caret is in the Port field, on the field that is still there.
  await expect(port).toBeFocused();
  // Select what is there rather than trust a chord: typing over an unselected
  // "1" would read 18080, and the failure would name the wrong culprit.
  await port.selectText();
  await page.keyboard.type('8080');

  await expect(port).toHaveValue('8080');
  await expect(host).toHaveValue('node.example.com');
});

test('a port written in one go is kept', async ({ page }) => {
  await goToNodes(page, randomId(PREFIX));

  const host = hostFields(page);
  const port = portFields(page);
  await host.fill('node.example.com');
  // fill() sets the value in one event, the way a paste does. It used to
  // land on an input that the commit above had already replaced.
  await port.fill('8080');
  await page.locator('h1').first().click();

  await expect(port).toHaveValue('8080');
  await expect(host).toHaveValue('node.example.com');
});

test('the nodes reach the gateway as they were typed', async ({ page }) => {
  const name = randomId(PREFIX);
  await goToNodes(page, name);

  const hosts = hostFields(page);
  const ports = portFields(page);
  await hosts.first().fill('first.example.com');
  await ports.first().fill('8080');

  await page.getByRole('button', { name: 'Add a Node' }).click();
  await expect(hosts).toHaveCount(2);
  await hosts.nth(1).fill('second.example.com');
  await ports.nth(1).fill('8081');
  await page.locator('h1').first().click();

  // On screen first: a second node must not disturb the first.
  await expect(hosts.first()).toHaveValue('first.example.com');
  await expect(ports.first()).toHaveValue('8080');
  await expect(hosts.nth(1)).toHaveValue('second.example.com');
  await expect(ports.nth(1)).toHaveValue('8081');

  // Then what is actually sent, which is where the damage was: an upstream
  // saved on port 1, and nodes with a weight of 0 that take no traffic.
  await uiWizardNext(page);
  await uiWizardNext(page);
  const posted = page.waitForResponse(
    (r) => r.url().includes(API_UPSTREAMS) && r.request().method() === 'POST'
  );
  await upstreamsPom.getAddBtn(page).click();
  const response = await posted;
  const body = response.request().postDataJSON() as {
    nodes: { host: string; port: number; weight: number }[];
  };

  expect(body.nodes).toEqual([
    expect.objectContaining({ host: 'first.example.com', port: 8080, weight: 1 }),
    expect.objectContaining({ host: 'second.example.com', port: 8081, weight: 1 }),
  ]);
  // And the gateway took them: a body the gateway refuses would otherwise
  // read as a pass here.
  expect(response.ok()).toBe(true);
  await uiHasToastMsg(page, { hasText: 'Add Upstream Successfully' });
});

// An empty Weight box gives no number, and the schema requires one. The form
// used to stop on an error keyed at a node's weight, which no field renders,
// so the wizard refused to advance with nothing on screen to say why.
test('an emptied weight is taken as the default rather than as nothing', async ({ page }) => {
  const name = randomId(PREFIX);
  await goToNodes(page, name);

  await hostFields(page).fill('weight.example.com');
  await portFields(page).fill('8080');
  const weight = page.getByPlaceholder('1', { exact: true });
  await weight.fill('');
  await page.locator('h1').first().click();

  // On screen too: the box saying nothing while 1 is what gets saved is the
  // same disagreement in the other direction.
  await expect(weight).toHaveValue('1');

  await uiWizardNext(page);
  await uiWizardNext(page);
  const posted = page.waitForResponse(
    (r) => r.url().includes(API_UPSTREAMS) && r.request().method() === 'POST'
  );
  await upstreamsPom.getAddBtn(page).click();
  const response = await posted;

  expect(response.ok()).toBe(true);
  expect(
    (response.request().postDataJSON() as { nodes: { weight: number }[] }).nodes
  ).toEqual([expect.objectContaining({ host: 'weight.example.com', port: 8080, weight: 1 })]);
});

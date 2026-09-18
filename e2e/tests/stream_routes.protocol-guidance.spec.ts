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
import { deleteByPrefix } from '@e2e/utils/cleanup';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import {
  uiFillStreamRouteAllFields,
  uiSelectStreamRouteUpstream,
} from '@e2e/utils/ui/stream_routes';
import { expect } from '@playwright/test';

import { postUpstreamReq } from '@/apis/upstreams';
import { API_STREAM_ROUTES, API_UPSTREAMS } from '@/config/constant';

/**
 * The form has two sections people reach for when they want TCP, UDP or TLS,
 * and neither of them is where that lives: the Server fields are connection
 * filters, and Protocol Information is xRPC, for application-layer protocols
 * like Redis and Dubbo. The transport belongs to the listener, in APISIX's
 * config.yaml (#141).
 *
 * Protocol Name was a free text field, so a typo produced a route that failed
 * only at runtime, and Superior ID was offered with nothing to be superior to.
 */
const upstreamName = randomId('sr-protocol-upstream');
const RUN_NET = `127.${2 + Math.floor(Math.random() * 253)}.${Math.floor(
  Math.random() * 256
)}.`;

test.beforeAll(async () => {
  await postUpstreamReq(e2eReq, {
    name: upstreamName,
    nodes: [{ host: '127.0.0.2', port: 8080, weight: 1 }],
  });
});

test.afterAll(async () => {
  await deleteByPrefix(API_STREAM_ROUTES, 'server_addr', RUN_NET);
  await deleteByPrefix(API_UPSTREAMS, 'name', upstreamName);
});

test('says where the transport protocol is set, which is not here', async ({ page }) => {
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  await expect(page.getByText('Connection filters')).toBeVisible();
  await expect(page.getByText('For xRPC')).toBeVisible();
  // And once more at the end, for whoever read the whole form still looking.
  await expect(page.getByText('Looking for TCP, UDP or TLS?')).toBeVisible();
});

test('offers the protocols APISIX ships, and asks for a name only when custom', async ({
  page,
}) => {
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  const protocol = page.getByRole('textbox', { name: 'Protocol Name', exact: true });
  const superiorId = page.getByLabel('Superior ID');
  const customName = page.getByLabel('Custom protocol name');

  // Nothing to be superior to until a protocol is named.
  await expect(superiorId).toBeDisabled();
  await expect(customName).toBeHidden();

  await protocol.click();
  for (const option of ['None (plain TCP/UDP passthrough)', 'redis', 'dubbo', 'Custom protocol']) {
    await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
  }

  await page.getByRole('option', { name: 'redis', exact: true }).click();
  await expect(superiorId).toBeEnabled();
  await expect(customName).toBeHidden();

  await protocol.click();
  await page.getByRole('option', { name: 'Custom protocol', exact: true }).click();
  await expect(customName).toBeVisible();
  await customName.fill('mqtt');
  await expect(protocol).toHaveValue('Custom protocol');

  // Back to a listed protocol. The custom field is bound to the same value, so
  // this is where a name set here used to be wiped by the field unmounting.
  await protocol.click();
  await page.getByRole('option', { name: 'dubbo', exact: true }).click();
  await expect(protocol).toHaveValue('dubbo');
  await expect(customName).toBeHidden();

  // And back to none: nothing named, nothing to attach to it.
  await protocol.click();
  await page.getByRole('option', { name: 'None (plain TCP/UDP passthrough)', exact: true }).click();
  await expect(superiorId).toBeDisabled();
});

test('sends no protocol fields for a route that has no protocol', async ({ page }) => {
  // Disabled rather than cleared: what matters is the payload, so this reads
  // it rather than the form. A superior id typed under a protocol and then
  // left behind must not travel with a route that has none.
  const serverAddr = `${RUN_NET}30`;
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  await uiSelectStreamRouteUpstream(page, upstreamName);
  await uiFillStreamRouteAllFields(page, {
    server_addr: serverAddr,
    server_port: 9102,
    protocol: { name: 'redis' },
  });
  await page.getByLabel('Superior ID').fill('svc-1');

  // Then take the protocol away again.
  await page.getByRole('textbox', { name: 'Protocol Name', exact: true }).click();
  await page
    .getByRole('option', { name: 'None (plain TCP/UDP passthrough)', exact: true })
    .click();

  const sent = page.waitForRequest(
    (r) => r.url().includes('/stream_routes') && r.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? '{}') as {
    protocol?: { name?: string; superior_id?: string };
  };
  expect(body.protocol).toBeUndefined();

  await streamRoutesPom.isDetailPage(page);
});

test('reports a protocol the gateway does not have, when it is saved', async ({
  page,
}) => {
  // The dropdown offers what APISIX implements, which is not the same as what
  // this gateway has enabled: xrpc.protocols in config.yaml decides that, and
  // nothing in the Admin API exposes it. So the answer comes from the save -
  // 400 "unknown protocol [redis]" - and the form has to pass it on rather
  // than sitting there having done nothing (#141).
  const serverAddr = `${RUN_NET}10`;
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  await uiSelectStreamRouteUpstream(page, upstreamName);
  await uiFillStreamRouteAllFields(page, {
    server_addr: serverAddr,
    server_port: 9100,
    protocol: { name: 'redis' },
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(
    page.locator('.mantine-Notification-root').filter({ hasText: 'unknown protocol' })
  ).toBeVisible({ timeout: 20000 });
  // Still on the form, with the work still in it.
  await streamRoutesPom.isAddPage(page);
});

test('saves a route with no protocol, which is the ordinary case', async ({ page }) => {
  const serverAddr = `${RUN_NET}20`;
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  await uiSelectStreamRouteUpstream(page, upstreamName);
  await uiFillStreamRouteAllFields(page, {
    server_addr: serverAddr,
    server_port: 9101,
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await streamRoutesPom.isDetailPage(page);

  // The gateway is what decides: read it back rather than trusting the form.
  const { data } = await e2eReq.get(API_STREAM_ROUTES);
  const saved = (
    data.list as { value: { server_addr?: string; protocol?: { name?: string } } }[]
  )
    .map((item) => item.value)
    .find((value) => value.server_addr === serverAddr);
  expect(saved).toBeDefined();
  expect(saved?.protocol?.name).toBeUndefined();
});

test('says what conf is for, and offers something to start from', async ({ page }) => {
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  const protocol = page.getByRole('textbox', { name: 'Protocol Name', exact: true });
  const example = page.getByTestId('protocol-conf-example');

  // Nothing to say until a protocol is named: conf is protocol-specific, and
  // without one there is no protocol to be specific about.
  await expect(example).toBeHidden();

  await protocol.click();
  await page.getByRole('option', { name: 'redis', exact: true }).click();
  await expect(page.getByText('injects faults')).toBeVisible();

  await example.click();
  // Read from the Conf field itself, not from the page: the section has a
  // second JSON field, Logger, and an example landing in that one would look
  // the same from here.
  const conf = page.getByRole('textbox', { name: 'Conf', exact: true });
  await expect(conf).toHaveValue(/"commands"/);
  await expect(conf).toHaveValue(/"delay"/);

  // dubbo's xRPC declares an empty schema, so there is nothing to insert - and
  // saying so beats an empty object that looks like a start.
  await protocol.click();
  await page.getByRole('option', { name: 'dubbo', exact: true }).click();
  await expect(page.getByText('declares an empty schema')).toBeVisible();
  await expect(example).toBeHidden();

  // And a protocol this dashboard has never heard of gets no example rather
  // than another protocol's.
  await protocol.click();
  await page.getByRole('option', { name: 'Custom protocol', exact: true }).click();
  await page.getByLabel('Custom protocol name').fill('mqtt');
  await expect(example).toBeHidden();
});

test('sends the conf that was typed, rather than an empty object', async ({ page }) => {
  // The form parses what it submits against its own schema, and a `conf`
  // declared as an empty object strips every key on the way through: the
  // example went into the field, the operator saved, and the gateway received
  // `{}` without a word (#141).
  const serverAddr = `${RUN_NET}31`;
  await streamRoutesPom.toAdd(page);
  await streamRoutesPom.isAddPage(page);

  await uiSelectStreamRouteUpstream(page, upstreamName);
  await uiFillStreamRouteAllFields(page, {
    server_addr: serverAddr,
    server_port: 9103,
    protocol: { name: 'redis' },
  });
  await page.getByTestId('protocol-conf-example').click();

  const sent = page.waitForRequest(
    (r) => r.url().includes('/stream_routes') && r.method() === 'POST'
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? '{}') as {
    protocol?: { conf?: { faults?: { commands?: string[]; delay?: number }[] } };
  };
  expect(body.protocol?.conf?.faults?.[0]?.commands).toEqual(['GET', 'MGET']);
  expect(body.protocol?.conf?.faults?.[0]?.delay).toBe(5);
});

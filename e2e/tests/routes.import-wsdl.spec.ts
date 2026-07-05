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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { routesPom } from '@e2e/pom/routes';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

import { postUpstreamReq } from '@/apis/upstreams';
import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

const readFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

const wsdl = readFixture('billing.wsdl');
const wsdlSoap12 = readFixture('billing-soap12.wsdl');

const openImporter = async (page: Page) => {
  await routesPom.toIndex(page);
  await routesPom.isIndexPage(page);
  await page.getByRole('button', { name: 'Import from WSDL' }).click();
};

test('imports per-operation routes from pasted WSDL', async ({ page }) => {
  await openImporter(page);

  // Paste mode (Upload / Paste tab is the default), per-operation (default),
  // switch upstream binding to auto-create.
  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  // Preview shows 1 service / 2 operations.
  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();

  // Trigger import and assert success banner.
  await page.getByRole('button', { name: /Create 2 route\(s\)/ }).click();
  await expect(page.getByText('2 route(s) created from WSDL')).toBeVisible({
    timeout: 15000,
  });
});

test('passthrough mode creates a single route per service', async ({ page }) => {
  await openImporter(page);

  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  await page.getByText('Single passthrough route').click();
  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  // The service/operation summary is unchanged, but passthrough emits exactly
  // one route (no SOAPAction vars) rather than one per operation.
  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();

  await page.getByRole('button', { name: /Create 1 route\(s\)/ }).click();
  await expect(page.getByText('1 route(s) created from WSDL')).toBeVisible({
    timeout: 15000,
  });
});

test('warns when the WSDL uses SOAP 1.2', async ({ page }) => {
  await openImporter(page);

  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdlSoap12);
  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  await expect(
    page.getByText(
      'WSDL uses SOAP 1.2; the SOAPAction header may be absent, so per-operation routing may not match. Consider passthrough mode.',
    ),
  ).toBeVisible();
});

test('blocks parse when an existing upstream is chosen but left blank', async ({ page }) => {
  await openImporter(page);

  // Default upstream binding is "Use existing upstream ID" with an empty field.
  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  await page.getByRole('button', { name: 'Parse' }).click();

  await expect(
    page.getByText('Enter an existing upstream ID, or choose auto-create from the WSDL address'),
  ).toBeVisible();
});

test('existing-upstream mode links imported routes by upstream_id', async ({ page }) => {
  // Provision a real upstream through the Admin API; the importer should
  // reference it by id instead of embedding an inline upstream.
  const upstreamRes = await postUpstreamReq(e2eReq, {
    name: randomId('wsdl-existing-upstream'),
    nodes: [{ host: 'billing-soap', port: 8080, weight: 1 }],
  });
  const upstreamId = upstreamRes.data.value.id;

  await openImporter(page);

  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  // "Use existing upstream ID" is the default backend, but select it
  // explicitly so the test does not depend on the initial state.
  await page.getByLabel('Use existing upstream ID').check();
  await page.getByPlaceholder('upstream id').fill(upstreamId);
  await page.getByRole('button', { name: 'Parse' }).click();

  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();

  await page.getByRole('button', { name: /Create 2 route\(s\)/ }).click();
  await expect(page.getByText('2 route(s) created from WSDL')).toBeVisible({
    timeout: 15000,
  });

  // Both routes reference the upstream by id and carry no inline upstream.
  const res = await e2eReq.get<
    unknown,
    { data: { list: { value: APISIXType['Route'] }[] } }
  >(API_ROUTES);
  const created = res.data.list.filter(
    (r) => r.value.upstream_id === upstreamId
  );
  expect(created).toHaveLength(2);
  expect(created.map((r) => r.value.name).sort()).toEqual([
    'BillingService.GetInvoice',
    'BillingService.PayInvoice',
  ]);
  for (const r of created) {
    expect(r.value.upstream).toBeUndefined();
  }
});

test('expands a multi-file WSDL ZIP and follows wsdl:import', async ({ page }, testInfo) => {
  // Build a 2-file bundle: the entry .wsdl carries the <service> and a
  // wsdl:import; the imported sibling carries the <binding> + operations.
  const main = [
    '<?xml version="1.0"?>',
    '<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"',
    '  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="BillingService">',
    '  <wsdl:import namespace="urn:billing" location="billing-bindings.xml"/>',
    '  <wsdl:service name="BillingService">',
    '    <wsdl:port name="BillingPort" binding="tns:BillingBinding">',
    '      <soap:address location="http://billing-soap:8080/services/Billing"/>',
    '    </wsdl:port>',
    '  </wsdl:service>',
    '</wsdl:definitions>',
  ].join('\n');
  const bindings = [
    '<?xml version="1.0"?>',
    '<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"',
    '  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="BillingBindings">',
    '  <wsdl:binding name="BillingBinding" type="tns:BillingPort">',
    '    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>',
    '    <wsdl:operation name="GetInvoice"><soap:operation soapAction="urn:GetInvoice"/></wsdl:operation>',
    '    <wsdl:operation name="PayInvoice"><soap:operation soapAction="urn:PayInvoice"/></wsdl:operation>',
    '  </wsdl:binding>',
    '</wsdl:definitions>',
  ].join('\n');

  const zip = new JSZip();
  zip.file('billing.wsdl', main);
  zip.file('billing-bindings.xml', bindings);
  const zipPath = testInfo.outputPath('billing-bundle.zip');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

  await openImporter(page);

  // The file input is hidden behind the Upload button — set it directly.
  await page.locator('input[type="file"]').setInputFiles(zipPath);
  await expect(page.getByText('2 document(s)')).toBeVisible();

  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  // wsdl:import was followed: the binding from the sibling file resolves the
  // service's two operations.
  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();
});

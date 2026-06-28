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

import { describe, expect, it } from 'vitest';

import { parseWsdlString } from '@/utils/wsdl-import';

const SOAP11 = `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="BillingService">
  <wsdl:portType name="BillingPort">
    <wsdl:operation name="GetInvoice"/>
    <wsdl:operation name="PayInvoice"/>
  </wsdl:portType>
  <wsdl:binding name="BillingBinding" type="tns:BillingPort">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="GetInvoice">
      <soap:operation soapAction="urn:GetInvoice"/>
    </wsdl:operation>
    <wsdl:operation name="PayInvoice">
      <soap:operation soapAction="urn:PayInvoice"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="BillingService">
    <wsdl:port name="BillingPort" binding="tns:BillingBinding">
      <soap:address location="http://billing-soap:8080/services/Billing"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

describe('parseWsdlString — per-operation, SOAP 1.1', () => {
  it('creates one route per operation matched on SOAPAction', () => {
    const r = parseWsdlString(SOAP11, {
      mode: 'per-operation',
      upstream: { kind: 'existing', upstreamId: 'billing-soap' },
    });
    expect(r.soapVersion).toBe('1.1');
    expect(r.serviceCount).toBe(1);
    expect(r.operationCount).toBe(2);
    expect(r.routes).toHaveLength(2);
    const get = r.routes.find((x) => x.name === 'BillingService.GetInvoice')!;
    expect(get.uri).toBe('/services/Billing');
    expect(get.methods).toEqual(['POST']);
    expect(get.vars).toEqual([['http_soapaction', '==', '"urn:GetInvoice"']]);
    expect(get.upstream_id).toBe('billing-soap');
    expect(get.labels?.['soap-service']).toBe('BillingService');
    expect(get.status).toBe(1);
  });

  it('passthrough mode creates one route per service with no vars', () => {
    const r = parseWsdlString(SOAP11, {
      mode: 'passthrough',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].uri).toBe('/services/Billing');
    expect(r.routes[0].vars).toBeUndefined();
    expect(r.routes[0].upstream).toEqual({
      nodes: { 'billing-soap:8080': 1 },
      type: 'roundrobin',
      scheme: 'http',
    });
  });
});

describe('parseWsdlString — soapAction edge cases', () => {
  const xml = (a1: string, a2: string) => `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="S">
  <wsdl:binding name="B" type="tns:P">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Op1"><soap:operation soapAction="${a1}"/></wsdl:operation>
    <wsdl:operation name="Op2"><soap:operation soapAction="${a2}"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="S">
    <wsdl:port name="P" binding="tns:B">
      <soap:address location="http://h:8080/svc"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

  it('skips operations with empty SOAPAction in per-operation mode', () => {
    const r = parseWsdlString(xml('urn:Op1', ''), {
      mode: 'per-operation',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].name).toBe('S.Op1');
    expect(r.warnings.some((w) => w.includes('Op2') && w.includes('SOAPAction'))).toBe(true);
  });

  it('warns on duplicate SOAPAction values', () => {
    const r = parseWsdlString(xml('urn:Dup', 'urn:Dup'), {
      mode: 'per-operation',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(2);
    expect(r.warnings.some((w) => w.toLowerCase().includes('duplicate'))).toBe(true);
  });
});

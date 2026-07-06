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

import { extractSoapAction } from './soap-route';

describe('extractSoapAction', () => {
  it('returns the quoted SOAPAction value verbatim from a per-operation route', () => {
    const vars = [['http_soapaction', '==', '"urn:GetInvoice"']];
    expect(extractSoapAction(vars)).toBe('"urn:GetInvoice"');
  });

  it('finds the SOAPAction var among other vars', () => {
    const vars = [
      ['http_host', '==', 'example.com'],
      ['http_soapaction', '==', '"urn:PayInvoice"'],
    ];
    expect(extractSoapAction(vars)).toBe('"urn:PayInvoice"');
  });

  it('returns undefined when no SOAPAction var is present', () => {
    expect(extractSoapAction([['http_host', '==', 'example.com']])).toBeUndefined();
  });

  it('returns undefined for a route with no vars', () => {
    expect(extractSoapAction(undefined)).toBeUndefined();
    expect(extractSoapAction([])).toBeUndefined();
  });

  it('ignores a soapaction var that is not an equality match', () => {
    expect(
      extractSoapAction([['http_soapaction', '~~', '"urn:GetInvoice"']])
    ).toBeUndefined();
  });

  it('tolerates malformed var entries without throwing', () => {
    expect(extractSoapAction('not-an-array')).toBeUndefined();
    expect(extractSoapAction([null, 42, ['http_soapaction']])).toBeUndefined();
  });
});

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

import { emptyIdpForm, formFromIdp, inputFromForm } from './idp-form';

describe('the identity provider form', () => {
  it('starts an edit with an empty secret, whatever the connection holds', () => {
    const form = formFromIdp({
      id: 'p1',
      name: 'KC',
      type: 'keycloak',
      base_url: 'https://sso.example.test',
      realm: 'gw',
      admin_client_id: 'dash',
      has_secret: true,
      client_id_prefix: 'apisix-',
      instance_ids: ['i1'],
      developers_can_create: true,
      redirect_domains: ['app.example.test'],
      gateway_base_url: '',
    });
    expect(form.admin_client_secret).toBe('');
    expect(form.redirect_domains).toEqual(['app.example.test']);
  });

  it('sends domains lowercase, trimmed and once', () => {
    const input = inputFromForm({
      ...emptyIdpForm(),
      redirect_domains: [' App.Example.test ', 'app.example.test', ''],
    });
    expect(input.redirect_domains).toEqual(['app.example.test']);
  });

  it('trims what a person types around the addresses', () => {
    const input = inputFromForm({ ...emptyIdpForm(), name: ' KC ', base_url: ' https://x.test ' });
    expect(input.name).toBe('KC');
    expect(input.base_url).toBe('https://x.test');
  });

  it('carries the gateway address, trimmed, and an unset one as empty', () => {
    const form = formFromIdp({
      id: 'p1',
      name: 'KC',
      type: 'keycloak',
      base_url: 'https://sso.example.test',
      realm: 'gw',
      admin_client_id: 'dash',
      has_secret: true,
      client_id_prefix: 'apisix-',
      instance_ids: [],
      developers_can_create: false,
      redirect_domains: [],
      gateway_base_url: '',
    });
    expect(form.gateway_base_url).toBe('');
    const input = inputFromForm({ ...form, gateway_base_url: ' http://keycloak:8080 ' });
    expect(input.gateway_base_url).toBe('http://keycloak:8080');
    // Cleared by sending it empty: the backend reads an omitted field as "keep".
    expect(inputFromForm(emptyIdpForm()).gateway_base_url).toBe('');
  });
});

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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ClientModule = typeof import('./client');
type IdpsModule = typeof import('./idps');

// The stores touch localStorage as their modules load, and this suite runs in
// node: the same stand-in client.test.ts installs.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
});

let apiClient: ClientModule['apiClient'];
let idpApi: IdpsModule['idpApi'];
let testFailureKey: IdpsModule['testFailureKey'];
let seen: { method?: string; url?: string; data?: unknown; params?: unknown };
let body: unknown;

beforeAll(async () => {
  ({ apiClient } = await import('./client'));
  ({ idpApi, testFailureKey } = await import('./idps'));
  apiClient.defaults.adapter = async (config) => {
    seen = {
      method: config.method,
      url: config.url,
      data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      params: config.params,
    };
    return { data: body, status: 200, statusText: 'OK', headers: {}, config };
  };
});

beforeEach(() => {
  seen = {};
  body = {};
});

const input = {
  name: 'KC',
  base_url: 'https://sso.example.test',
  realm: 'gw',
  admin_client_id: 'dash',
  client_id_prefix: 'apisix-',
  instance_ids: ['i1'],
  developers_can_create: false,
  redirect_domains: ['app.example.test'],
};

describe('updating a connection', () => {
  it('sends no secret when the field was left empty', async () => {
    await idpApi.update('p1', { ...input, admin_client_secret: '' });
    expect(seen.method).toBe('put');
    expect(seen.url).toBe('/api/v1/idps/p1');
    expect(seen.data).toEqual(input);
    expect(seen.data).not.toHaveProperty('admin_client_secret');
  });

  it('sends no secret when the input has none', async () => {
    await idpApi.update('p1', input);
    expect(seen.data).not.toHaveProperty('admin_client_secret');
  });

  it('sends the secret that was typed', async () => {
    await idpApi.update('p1', { ...input, admin_client_secret: 's3cret' });
    expect(seen.data).toEqual({ ...input, admin_client_secret: 's3cret' });
  });
});

describe('deleting a connection', () => {
  it('forces only when asked to', async () => {
    await idpApi.remove('p1');
    expect(seen.params).toBeUndefined();
    await idpApi.remove('p1', true);
    expect(seen.params).toEqual({ force: true });
  });
});

describe('the reason a test failed', () => {
  it('has a sentence for each reason the backend gives', () => {
    expect(testFailureKey('auth')).toBe('settings.idp.test.auth');
    expect(testFailureKey('forbidden')).toBe('settings.idp.test.forbidden');
    expect(testFailureKey('unavailable')).toBe('settings.idp.test.unavailable');
  });

  it('reads one it does not know as unavailable', () => {
    expect(testFailureKey('something-new')).toBe('settings.idp.test.unavailable');
    expect(testFailureKey(undefined)).toBe('settings.idp.test.unavailable');
  });
});

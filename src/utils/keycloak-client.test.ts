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

import type { ClientCredentials } from '@/apis/idps';

import {
  applyClientCredentials,
  proposeClientIdSuffix,
  proposeRedirectUri,
} from './keycloak-client';

const creds = (over: Partial<ClientCredentials>): ClientCredentials => ({
  client_id: 'apisix-billing',
  client_secret: 's3cret',
  discovery: 'https://sso.example.com/realms/r/.well-known/openid-configuration',
  mode: 'login',
  options: { pkce: true, client_credentials: false },
  ...over,
});

describe('proposeRedirectUri', () => {
  it('follows the plugin default on a single host and a single /* uri', () => {
    expect(proposeRedirectUri(['api.example.com'], ['/billing/*'])).toBe(
      'https://api.example.com/billing/.apisix/redirect'
    );
  });
  it('proposes nothing for two hosts, a wildcard host, a bare path or no host', () => {
    expect(proposeRedirectUri(['a.example.com', 'b.example.com'], ['/x/*'])).toBe('');
    expect(proposeRedirectUri(['*.example.com'], ['/x/*'])).toBe('');
    expect(proposeRedirectUri(['api.example.com'], ['/billing'])).toBe('');
    expect(proposeRedirectUri(['api.example.com'], ['/a/*', '/b/*'])).toBe('');
    expect(proposeRedirectUri([], ['/x/*'])).toBe('');
  });
});

describe('proposeClientIdSuffix', () => {
  it('lowercases the name and replaces what a client id cannot hold', () => {
    expect(proposeClientIdSuffix({ name: 'Billing API', hosts: [], uris: [] })).toBe('billing-api');
  });
  it('falls back to the id and trims to 64', () => {
    expect(proposeClientIdSuffix({ id: 'r1', hosts: [], uris: [] })).toBe('r1');
    expect(proposeClientIdSuffix({ name: 'a'.repeat(100), hosts: [], uris: [] })).toHaveLength(64);
    expect(proposeClientIdSuffix({ hosts: [], uris: [] })).toBe('');
  });
});

describe('applyClientCredentials', () => {
  it('fills a login with PKCE and drops bearer_only', () => {
    const next = applyClientCredentials(
      { bearer_only: true },
      creds({ redirect_uri: 'https://a.example.com/.apisix/redirect' })
    );
    expect(next).toMatchObject({
      discovery: expect.any(String),
      client_id: 'apisix-billing',
      client_secret: 's3cret',
      use_pkce: true,
      redirect_uri: 'https://a.example.com/.apisix/redirect',
    });
    expect(next).not.toHaveProperty('bearer_only');
  });
  it('fills a token check by signature', () => {
    const next = applyClientCredentials(
      { introspection_endpoint: 'old' },
      creds({ mode: 'token', options: { pkce: false, validation: 'jwks', client_credentials: false } })
    );
    expect(next).toMatchObject({ bearer_only: true, use_jwks: true });
    expect(next).not.toHaveProperty('introspection_endpoint');
  });
  it('fills a token check by introspection', () => {
    const next = applyClientCredentials(
      { use_jwks: true },
      creds({
        mode: 'token',
        introspection_endpoint: 'https://sso/introspect',
        options: { pkce: false, validation: 'introspection', client_credentials: false },
      })
    );
    expect(next).toMatchObject({
      bearer_only: true,
      introspection_endpoint: 'https://sso/introspect',
    });
    expect(next).not.toHaveProperty('use_jwks');
  });
});

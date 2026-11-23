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
  it('never starts with what the backend refuses first', () => {
    expect(proposeClientIdSuffix({ name: '.hidden', hosts: [], uris: [] })).toBe('hidden');
    expect(proposeClientIdSuffix({ name: '_private_api', hosts: [], uris: [] })).toBe('private_api');
    expect(proposeClientIdSuffix({ name: '._-x', hosts: [], uris: [] })).toBe('x');
    expect(proposeClientIdSuffix({ name: '...', id: 'r1', hosts: [], uris: [] })).toBe('r1');
    const long = proposeClientIdSuffix({ name: `${'_'.repeat(70)}abc`, hosts: [], uris: [] });
    expect(long).toBe('abc');
  });
});

describe('applyClientCredentials', () => {
  it('accepts only the tokens issued for the client, in either mode, keeping other claim checks', () => {
    const audience = { required: true, match_with_client_id: true };
    for (const mode of ['login', 'token'] as const) {
      const next = applyClientCredentials(
        { claim_validator: { issuer: { valid_issuers: ['https://sso'] }, audience: { claim: 'azp' } } },
        creds({ mode, options: { pkce: true, validation: 'jwks', client_credentials: true } })
      );
      expect(next.claim_validator).toEqual({
        issuer: { valid_issuers: ['https://sso'] },
        audience,
      });
    }
    expect(applyClientCredentials({}, creds({})).claim_validator).toEqual({ audience });
  });
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
  it('leaves no token setting behind when switching to a login', () => {
    const next = applyClientCredentials(
      { bearer_only: true, use_jwks: true, introspection_endpoint: 'i', redirect_uri: 'https://old/x' },
      creds({})
    );
    expect(next).not.toHaveProperty('bearer_only');
    expect(next).not.toHaveProperty('use_jwks');
    expect(next).not.toHaveProperty('introspection_endpoint');
    expect(next).not.toHaveProperty('redirect_uri');
    expect(next).toMatchObject({ use_pkce: true });
  });
  it('leaves no login setting behind when switching to a token check', () => {
    const next = applyClientCredentials(
      { use_pkce: true, redirect_uri: 'https://old/x', introspection_endpoint: 'old' },
      creds({ mode: 'token', options: { pkce: false, validation: 'jwks', client_credentials: false } })
    );
    expect(next).not.toHaveProperty('use_pkce');
    expect(next).not.toHaveProperty('redirect_uri');
    expect(next).not.toHaveProperty('introspection_endpoint');
    expect(next).toMatchObject({ bearer_only: true, use_jwks: true });
  });
});

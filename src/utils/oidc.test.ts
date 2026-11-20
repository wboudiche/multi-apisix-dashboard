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

import {
  checkDiscovery,
  finishOidc,
  isAbsoluteHttpUrl,
  oidcMode,
  redirectUriProblem,
  withOidcMode,
} from './oidc';

const doc = {
  issuer: 'https://idp.example',
  authorization_endpoint: 'https://idp.example/auth',
  token_endpoint: 'https://idp.example/token',
  jwks_uri: 'https://idp.example/jwks',
};
const noKeys = { ...doc, jwks_uri: undefined };
const introspecting = { ...noKeys, introspection_endpoint: 'https://idp.example/i' };

describe('openid-connect', () => {
  it('reads and writes the mode as bearer_only', () => {
    expect(oidcMode({})).toBe('login');
    expect(oidcMode({ bearer_only: true })).toBe('token');
    expect(withOidcMode({ a: 1 }, 'token')).toEqual({ a: 1, bearer_only: true });
    expect(withOidcMode({ a: 1, bearer_only: true }, 'login')).toEqual({ a: 1 });
  });

  it('gives a login a session secret, and keeps one long enough', () => {
    const made = finishOidc({ session: { cookie: { lifetime: 60 } } });
    expect(made.session).toMatchObject({ cookie: { lifetime: 60 } });
    expect((made.session as { secret: string }).secret).toMatch(/^[0-9a-f]{32}$/);

    const kept = { session: { secret: 'a-secret-of-16-chars' } };
    expect(finishOidc(kept)).toBe(kept);
    // The gateway refuses one under 16 characters.
    const short = finishOidc({ session: { secret: 'short' } });
    expect((short.session as { secret: string }).secret).toMatch(/^[0-9a-f]{32}$/);
    // A token handed in opens no session.
    expect(finishOidc({ bearer_only: true })).toEqual({ bearer_only: true });
  });

  it('saves the addresses without the spaces a paste brings', () => {
    expect(
      finishOidc({
        bearer_only: true,
        discovery: ' https://idp/x \n',
        redirect_uri: 'https://gw/cb ',
      })
    ).toEqual({ bearer_only: true, discovery: 'https://idp/x', redirect_uri: 'https://gw/cb' });
    // Nothing but spaces is no address at all.
    expect(finishOidc({ bearer_only: true, redirect_uri: '   ' })).toEqual({ bearer_only: true });
  });

  it('tells a full address from a path', () => {
    expect(isAbsoluteHttpUrl('https://idp.example/x')).toBe(true);
    expect(isAbsoluteHttpUrl('idp.example/x')).toBe(false);
    expect(isAbsoluteHttpUrl('/callback')).toBe(false);
    expect(isAbsoluteHttpUrl('ftp://idp.example')).toBe(false);
  });

  it('asks a login for a full redirect address', () => {
    expect(redirectUriProblem({})).toBe('missing');
    expect(redirectUriProblem({ redirect_uri: '/callback' })).toBe('notAbsolute');
    expect(redirectUriProblem({ redirect_uri: 'https://gw.example/app/cb' })).toBeUndefined();
  });

  it('says what a login needs that the provider does not offer', () => {
    expect(checkDiscovery(doc, {})).toEqual({ issuer: 'https://idp.example', problems: [] });
    expect(checkDiscovery({ issuer: 'x' }, {})?.problems).toEqual([
      'noAuthorization',
      'noToken',
      'noKeys',
    ]);
    // The ID token is checked with the route's own key instead.
    expect(checkDiscovery(noKeys, { public_key: 'PEM' })?.problems).toEqual([]);
  });

  it('checks a token handed in the one way the gateway will', () => {
    const token = { bearer_only: true };
    // Introspection, when nothing else is set.
    expect(checkDiscovery(doc, token)?.problems).toEqual(['noVerification']);
    expect(checkDiscovery(introspecting, token)?.problems).toEqual([]);
    // use_jwks: the provider's keys, and introspection is never asked.
    expect(checkDiscovery(doc, { ...token, use_jwks: true })?.problems).toEqual([]);
    expect(checkDiscovery(introspecting, { ...token, use_jwks: true })?.problems).toEqual([
      'noKeys',
    ]);
    // The route's own key: nothing asked of the provider.
    expect(checkDiscovery(noKeys, { ...token, public_key: 'PEM' })?.problems).toEqual([]);
  });

  it('refuses what is not an OpenID configuration', () => {
    expect(checkDiscovery('<html>', {})).toBeNull();
    expect(checkDiscovery({ authorization_endpoint: 'x' }, {})).toBeNull();
    expect(checkDiscovery([doc], {})).toBeNull();
  });
});

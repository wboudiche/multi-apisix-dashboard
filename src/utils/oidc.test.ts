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

import { checkDiscovery, oidcMode, withOidcMode, withSessionSecret } from './oidc';

const doc = {
  issuer: 'https://idp.example',
  authorization_endpoint: 'https://idp.example/auth',
  token_endpoint: 'https://idp.example/token',
  jwks_uri: 'https://idp.example/jwks',
};

describe('openid-connect', () => {
  it('reads and writes the mode as bearer_only', () => {
    expect(oidcMode({})).toBe('login');
    expect(oidcMode({ bearer_only: true })).toBe('token');
    expect(withOidcMode({ a: 1 }, 'token')).toEqual({ a: 1, bearer_only: true });
    expect(withOidcMode({ a: 1, bearer_only: true }, 'login')).toEqual({ a: 1 });
  });

  it('gives a login a session secret, and keeps one already set', () => {
    const made = withSessionSecret({ session: { cookie: { lifetime: 60 } } });
    expect(made.session).toMatchObject({ cookie: { lifetime: 60 } });
    expect((made.session as { secret: string }).secret).toMatch(/^[0-9a-f]{32}$/);

    const kept = { session: { secret: 'mine' } };
    expect(withSessionSecret(kept)).toBe(kept);
    // A token handed in opens no session.
    expect(withSessionSecret({ bearer_only: true })).toEqual({ bearer_only: true });
  });

  it('says what a login needs that the provider does not offer', () => {
    expect(checkDiscovery(doc, {})).toEqual({ issuer: 'https://idp.example', problems: [] });
    expect(checkDiscovery({ issuer: 'x' }, {})?.problems).toEqual(['noAuthorization', 'noToken']);
  });

  it('asks how a token handed in is checked', () => {
    const token = { bearer_only: true };
    expect(checkDiscovery(doc, token)?.problems).toEqual(['noVerification']);
    expect(checkDiscovery(doc, { ...token, use_jwks: true })?.problems).toEqual([]);
    expect(
      checkDiscovery({ ...doc, introspection_endpoint: 'https://idp.example/i' }, token)?.problems
    ).toEqual([]);
    expect(checkDiscovery(doc, { ...token, public_key: 'PEM' })?.problems).toEqual([]);
  });

  it('refuses what is not an OpenID configuration', () => {
    expect(checkDiscovery('<html>', {})).toBeNull();
    expect(checkDiscovery({ authorization_endpoint: 'x' }, {})).toBeNull();
    expect(checkDiscovery([doc], {})).toBeNull();
  });
});

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
  credentialConfig,
  credentialId,
  generateSecret,
  holdsCredential,
  isAuthClientPlugin,
} from './auth-clients';

describe('auth clients', () => {
  it('knows the plugins whose callers the gateway holds', () => {
    expect(isAuthClientPlugin('key-auth')).toBe(true);
    expect(isAuthClientPlugin('basic-auth')).toBe(true);
    // Its users live in the identity provider, not on the gateway.
    expect(isAuthClientPlugin('openid-connect')).toBe(false);
  });

  it('generates a hex secret of the length asked for, different each time', () => {
    const a = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(generateSecret()).not.toBe(a);
  });

  it('finds a credential on the consumer itself or in its credentials', () => {
    expect(holdsCredential('key-auth', { plugins: { 'key-auth': { key: 'k' } } }, [])).toBe(true);
    expect(
      holdsCredential('key-auth', {}, [{ plugins: { 'basic-auth': {} } }, { plugins: { 'key-auth': {} } }])
    ).toBe(true);
    expect(holdsCredential('key-auth', { plugins: { 'basic-auth': {} } }, [])).toBe(false);
    expect(holdsCredential('key-auth', {}, [])).toBe(false);
  });

  it('writes what each plugin expects of a credential', () => {
    expect(credentialConfig('key-auth', 'app', 's3cret')).toEqual({ key: 's3cret' });
    expect(credentialConfig('basic-auth', 'app', 's3cret')).toEqual({
      username: 'app',
      password: 's3cret',
    });
  });

  it('names a credential after its plugin, in what APISIX accepts as an id', () => {
    expect(credentialId('key-auth')).toMatch(/^key-auth-[0-9a-f]{6}$/);
  });
});

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
  readRestriction,
  shellQuote,
  usableHeader,
  writeRestriction,
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
    expect(credentialId('key-auth')).toMatch(/^key-auth-[0-9a-f]{12}$/);
  });

  it('quotes a value as one shell word, a quote in it included', () => {
    expect(shellQuote('apikey: abc')).toBe("'apikey: abc'");
    expect(shellQuote("x'; rm -rf ~; '")).toBe("'x'\\''; rm -rf ~; '\\'''");
  });

  it('shows only a header a header can be', () => {
    expect(usableHeader('X-Api-Key')).toBe('X-Api-Key');
    expect(usableHeader("x'; rm -rf ~")).toBe('apikey');
    expect(usableHeader(undefined)).toBe('apikey');
  });

  it('reads an allow-list of consumer names as the clients ticked', () => {
    expect(readRestriction(undefined)).toEqual({ mode: 'any' });
    expect(readRestriction({ whitelist: ['a', 'b'] })).toEqual({ mode: 'only', names: ['a', 'b'] });
    expect(
      readRestriction({ type: 'consumer_name', whitelist: ['a'], rejected_code: 401, _meta: { priority: 1 } })
    ).toEqual({ mode: 'only', names: ['a'] });
  });

  it('leaves to the plugin form what is not a plain allow-list', () => {
    expect(readRestriction({ blacklist: ['a'] })).toEqual({ mode: 'custom' });
    expect(readRestriction({ whitelist: ['a'], blacklist: ['b'] })).toEqual({ mode: 'custom' });
    expect(readRestriction({ type: 'consumer_group_id', whitelist: ['g'] })).toEqual({ mode: 'custom' });
    expect(readRestriction({ whitelist: ['a'], allowed_by_methods: [] })).toEqual({ mode: 'custom' });
    expect(readRestriction({ whitelist: ['a'], _meta: { disable: true } })).toEqual({ mode: 'custom' });
    expect(readRestriction('x')).toEqual({ mode: 'custom' });
    expect(readRestriction({ whitelist: ['a'], _meta: null })).toEqual({ mode: 'custom' });
  });

  it('reads a list left switched on as a plain one', () => {
    expect(readRestriction({ whitelist: ['a'], _meta: { disable: false } })).toEqual({
      mode: 'only',
      names: ['a'],
    });
  });

  it('writes the choice back, keeping the rest of the plugin', () => {
    expect(writeRestriction(undefined, null)).toBeNull();
    expect(writeRestriction({ whitelist: ['a'] }, null)).toBeNull();
    expect(writeRestriction(undefined, ['a'])).toEqual({ whitelist: ['a'] });
    expect(
      writeRestriction({ type: 'consumer_name', whitelist: ['a'], rejected_code: 401 }, ['b', 'c'])
    ).toEqual({ whitelist: ['b', 'c'], rejected_code: 401 });
  });
});

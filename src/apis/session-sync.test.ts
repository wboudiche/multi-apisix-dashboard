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
import { beforeAll, describe, expect, it, vi } from 'vitest';

type SessionModule = typeof import('./session');

// The stores touch localStorage as their modules load, and this suite runs in
// node: a Map stands in for it, installed before they are imported.
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
});

let changesAccount: SessionModule['changesAccount'];

beforeAll(async () => {
  ({ changesAccount } = await import('./session'));
});

// What another tab wrote to localStorage, as a `storage` event reports it.
const change = (key: string | null, newValue: string | null) => ({
  key,
  newValue,
});
const account = (id: string) =>
  JSON.stringify({ id, username: id, email: '', role: '', created_at: '' });
const nothingStored = () => null;

describe('a change another tab makes to localStorage', () => {
  it('is another account when someone else signs in there', () => {
    // A tab left open went on as the account it opened with, sending the new
    // account's token with the old one's role and team (#205).
    expect(changesAccount(change('auth:user', account('b')), 'a', nothingStored)).toBe(true);
  });

  it('is not when the same account signs in again', () => {
    expect(changesAccount(change('auth:user', account('a')), 'a', nothingStored)).toBe(false);
  });

  it('is another account when that tab signs out', () => {
    expect(changesAccount(change('auth:user', null), 'a', nothingStored)).toBe(true);
  });

  it('is not a token renewal, nor anything but the account', () => {
    // Renewals rewrite the tokens every few minutes; following them would
    // reload every other tab each time, for nothing — every tab reads the
    // token afresh for each request already.
    expect(changesAccount(change('auth:access_token', 't2'), 'a', nothingStored)).toBe(false);
    expect(changesAccount(change('instance:current_id', 'x'), 'a', nothingStored)).toBe(false);
  });

  it('reads the stored account when that tab clears all of localStorage', () => {
    // A `storage` event with no key is a clear().
    expect(changesAccount(change(null, null), 'a', () => account('a'))).toBe(false);
    expect(changesAccount(change(null, null), 'a', nothingStored)).toBe(true);
  });

  it('is an account for a signed-out tab when someone signs in', () => {
    expect(changesAccount(change('auth:user', account('b')), undefined, nothingStored)).toBe(true);
  });

  it('reads a value it cannot parse as no account', () => {
    expect(changesAccount(change('auth:user', '{not json'), 'a', nothingStored)).toBe(true);
    expect(changesAccount(change('auth:user', '{not json'), undefined, nothingStored)).toBe(false);
  });
});

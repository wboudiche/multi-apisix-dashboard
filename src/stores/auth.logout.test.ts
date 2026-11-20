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
import { getDefaultStore } from 'jotai';
import { describe, expect, it, vi } from 'vitest';

// The store touches localStorage as it loads, and this suite runs in node.
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
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
});

const { logoutActionAtom } = await import('./auth');
const { AUTH_CLIENTS_QUERY, queryClient } = await import('@/config/query-client');

describe('logging out', () => {
  it('leaves nothing read for that account to the next one', () => {
    queryClient.setQueryData([AUTH_CLIENTS_QUERY, 'inst', '', 'key-auth'], {
      holders: ['another-team-client'],
      all: ['another-team-client'],
    });
    queryClient.setQueryData(['routes'], []);
    getDefaultStore().set(logoutActionAtom);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});

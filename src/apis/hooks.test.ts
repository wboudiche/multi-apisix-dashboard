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
import type { InternalAxiosRequestConfig } from 'axios';
import { getDefaultStore } from 'jotai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type HooksModule = typeof import('./hooks');
type InstanceModule = typeof import('@/stores/instance');

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

let hooks: HooksModule;
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
const sent: InternalAxiosRequestConfig[] = [];

beforeAll(async () => {
  hooks = await import('./hooks');
  ({ currentInstanceIdAtom } = await import('@/stores/instance'));
  const { req } = await import('@/config/req');
  req.defaults.adapter = async (config) => {
    sent.push(config);
    return {
      data: { value: { id: 'r1' }, list: [], total: 0 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
});

const lastInstance = () => sent[sent.length - 1]?.headers.get('X-Instance-ID');

// The atom is this tab's own; localStorage is every tab's. Another tab
// switching instance writes localStorage and nothing here listens for it.
const thisTabOn = (instance: string) =>
  getDefaultStore().set(currentInstanceIdAtom, instance);
const anotherTabSwitchesTo = (instance: string) =>
  storage.set('instance:current_id', instance);

beforeEach(() => {
  storage.clear();
  sent.length = 0;
});

describe('the instance a query belongs to', () => {
  it('is this tab’s for a detail query, whatever another tab has switched to', async () => {
    // Read from localStorage, it would be another tab's: the record shown
    // under this tab's header, and this tab's saves — which go to the atom's
    // instance — writing it somewhere else.
    thisTabOn('A');
    anotherTabSwitchesTo('B');

    const options = hooks.getRouteQueryOptions('r1');
    expect(options.queryKey).toEqual(['route', 'A', 'r1']);

    await (options.queryFn as () => Promise<unknown>)();
    expect(lastInstance()).toBe('A');
  });

  it('is this tab’s for a list query built outside React', async () => {
    // A route loader builds the options without the hook's instance.
    thisTabOn('A');
    anotherTabSwitchesTo('B');

    const options = hooks.getRouteListQueryOptions({ page: 1, page_size: 10 });
    expect(options.queryKey[1]).toBe('A');

    await (options.queryFn as () => Promise<unknown>)();
    expect(lastInstance()).toBe('A');
  });

  it('is the stored one before this tab has any', () => {
    thisTabOn('');
    anotherTabSwitchesTo('B');

    expect(hooks.getRouteQueryOptions('r1').queryKey).toEqual(['route', 'B', 'r1']);
  });
});

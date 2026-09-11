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

type ClientModule = typeof import('./client');
type LabelsModule = typeof import('./labels');
type TeamsModule = typeof import('./teams');
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

let apiClient: ClientModule['apiClient'];
let labelApi: LabelsModule['labelApi'];
let teamApi: TeamsModule['teamApi'];
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
const sent: InternalAxiosRequestConfig[] = [];

beforeAll(async () => {
  ({ apiClient } = await import('./client'));
  ({ labelApi } = await import('./labels'));
  ({ teamApi } = await import('./teams'));
  ({ currentInstanceIdAtom } = await import('@/stores/instance'));
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    return {
      data: { list: [], total: 0 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
});

const lastHeader = (name: string) =>
  sent[sent.length - 1]?.headers.get(name);

// The atom is this tab's own; localStorage is every tab's. Another tab
// switching instance writes localStorage, and nothing here listens for it.
const thisTabOn = (instance: string) =>
  getDefaultStore().set(currentInstanceIdAtom, instance);
const anotherTabSwitchesTo = (instance: string) =>
  storage.set('instance:current_id', instance);

beforeEach(() => {
  storage.clear();
  sent.length = 0;
  storage.set('team:current_id:A', 'team-a');
  storage.set('team:current_id:B', 'team-b');
});

describe('the instance the dashboard’s own client addresses', () => {
  it('is this tab’s for an ownership write, whatever another tab has switched to', async () => {
    // The Reassign Team dialog on a route this tab shows from A. Addressed
    // from localStorage, the write went to B — the other tab's instance —
    // and the refetch that followed, from A, showed nothing changed (#193).
    thisTabOn('A');
    anotherTabSwitchesTo('B');

    await teamApi.reassignOwnership('routes', 'r1', 'team-x');
    expect(lastHeader('X-Instance-ID')).toBe('A');
    expect(lastHeader('X-Team-ID')).toBe('team-a');
  });

  it('is this tab’s for the label catalogue, which is per instance', async () => {
    thisTabOn('A');
    anotherTabSwitchesTo('B');

    await labelApi.list();
    expect(lastHeader('X-Instance-ID')).toBe('A');
  });

  it('is one the caller names, when it names one', async () => {
    thisTabOn('A');

    await apiClient.get('/api/v1/labels', { headers: { 'X-Instance-ID': 'B' } });
    expect(lastHeader('X-Instance-ID')).toBe('B');
    expect(lastHeader('X-Team-ID')).toBe('team-b');
  });

  it('is the stored one before this tab has any', async () => {
    thisTabOn('');
    anotherTabSwitchesTo('B');

    await apiClient.get('/api/v1/user');
    expect(lastHeader('X-Instance-ID')).toBe('B');
  });
});

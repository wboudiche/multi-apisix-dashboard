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

type TeamModule = typeof import('./team');
type InstanceModule = typeof import('./instance');
type ReqModule = typeof import('@/config/req');
type ClientModule = typeof import('@/apis/client');

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

let currentTeamIdAtom: TeamModule['currentTeamIdAtom'];
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
let req: ReqModule['req'];
let reqFor: ReqModule['reqFor'];
let apiClient: ClientModule['apiClient'];
const sent: InternalAxiosRequestConfig[] = [];

const answer = async (config: InternalAxiosRequestConfig) => {
  sent.push(config);
  return {
    data: { list: [], total: 0 },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
};

beforeAll(async () => {
  ({ currentTeamIdAtom } = await import('./team'));
  ({ currentInstanceIdAtom } = await import('./instance'));
  ({ req, reqFor } = await import('@/config/req'));
  ({ apiClient } = await import('@/apis/client'));
  req.defaults.adapter = answer;
  apiClient.defaults.adapter = answer;
});

const store = () => getDefaultStore();
const lastTeam = () => sent[sent.length - 1]?.headers.get('X-Team-ID');

// The atoms are this tab's own; localStorage is every tab's, and nothing
// listens for another tab writing it.
const anotherTabPicks = (instance: string, team: string) =>
  storage.set(`team:current_id:${instance}`, team);

let n = 0;
beforeEach(() => {
  storage.clear();
  sent.length = 0;
  // A fresh instance id per test: the team atom keeps what it read for an
  // instance, so reusing one would carry a test's choice into the next.
  n += 1;
  store().set(currentInstanceIdAtom, `inst-${n}`);
});
const here = () => `inst-${n}`;

describe('the team this tab works with', () => {
  it('is the one just picked, as soon as it is picked', () => {
    // The header's team selector shows this atom.
    expect(store().get(currentTeamIdAtom)).toBe('');
    store().set(currentTeamIdAtom, 'T1');
    expect(store().get(currentTeamIdAtom)).toBe('T1');
  });

  it('is what APISIX requests send, whatever another tab has picked', async () => {
    // For an admin, X-Team-ID is the team a created resource is assigned to.
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(here(), 'T2');

    await req.get('/routes');
    expect(lastTeam()).toBe('T1');
  });

  it('is what the dashboard’s own requests send, whatever another tab has picked', async () => {
    store().set(currentTeamIdAtom, 'T1');
    anotherTabPicks(here(), 'T2');

    await apiClient.get('/api/v1/labels');
    expect(lastTeam()).toBe('T1');
  });

  it('is "All Teams" once picked, not another tab’s team', async () => {
    store().set(currentTeamIdAtom, 'T1');
    store().set(currentTeamIdAtom, '');
    anotherTabPicks(here(), 'T2');

    expect(store().get(currentTeamIdAtom)).toBe('');
    await req.get('/routes');
    expect(sent).toHaveLength(1);
    expect(lastTeam()).toBeUndefined();
  });

  it('is still this tab’s pick after a switch to another instance and back', () => {
    const other = `${here()}-other`;
    store().set(currentTeamIdAtom, 'T1');
    store().set(currentInstanceIdAtom, other);
    anotherTabPicks(here(), 'T2');
    store().set(currentInstanceIdAtom, here());

    expect(store().get(currentTeamIdAtom)).toBe('T1');
  });

  it('is the stored one before this tab has picked any', async () => {
    anotherTabPicks(here(), 'T2');

    await req.get('/routes');
    expect(lastTeam()).toBe('T2');
  });

  it('is this tab’s choice for an instance a request names', async () => {
    const other = `${here()}-other`;
    store().set(currentInstanceIdAtom, other);
    store().set(currentTeamIdAtom, 'T-other');
    store().set(currentInstanceIdAtom, here());
    anotherTabPicks(other, 'T2');

    await reqFor(other).get('/routes');
    expect(lastTeam()).toBe('T-other');
  });
});

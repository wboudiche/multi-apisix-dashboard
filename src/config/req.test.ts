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
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { getDefaultStore } from 'jotai';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ReqModule = typeof import('./req');
type InstanceModule = typeof import('@/stores/instance');
type ProxyErrorModule = typeof import('@/stores/proxyError');

// req and the stores it reads touch localStorage as their modules load, and
// this suite runs in node: a Map stands in for it, installed before they are
// imported.
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

let req: ReqModule['req'];
let reqFor: ReqModule['reqFor'];
let currentInstanceIdAtom: InstanceModule['currentInstanceIdAtom'];
let proxyErrorAtom: ProxyErrorModule['proxyErrorAtom'];

// What the gateway answers, and every request that reached it.
type Answer = (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
let answer: Answer;
const sent: InternalAxiosRequestConfig[] = [];

const ok: Answer = (config) =>
  Promise.resolve({
    data: { value: {} },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });

const badGateway: Answer = (config) =>
  Promise.reject(
    new AxiosError('Bad Gateway', AxiosError.ERR_BAD_RESPONSE, config, null, {
      data: { error_msg: 'unreachable' },
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      config,
    })
  );

beforeAll(async () => {
  ({ req, reqFor } = await import('./req'));
  ({ currentInstanceIdAtom } = await import('@/stores/instance'));
  ({ proxyErrorAtom } = await import('@/stores/proxyError'));
  req.defaults.adapter = (config) => {
    sent.push(config);
    return answer(config);
  };
});

const store = () => getDefaultStore();
const lastHeader = (name: string) => sent[sent.length - 1]?.headers.get(name);

beforeEach(() => {
  storage.clear();
  sent.length = 0;
  answer = ok;
  storage.set('team:current_id:A', 'team-a');
  storage.set('team:current_id:B', 'team-b');
  store().set(currentInstanceIdAtom, 'A');
  store().set(proxyErrorAtom, null);
});

describe('the instance a request is addressed to', () => {
  it('is the selected one, with its team, when the caller names none', async () => {
    await req.get('/routes');
    expect(lastHeader('X-Instance-ID')).toBe('A');
    expect(lastHeader('X-Team-ID')).toBe('team-a');
  });

  it('is the one the caller names, with that instance’s team, whichever is selected', async () => {
    // A query keyed on B that runs after a switch to A — a retry, or a
    // refetch from a page already unmounted — has to be answered by B, or it
    // stores A's answer under B's key (#187).
    await reqFor('B').get('/routes/r1');
    expect(lastHeader('X-Instance-ID')).toBe('B');
    expect(lastHeader('X-Team-ID')).toBe('team-b');
  });

  it('is the one named for writes as well as reads', async () => {
    await reqFor('B').put('/routes/r1', {});
    expect(lastHeader('X-Instance-ID')).toBe('B');
  });

  it('keeps the headers a caller passes alongside', async () => {
    await reqFor('B').get('/routes/r1', { headers: { 'X-Probe': '1' } });
    expect(lastHeader('X-Probe')).toBe('1');
    expect(lastHeader('X-Instance-ID')).toBe('B');
  });

  it('is the selected one when the name is empty', async () => {
    await reqFor('').get('/routes');
    expect(lastHeader('X-Instance-ID')).toBe('A');
  });
});

describe('the proxy error banner', () => {
  it('names the instance that failed, not the one selected', async () => {
    answer = badGateway;
    await expect(reqFor('B').get('/routes')).rejects.toBeInstanceOf(AxiosError);
    expect(store().get(proxyErrorAtom)?.instanceId).toBe('B');
  });

  it('stays up when another instance answers', async () => {
    // B unreachable, then a request to A lands — a save made on A before a
    // switch to B, say. That says nothing about B.
    store().set(proxyErrorAtom, { instanceId: 'B', status: 502, message: '' });
    await reqFor('A').get('/routes');
    expect(store().get(proxyErrorAtom)?.instanceId).toBe('B');
  });

  it('clears when the instance it names answers', async () => {
    store().set(proxyErrorAtom, { instanceId: 'B', status: 502, message: '' });
    await reqFor('B').get('/routes');
    expect(store().get(proxyErrorAtom)).toBeNull();
  });
});

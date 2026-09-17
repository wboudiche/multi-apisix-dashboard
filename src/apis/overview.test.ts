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

import { MalformedResponseError } from '@/utils/response-shape';

type OverviewModule = typeof import('./overview');

// Importing the module reaches apiClient, whose stores read localStorage as
// they load, and this suite runs in node. Same stand-in as client.test.ts.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
});

let parseOverview: OverviewModule['parseOverview'];
let overviewApi: OverviewModule['overviewApi'];
const sent: string[] = [];
let body: unknown;

beforeAll(async () => {
  const { apiClient } = await import('./client');
  ({ overviewApi, parseOverview } = await import('./overview'));
  apiClient.defaults.adapter = async (config) => {
    sent.push(apiClient.getUri(config));
    return { data: body, status: 200, statusText: 'OK', headers: {}, config };
  };
});

const overview = {
  total_instances: 2,
  active_instances: 1,
  global_stats: { routes: 3, services: 2, upstreams: 1 },
  instance_stats: { routes: 0, services: 0, upstreams: 0 },
  all_instances: [
    {
      instance_id: 'i1',
      name: 'Local',
      status: 'Connected',
      last_check: '2026-09-17T23:00:00Z',
    },
  ],
};

const without = (field: string) => {
  const rest: Record<string, unknown> = { ...overview };
  delete rest[field];
  return rest;
};

describe('the overview a page is allowed to render', () => {
  it('is the backend’s own answer, returned as it came', () => {
    expect(parseOverview(overview)).toBe(overview);
  });

  it('is not an answer without the counters the page reads', () => {
    // {"total":0} is the misrouted body #165 describes. It used to reach state
    // and throw during render, on `data?.global_stats.routes` — the route has
    // no error component of its own, so the root’s replaced the page.
    expect(() => parseOverview({ total: 0 })).toThrow(MalformedResponseError);
    expect(() => parseOverview(without('global_stats'))).toThrow(/global_stats/);
    expect(() => parseOverview(without('all_instances'))).toThrow(/instance health/);
    expect(() => parseOverview({ ...overview, total_instances: '2' })).toThrow(
      /numeric total_instances/
    );
  });

  it('is not an answer whose counters are not numbers', () => {
    // React is handed these directly: an object there is "Objects are not valid
    // as a React child", the same crash one property along.
    expect(() =>
      parseOverview({ ...overview, global_stats: { routes: {}, services: 2, upstreams: 1 } })
    ).toThrow(/global_stats/);
    expect(() =>
      parseOverview({ ...overview, global_stats: { services: 2, upstreams: 1 } })
    ).toThrow(/global_stats/);
  });

  it('is not an answer whose instances are not instances', () => {
    // The connectivity table reads inst.name and inst.instance_id on each row.
    expect(() => parseOverview({ ...overview, all_instances: [null] })).toThrow(
      /instance health/
    );
    expect(() => parseOverview({ ...overview, all_instances: ['Local'] })).toThrow(
      /instance health/
    );
    expect(() =>
      parseOverview({ ...overview, all_instances: [{ ...overview.all_instances[0], name: 7 }] })
    ).toThrow(/instance health/);
  });

  it('is an answer whose instances carry a status it does not know', () => {
    // Read as disconnected, in red, carrying its own name: wrong in the colour
    // and right in the text. Refusing the body over it would take the page
    // away, which is worse than the defect it would be reporting.
    expect(
      parseOverview({
        ...overview,
        all_instances: [{ ...overview.all_instances[0], status: 'Degraded' }],
      })
    ).toBeTruthy();
  });

  it('is not a list, a string or nothing', () => {
    expect(() => parseOverview([])).toThrow(/got a list/);
    expect(() => parseOverview('<!doctype html>')).toThrow(/got string/);
    expect(() => parseOverview(null)).toThrow(/got null/);
  });

  it('names the request it failed on, since no page shows which one it was', () => {
    expect(() => parseOverview({ total: 0 })).toThrow(/^\/api\/v1\/overview: /);
  });

  // instance_stats is the one field the page never reads. The backend sends it
  // as zeroes rather than leaving it out, but requiring it would be a rule
  // about a field nothing renders.
  it('is an answer without instance_stats', () => {
    expect(parseOverview(without('instance_stats'))).toBeTruthy();
  });
});

describe('the overview request', () => {
  it('asks for a refresh only when the caller does', async () => {
    body = overview;
    await overviewApi.get();
    expect(sent[sent.length - 1]).not.toContain('refresh');
    await overviewApi.get(true);
    expect(sent[sent.length - 1]).toContain('refresh=true');
  });

  it('rejects a body of another shape rather than returning it', async () => {
    body = { total: 0 };
    await expect(overviewApi.get()).rejects.toBeInstanceOf(MalformedResponseError);
  });
});

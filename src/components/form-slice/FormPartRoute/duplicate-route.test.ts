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

import type { APISIXType } from '@/types/schema/apisix';

import { duplicateRouteBody, duplicateRouteErrors, quickRouteFromRoute } from './duplicate-route';
import type { QuickRoute } from './quick-create';

const source = {
  id: 'r1',
  create_time: 1,
  update_time: 2,
  name: 'orders',
  desc: 'the orders API',
  uri: '/api/orders/*',
  methods: ['GET', 'POST'],
  host: 'api.example.com',
  hosts: undefined,
  priority: 5,
  labels: { team: 'shop' },
  vars: [['http_x_env', '==', 'beta']],
  status: 1,
  plugins: { 'limit-count': { count: 10, time_window: 60 } },
  upstream_id: 'old-upstream',
  __team_id: 't1',
  __upstream_id: 'old-upstream',
} as unknown as APISIXType['Route'];

const copy = (patch: Partial<QuickRoute> = {}): QuickRoute => ({
  ...quickRouteFromRoute(source, 'orders (copy)'),
  ...patch,
});

describe('quickRouteFromRoute', () => {
  it('starts from the route\'s path, methods and host, offline, to the same destination', () => {
    expect(quickRouteFromRoute(source, 'orders (copy)')).toEqual({
      path: '/api/orders/*',
      methods: ['GET', 'POST'],
      host: 'api.example.com',
      name: 'orders (copy)',
      status: 0,
      destination: { kind: 'same' },
    });
  });

  it('takes the first of a route\'s uris when it has no uri', () => {
    const withUris = { ...source, uris: ['/a', '/b'] } as APISIXType['Route'];
    delete withUris.uri;
    expect(quickRouteFromRoute(withUris, 'x').path).toBe('/a');
  });
});

describe('duplicateRouteBody', () => {
  it('copies everything but what makes the route this one', () => {
    const body = duplicateRouteBody(source, copy());
    expect(body).toEqual({
      name: 'orders (copy)',
      desc: 'the orders API',
      uri: '/api/orders/*',
      methods: ['GET', 'POST'],
      host: 'api.example.com',
      priority: 5,
      labels: { team: 'shop' },
      vars: [['http_x_env', '==', 'beta']],
      status: 0,
      plugins: { 'limit-count': { count: 10, time_window: 60 } },
      upstream_id: 'old-upstream',
    });
  });

  it('points the copy at another upstream, and only there', () => {
    const body = duplicateRouteBody(source, copy({ destination: { kind: 'upstream', upstreamId: 'new-upstream' } }));
    expect(body.upstream_id).toBe('new-upstream');
    expect(body.upstream).toBeUndefined();
    expect(body.service_id).toBeUndefined();
    expect(body.plugins).toEqual(source.plugins);
  });

  it('binds the copy to a service instead', () => {
    const body = duplicateRouteBody(source, copy({ destination: { kind: 'service', serviceId: 's1' } }));
    expect(body.service_id).toBe('s1');
    expect(body.upstream_id).toBeUndefined();
  });

  it('sends the copy to an address, as the quick create would', () => {
    const body = duplicateRouteBody(source, copy({ destination: { kind: 'url', url: 'http://10.0.0.5:8080/v2' } }));
    expect(body.upstream_id).toBeUndefined();
    expect(body.upstream).toEqual({
      type: 'roundrobin',
      scheme: 'http',
      pass_host: 'node',
      nodes: [{ host: '10.0.0.5', port: 8080, weight: 1 }],
      timeout: { connect: 6, send: 6, read: 6 },
    });
    // The route's own plugins stay, the address's path is added beside them.
    expect(body.plugins).toEqual({
      'limit-count': { count: 10, time_window: 60 },
      'proxy-rewrite': { regex_uri: ['^(.*)$', '/v2$1'] },
    });
  });

  it('keeps what else the route rewrites when the address adds a path', () => {
    const rewriting = { ...source, plugins: { 'proxy-rewrite': { headers: { set: { 'X-A': '1' } } } } } as APISIXType['Route'];
    const body = duplicateRouteBody(rewriting, {
      ...quickRouteFromRoute(rewriting, 'x'),
      destination: { kind: 'url', url: 'http://b/v2' },
    });
    expect(body.plugins?.['proxy-rewrite']).toEqual({ headers: { set: { 'X-A': '1' } }, regex_uri: ['^(.*)$', '/v2$1'] });
  });

  it('takes a changed path as the copy\'s one uri', () => {
    const many = { ...source, uris: ['/a', '/b'] } as APISIXType['Route'];
    delete many.uri;
    expect(duplicateRouteBody(many, { ...quickRouteFromRoute(many, 'x') }).uris).toEqual(['/a', '/b']);
    const moved = duplicateRouteBody(many, { ...quickRouteFromRoute(many, 'x'), path: '/c' });
    expect(moved.uri).toBe('/c');
    expect(moved.uris).toBeUndefined();
  });

  it('drops the methods when none is chosen, and the host when emptied', () => {
    const body = duplicateRouteBody(source, copy({ methods: [], host: ' ' }));
    expect(body.methods).toBeUndefined();
    expect(body.host).toBeUndefined();
  });

  it('keeps the route\'s hosts, and puts a host typed in their place', () => {
    const many = { ...source, hosts: ['a.test', 'b.test'] } as APISIXType['Route'];
    delete many.host;
    const kept = duplicateRouteBody(many, quickRouteFromRoute(many, 'x'));
    expect(kept.hosts).toEqual(['a.test', 'b.test']);
    expect(kept.host).toBeUndefined();
    // host and hosts cannot both be set: the one typed is the copy's.
    const typed = duplicateRouteBody(many, { ...quickRouteFromRoute(many, 'x'), host: 'c.test' });
    expect(typed.host).toBe('c.test');
    expect(typed.hosts).toBeUndefined();
  });

  it('publishes the copy only when asked', () => {
    expect(duplicateRouteBody(source, copy({ status: 1 })).status).toBe(1);
  });
});

describe('duplicateRouteErrors', () => {
  it('finds nothing wrong with a copy to the same destination', () => {
    expect(duplicateRouteErrors(source, copy())).toEqual({});
  });

  it('asks for a name and a path that starts with a slash', () => {
    expect(duplicateRouteErrors(source, copy({ name: ' ' })).name).toBe('form.validation.nameRequired');
    expect(duplicateRouteErrors(source, copy({ path: 'api' })).path).toBe('form.validation.pathSlash');
  });

  it('names what the new destination is missing', () => {
    expect(duplicateRouteErrors(source, copy({ destination: { kind: 'upstream', upstreamId: '' } })).destination)
      .toBe('form.validation.upstreamRequired');
    expect(duplicateRouteErrors(source, copy({ destination: { kind: 'url', url: 'nope' } })).destination)
      .toBe('form.validation.destinationUrl');
  });

  it('refuses an address path when the route already rewrites its path', () => {
    const rewriting = { ...source, plugins: { 'proxy-rewrite': { uri: '/fixed' } } } as APISIXType['Route'];
    const q = { ...quickRouteFromRoute(rewriting, 'x'), destination: { kind: 'url', url: 'http://b/v2' } } as QuickRoute;
    expect(duplicateRouteErrors(rewriting, q).destination).toBe('form.validation.destinationPathRewritten');
    // Without a path of its own, the address is fine.
    const plain = { ...q, destination: { kind: 'url', url: 'http://b' } } as QuickRoute;
    expect(duplicateRouteErrors(rewriting, plain).destination).toBeUndefined();
  });
});

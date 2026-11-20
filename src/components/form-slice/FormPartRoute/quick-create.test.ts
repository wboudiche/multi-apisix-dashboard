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
  destinationUrlError,
  proposeRouteName,
  type QuickRoute,
  quickRouteErrors,
  quickRouteToDraft,
  quickRouteToForm,
  ROUTE_ADD_DEFAULTS,
} from './quick-create';
import { RoutePostSchema } from './schema';
import { produceRoute } from './util';

const base: QuickRoute = {
  path: '/api/orders/*',
  methods: ['GET', 'POST'],
  host: '',
  name: 'orders',
  status: 1,
  destination: { kind: 'url', url: 'http://10.0.0.5:8080' },
};

describe('proposeRouteName', () => {
  it('names a route by its one method and its path', () => {
    expect(proposeRouteName(['GET'], '/api/orders/*')).toBe('GET /api/orders/*');
  });

  it('names a route of several methods, or of all, by its path alone', () => {
    expect(proposeRouteName(['GET', 'POST'], '/api/orders')).toBe('/api/orders');
    expect(proposeRouteName([], '/api/orders')).toBe('/api/orders');
  });

  it('proposes nothing before there is a path', () => {
    expect(proposeRouteName(['GET'], '  ')).toBe('');
  });
});

describe('destinationUrlError', () => {
  it('accepts an http or https address', () => {
    expect(destinationUrlError('http://10.0.0.5:8080')).toBeUndefined();
    expect(destinationUrlError('https://api.example.com/v1')).toBeUndefined();
  });

  it('asks for an address when there is none', () => {
    expect(destinationUrlError('')).toBe('form.validation.destinationRequired');
  });

  it('refuses what the gateway cannot reach', () => {
    expect(destinationUrlError('10.0.0.5:8080')).toBe('form.validation.destinationUrl');
    expect(destinationUrlError('ftp://files.example.com')).toBe('form.validation.destinationUrl');
  });
});

describe('quickRouteToForm', () => {
  it('turns an address into the inline upstream the wizard would have built', () => {
    const form = quickRouteToForm(base);
    expect(form.upstream_id).toBe('custom');
    expect(form.upstream).toEqual({
      type: 'roundrobin',
      scheme: 'http',
      pass_host: 'node',
      nodes: [{ host: '10.0.0.5', port: 8080, weight: 1 }],
      timeout: { connect: 6, send: 6, read: 6 },
    });
    expect(form.plugins).toEqual({});
  });

  it('gives an address without a port the scheme\'s own', () => {
    const form = quickRouteToForm({ ...base, destination: { kind: 'url', url: 'https://api.example.com' } });
    expect(form.upstream?.nodes).toEqual([{ host: 'api.example.com', port: 443, weight: 1 }]);
    expect(form.upstream?.scheme).toBe('https');
  });

  it('prefixes the address\'s base path to every request, as the importer does', () => {
    const form = quickRouteToForm({ ...base, destination: { kind: 'url', url: 'http://backend:8080/v1/' } });
    expect(form.plugins).toEqual({ 'proxy-rewrite': { regex_uri: ['^(.*)$', '/v1$1'] } });
  });

  it('points at an existing upstream by its id', () => {
    const form = quickRouteToForm({ ...base, destination: { kind: 'upstream', upstreamId: 'u1' } });
    expect(form.upstream_id).toBe('u1');
    expect(form.upstream).toBeUndefined();
    expect(form.service_id).toBeUndefined();
  });

  it('binds to a service by its id', () => {
    const form = quickRouteToForm({ ...base, destination: { kind: 'service', serviceId: 's1' } });
    expect(form.service_id).toBe('s1');
    expect(form.upstream_id).toBeUndefined();
  });

  it('carries the path, the methods, the name and the status as given', () => {
    const form = quickRouteToForm({ ...base, status: 0 });
    expect(form).toMatchObject({ name: 'orders', uri: '/api/orders/*', methods: ['GET', 'POST'], status: 0 });
  });

  it('leaves the methods out when none is chosen: every method', () => {
    expect(quickRouteToForm({ ...base, methods: [] }).methods).toBeUndefined();
  });

  it('sets a host only when one is given, trimmed', () => {
    expect(quickRouteToForm(base).host).toBeUndefined();
    expect(quickRouteToForm({ ...base, host: ' api.example.com ' }).host).toBe('api.example.com');
  });

  it('passes the wizard\'s own schema, for each destination', () => {
    for (const destination of [
      base.destination,
      { kind: 'upstream', upstreamId: 'u1' } as const,
      { kind: 'service', serviceId: 's1' } as const,
    ]) {
      const parsed = RoutePostSchema.safeParse(quickRouteToForm({ ...base, destination }));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('names an unnamed route with the name it proposes', () => {
    expect(quickRouteToForm({ ...base, name: ' ', methods: ['GET'] }).name).toBe('GET /api/orders/*');
  });

  it('is posted as the inline upstream, without the wizard\'s marker', () => {
    const body = produceRoute(quickRouteToForm(base));
    expect(body.upstream_id).toBeUndefined();
    expect(body.upstream?.nodes).toEqual([{ host: '10.0.0.5', port: 8080, weight: 1 }]);
  });
});

describe('quickRouteToDraft', () => {
  it('hands the wizard every answer given, on top of its own defaults', () => {
    const draft = quickRouteToDraft({ ...base, host: 'api.example.com' });
    expect(draft).toMatchObject({
      name: 'orders',
      uri: '/api/orders/*',
      methods: ['GET', 'POST'],
      host: 'api.example.com',
      status: 1,
      upstream_id: 'custom',
    });
    expect(draft.upstream?.nodes).toEqual([{ host: '10.0.0.5', port: 8080, weight: 1 }]);
  });

  it('keeps the wizard\'s empty upstream while no address is usable yet', () => {
    const draft = quickRouteToDraft({ ...base, destination: { kind: 'url', url: '' } });
    expect(draft.upstream_id).toBe(ROUTE_ADD_DEFAULTS.upstream_id);
    expect(draft.upstream).toEqual(ROUTE_ADD_DEFAULTS.upstream);
  });

  it('keeps every method when none is chosen, rather than the wizard\'s four', () => {
    expect(quickRouteToDraft({ ...base, methods: [] }).methods).toBeUndefined();
  });

  it('keeps the wizard\'s default path while none is typed', () => {
    expect(quickRouteToDraft({ ...base, path: '' }).uri).toBe(ROUTE_ADD_DEFAULTS.uri);
  });

  it('leaves no inline upstream beside an upstream picked by id', () => {
    const draft = quickRouteToDraft({ ...base, destination: { kind: 'upstream', upstreamId: 'u1' } });
    expect(draft.upstream_id).toBe('u1');
    expect(produceRoute(draft).upstream).toBeUndefined();
  });
});

describe('what the dialog may not post', () => {
  it('refuses an address that carries more than where the backend is', () => {
    for (const url of [
      'http://user:pw@backend:8080',
      'http://backend:8080/v1?apikey=abc',
      'http://backend:8080/v1#top',
      'http://backend:8080/api$1/v2',
    ]) {
      expect(destinationUrlError(url), url).toBe('form.validation.destinationUrlPlain');
    }
  });

  it('leaves an upstream or a service not picked yet as no destination at all', () => {
    const upstream = quickRouteToForm({ ...base, destination: { kind: 'upstream', upstreamId: '' } });
    expect(upstream.upstream_id).toBeUndefined();
    const service = quickRouteToForm({ ...base, destination: { kind: 'service', serviceId: '' } });
    expect(service.service_id).toBeUndefined();
  });

  it('hands the wizard its own empty upstream when nothing was picked', () => {
    for (const destination of [
      { kind: 'upstream', upstreamId: '' } as const,
      { kind: 'service', serviceId: '' } as const,
    ]) {
      const draft = quickRouteToDraft({ ...base, destination });
      expect(draft.upstream_id).toBe(ROUTE_ADD_DEFAULTS.upstream_id);
      expect(draft.upstream).toEqual(ROUTE_ADD_DEFAULTS.upstream);
      expect(draft.service_id).toBeUndefined();
    }
  });
});

describe('quickRouteErrors', () => {
  it('finds nothing wrong with a complete route', () => {
    expect(quickRouteErrors(base)).toEqual({});
  });

  it('asks for a path, and for one that starts with a slash', () => {
    expect(quickRouteErrors({ ...base, path: ' ' }).path).toBe('form.validation.uriRequired');
    expect(quickRouteErrors({ ...base, path: 'api/orders' }).path).toBe('form.validation.pathSlash');
  });

  it('asks for a name only when none can be proposed either', () => {
    expect(quickRouteErrors({ ...base, name: '' }).name).toBeUndefined();
    expect(quickRouteErrors({ ...base, name: '', path: '' }).name).toBe('form.validation.nameRequired');
  });

  it('names what each destination is missing', () => {
    expect(quickRouteErrors({ ...base, destination: { kind: 'url', url: '' } }).destination)
      .toBe('form.validation.destinationRequired');
    expect(quickRouteErrors({ ...base, destination: { kind: 'upstream', upstreamId: '' } }).destination)
      .toBe('form.validation.upstreamRequired');
    expect(quickRouteErrors({ ...base, destination: { kind: 'service', serviceId: '' } }).destination)
      .toBe('form.validation.serviceRequired');
  });

  it('holds what it posts to the wizard\'s own schema', () => {
    // A methods value the schema refuses stands in for any rule the wizard's
    // schema has and the dialog's own checks do not.
    const errors = quickRouteErrors({ ...base, methods: ['BREW'] });
    expect(errors.other?.length).toBeGreaterThan(0);
  });
});

describe('who may call a quick route', () => {
  it('adds no plugin for anyone, as before there was a choice', () => {
    expect(quickRouteToForm({ ...base, access: { plugin: null } }).plugins).toEqual({});
    expect(quickRouteToForm(base).plugins).toEqual({});
  });

  it('asks for the authentication picked, with its own defaults', () => {
    const form = quickRouteToForm({
      ...base,
      access: { plugin: 'key-auth', restriction: { mode: 'any' } },
    });
    expect(form.plugins).toEqual({ 'key-auth': {} });
  });

  it('lets only the clients picked through, as the advanced form writes it', () => {
    const form = quickRouteToForm({
      ...base,
      access: { plugin: 'basic-auth', restriction: { mode: 'only', names: ['billing', 'ops'] } },
    });
    expect(form.plugins).toEqual({
      'basic-auth': {},
      'consumer-restriction': { whitelist: ['billing', 'ops'] },
    });
  });

  it('keeps the authentication beside the rewrite an address with a path makes', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'url', url: 'http://10.0.0.5:8080/v1' },
      access: { plugin: 'key-auth', restriction: { mode: 'any' } },
    });
    expect(Object.keys(form.plugins ?? {}).sort()).toEqual(['key-auth', 'proxy-rewrite']);
  });

  it('keeps the settings a service gives the authentication, rather than emptying them', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      access: { plugin: 'key-auth', restriction: { mode: 'any' }, config: { header: 'X-Key' } },
    });
    expect(form.plugins).toEqual({ 'key-auth': { header: 'X-Key' } });
  });

  it('hands the authentication to the advanced form', () => {
    const draft = quickRouteToDraft({
      ...base,
      access: { plugin: 'key-auth', restriction: { mode: 'only', names: ['billing'] } },
    });
    expect(draft.plugins).toEqual({
      'key-auth': {},
      'consumer-restriction': { whitelist: ['billing'] },
    });
  });

  it('refuses a route only the clients picked may call, with none picked', () => {
    const errors = quickRouteErrors({
      ...base,
      access: { plugin: 'key-auth', restriction: { mode: 'only', names: [] } },
    });
    expect(errors.access).toBe('form.plugins.clients.accessEmpty');
    expect(
      quickRouteErrors({ ...base, access: { plugin: 'key-auth', restriction: { mode: 'any' } } })
    ).toEqual({});
  });

  it('passes the wizard\'s own schema with an authentication', () => {
    const form = quickRouteToForm({
      ...base,
      access: { plugin: 'basic-auth', restriction: { mode: 'only', names: ['ops'] } },
    });
    expect(RoutePostSchema.safeParse(form).success).toBe(true);
  });
});

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

import type { Restriction as QuickRestriction } from '@/utils/auth-clients';

import {
  answerErrors,
  destinationUrlError,
  type KeycloakChoice,
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

describe('what the quick page may not post', () => {
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
    // schema has and the quick page's own checks do not.
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

describe('a quick route on a service that restricts its clients', () => {
  const service = { whitelist: ['billing'], rejected_code: 401 };
  const onService = (restriction: QuickRestriction) =>
    quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      access: { plugin: 'key-auth', restriction, inheritedRestriction: service },
    }).plugins;

  it('switches the service\'s off for this route when every client may call', () => {
    expect(onService({ mode: 'any' })?.['consumer-restriction']).toEqual({
      whitelist: ['billing'],
      rejected_code: 401,
      _meta: { disable: true },
    });
  });

  it('keeps how the service answers a client turned away, beside the clients picked', () => {
    expect(onService({ mode: 'only', names: ['ops'] })?.['consumer-restriction']).toEqual({
      whitelist: ['ops'],
      rejected_code: 401,
    });
  });

  it('takes nothing from the service\'s that could open the clients picked to others', () => {
    const plugins = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      access: {
        plugin: 'key-auth',
        restriction: { mode: 'only', names: ['ops'] },
        inheritedRestriction: {
          whitelist: ['billing'],
          blacklist: ['x'],
          rejected_msg: 'no',
          _meta: { disable: true, filter: [['arg_a', '==', '1']], priority: 2401 },
        },
      },
    }).plugins;
    expect(plugins?.['consumer-restriction']).toEqual({
      whitelist: ['ops'],
      rejected_msg: 'no',
    });
  });

  it('leaves a restriction it cannot show to the service', () => {
    expect(onService({ mode: 'custom' })).toEqual({ 'key-auth': {} });
  });

  it('writes nothing for every client when the service restricts nobody', () => {
    expect(
      quickRouteToForm({ ...base, access: { plugin: 'key-auth', restriction: { mode: 'any' } } }).plugins
    ).toEqual({ 'key-auth': {} });
  });
});

describe('a quick route\'s limit on calls', () => {
  it('adds no limit unless asked for one', () => {
    expect(quickRouteToForm(base).plugins).toEqual({});
  });

  it('counts each IP address when anyone may call', () => {
    const form = quickRouteToForm({ ...base, rateLimit: { count: 100, per: 'minute' } });
    expect(form.plugins).toEqual({
      'limit-count': {
        count: 100,
        time_window: 60,
        key_type: 'var',
        key: 'remote_addr',
        rejected_code: 429,
        policy: 'local',
      },
    });
  });

  it('counts each client when the route asks who calls', () => {
    const form = quickRouteToForm({
      ...base,
      access: { plugin: 'key-auth', restriction: { mode: 'any' } },
      rateLimit: { count: 5, per: 'second' },
    });
    expect(form.plugins?.['limit-count']).toMatchObject({ count: 5, time_window: 1, key: 'consumer_name' });
    expect(form.plugins?.['key-auth']).toEqual({});
  });

  it('counts each client when the service asks who calls, though the route does not', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      rateLimit: { count: 5, per: 'minute', byClient: true },
    });
    expect(form.plugins?.['limit-count']).toMatchObject({ key: 'consumer_name' });
  });

  it('turns each period into its seconds', () => {
    const windowOf = (per: 'hour' | 'day') =>
      quickRouteToForm({ ...base, rateLimit: { count: 1, per } }).plugins?.['limit-count']?.time_window;
    expect(windowOf('hour')).toBe(3600);
    expect(windowOf('day')).toBe(86400);
  });

  it('refuses a count that is not a whole number of 1 or more', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(quickRouteErrors({ ...base, rateLimit: { count, per: 'minute' } }).rateLimit).toBe(
        'form.validation.rateLimitCount'
      );
    }
    expect(quickRouteErrors({ ...base, rateLimit: { count: 1, per: 'minute' } })).toEqual({});
  });

  it('hands the limit to the advanced form, and passes its schema', () => {
    const q = { ...base, rateLimit: { count: 10, per: 'hour' as const } };
    expect(quickRouteToDraft(q).plugins?.['limit-count']).toMatchObject({ count: 10, time_window: 3600 });
    expect(RoutePostSchema.safeParse(quickRouteToForm(q)).success).toBe(true);
  });
});

describe('the request sent to the backend', () => {
  /** What the advanced form's Request Override section holds. */
  const override = (rewrite: Record<string, unknown>, inherited?: Record<string, unknown>) => ({
    rewrite,
    ...(inherited && { inherited }),
  });

  it('writes no proxy-rewrite when nothing is changed', () => {
    expect(quickRouteToForm({ ...base, override: override({}) }).plugins).toEqual({});
  });

  it('writes what the section holds, every option of it', () => {
    const rewrite = {
      uri: '/new/path',
      host: 'api.internal',
      method: 'POST',
      headers: { set: { 'X-Env': 'prod' } },
    };
    expect(quickRouteToForm({ ...base, override: override(rewrite) }).plugins).toEqual({
      'proxy-rewrite': rewrite,
    });
  });

  it('keeps the address\'s base path beside what is changed', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'url', url: 'http://backend:8080/v1' },
      override: override({ host: 'api.internal' }),
    });
    expect(form.plugins).toEqual({
      'proxy-rewrite': { regex_uri: ['^(.*)$', '/v1$1'], host: 'api.internal' },
    });
  });

  it('lets a path the section rewrites take the base path\'s place', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'url', url: 'http://backend:8080/v1' },
      override: override({ regex_uri: ['^/api/(.*)', '/$1'] }),
    });
    expect(form.plugins).toEqual({ 'proxy-rewrite': { regex_uri: ['^/api/(.*)', '/$1'] } });
  });

  it('changes the request to an upstream picked too', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'upstream', upstreamId: 'u1' },
      override: override({ method: 'GET' }),
    });
    expect(form.plugins).toEqual({ 'proxy-rewrite': { method: 'GET' } });
  });

  it('hands the change over to the advanced form', () => {
    const draft = quickRouteToDraft({ ...base, override: override({ host: 'api.internal' }) });
    expect(draft.plugins?.['proxy-rewrite']).toEqual({ host: 'api.internal' });
  });

  it('lays the change over the rewrite of the service it goes through, not in its place', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override(
        { host: 'api.internal', headers: { set: { 'X-Env': 'prod' } } },
        { regex_uri: ['^(.*)$', '/v1$1'], headers: { set: { 'X-From': 'service' }, remove: ['Cookie'] } }
      ),
    });
    expect(form.plugins?.['proxy-rewrite']).toEqual({
      regex_uri: ['^(.*)$', '/v1$1'],
      host: 'api.internal',
      headers: { set: { 'X-From': 'service', 'X-Env': 'prod' }, remove: ['Cookie'] },
    });
  });

  it('leaves the service\'s rewrite to the service when nothing is changed', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override({}, { regex_uri: ['^(.*)$', '/v1$1'] }),
    });
    expect(form.plugins).toEqual({});
  });

  it('replaces the service\'s path rewrite with one of its own', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override({ uri: '/health' }, { regex_uri: ['^(.*)$', '/v1$1'], host: 'svc.internal' }),
    });
    expect(form.plugins?.['proxy-rewrite']).toEqual({ host: 'svc.internal', uri: '/health' });
  });

  it('reads a service\'s flat headers as headers set, and lays its own over them', () => {
    const form = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override({ headers: { set: { 'X-Env': 'prod' } } }, { headers: { 'X-Api': 'v2' } }),
    });
    expect(form.plugins?.['proxy-rewrite']).toEqual({ headers: { set: { 'X-Api': 'v2', 'X-Env': 'prod' } } });
  });

  it('does not carry over a service rewrite that is switched off, nor its _meta', () => {
    const off = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override({ host: 'api.internal' }, { regex_uri: ['^(.*)$', '/v1$1'], _meta: { disable: true } }),
    });
    expect(off.plugins?.['proxy-rewrite']).toEqual({ host: 'api.internal' });
    const on = quickRouteToForm({
      ...base,
      destination: { kind: 'service', serviceId: 's1' },
      override: override({ host: 'api.internal' }, { regex_uri: ['^(.*)$', '/v1$1'], _meta: { priority: 5 } }),
    });
    expect(on.plugins?.['proxy-rewrite']).toEqual({ regex_uri: ['^(.*)$', '/v1$1'], host: 'api.internal' });
  });

  it('posts the host trimmed', () => {
    const form = quickRouteToForm({ ...base, override: override({ host: ' api.internal ' }) });
    expect(form.plugins?.['proxy-rewrite']).toEqual({ host: 'api.internal' });
  });

  it('refuses a path rewritten to one without a leading slash', () => {
    expect(quickRouteErrors({ ...base, override: override({ uri: 'health' }) }).overrideUri).toBe(
      'form.validation.pathSlash'
    );
    expect(quickRouteErrors({ ...base, override: override({ uri: '/health' }) }).overrideUri).toBeUndefined();
  });

  it('refuses a header set here and taken off by the service, or a Host beside the service\'s host', () => {
    const service = (inherited: Record<string, unknown>, rewrite: Record<string, unknown>) =>
      quickRouteErrors({
        ...base,
        destination: { kind: 'service', serviceId: 's1' },
        override: override(rewrite, inherited),
      }).overrideHeaders;
    expect(service({ headers: { remove: ['Cookie'] } }, { headers: { set: { cookie: 'x' } } })).toBe(
      'form.validation.headerTwice'
    );
    expect(service({ host: 'svc.internal' }, { headers: { set: { Host: 'x' } } })).toBe(
      'form.validation.headerTwice'
    );
  });

  it('refuses a host the gateway would refuse, and says so on the host', () => {
    const hostError = (host: string) => quickRouteErrors({ ...base, override: override({ host }) }).overrideHost;
    expect(hostError('http://api.internal')).toBe('form.validation.overrideHost');
    expect(hostError('[::1]:8080')).toBe('form.validation.overrideHost');
    expect(hostError('api.internal:8443')).toBeUndefined();
  });

  it('refuses headers that would not be sent as typed', () => {
    const headersError = (rewrite: Record<string, unknown>) =>
      quickRouteErrors({ ...base, override: override(rewrite) }).overrideHeaders;
    expect(headersError({ headers: { set: { 'X Env': '1' } } })).toBe('form.validation.headerName');
    // The gateway reads a $ as one of its variables.
    expect(headersError({ headers: { set: { 'X-Token': 'pa$$' } } })).toBe('form.validation.headerValueDollar');
    // Twice, case aside; a Host beside the Host Override.
    expect(headersError({ headers: { set: { 'X-Env': 'a', 'x-env': 'b' } } })).toBe('form.validation.headerTwice');
    expect(headersError({ host: 'api.internal', headers: { set: { Host: 'x' } } })).toBe(
      'form.validation.headerTwice'
    );
    expect(headersError({ headers: { set: { 'X-Env': 'prod' } } })).toBeUndefined();
  });
});

describe('Keycloak token access', () => {
  const create = { kind: 'create', idpId: 'i', suffix: 's', validation: 'jwks' } as const;
  const withAccess = (keycloak: KeycloakChoice): QuickRoute => ({
    ...base,
    access: { plugin: 'openid-connect', keycloak },
  });

  it('posts no openid-connect and no consumer-restriction', () => {
    const { plugins } = quickRouteToForm(withAccess(create));
    expect(plugins).not.toHaveProperty('openid-connect');
    expect(plugins).not.toHaveProperty('consumer-restriction');
  });

  it('counts a limit by IP address', () => {
    const q = { ...withAccess(create), rateLimit: { count: 5, per: 'minute' as const } };
    expect(quickRouteToForm(q).plugins?.['limit-count']).toMatchObject({ key: 'remote_addr' });
  });

  it('hands nothing of it to the advanced form', () => {
    const draft = quickRouteToDraft(withAccess(create));
    expect(draft.plugins).not.toHaveProperty('openid-connect');
    expect(JSON.stringify(draft)).not.toMatch(/keycloak|secret/);
  });

  it('refuses a create with no connection or no client id', () => {
    expect(answerErrors(withAccess({ ...create, idpId: '' })).access).toBe(
      'form.quickRoute.keycloak.connectionRequired'
    );
    expect(answerErrors(withAccess({ ...create, suffix: '  ' })).access).toBe(
      'form.quickRoute.keycloak.clientIdRequired'
    );
  });

  it('refuses a reuse with no client picked', () => {
    expect(answerErrors(withAccess({ kind: 'reuse', uuid: '' })).access).toBe(
      'form.quickRoute.keycloak.clientRequired'
    );
  });
});

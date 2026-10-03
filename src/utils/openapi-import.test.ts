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
  defaultBackend,
  hasDestination,
  matchForPath,
  parseImportData,
  upstreamFromServer,
  withBackend,
} from '@/utils/openapi-import';

const spec = (body: Record<string, unknown>) =>
  JSON.stringify({ openapi: '3.0.0', info: { title: 't', version: '1' }, ...body });

describe('upstreamFromServer', () => {
  it('builds an upstream that sends the server its own host name', () => {
    expect(upstreamFromServer('https://api.example.com')).toEqual({
      upstream: {
        type: 'roundrobin',
        scheme: 'https',
        pass_host: 'node',
        nodes: { 'api.example.com:443': 1 },
      },
      basePath: '',
    });
    expect(upstreamFromServer('http://10.0.0.5:8080/')?.upstream.nodes).toEqual({
      '10.0.0.5:8080': 1,
    });
  });

  it('keeps the base path, without a trailing slash', () => {
    expect(upstreamFromServer('http://api.example.com/v1/')?.basePath).toBe('/v1');
  });

  it('keeps an IPv6 host bracketed, as a node key wants it', () => {
    expect(upstreamFromServer('http://[fd00::1]:8080')?.upstream.nodes).toEqual({
      '[fd00::1]:8080': 1,
    });
  });

  it('gives up on what it cannot reach', () => {
    // Relative to wherever the spec was served from, which the gateway cannot know.
    expect(upstreamFromServer('/v1')).toBeNull();
    // Server variables, never substituted.
    expect(upstreamFromServer('https://{env}.example.com')).toBeNull();
    expect(upstreamFromServer('ftp://files.example.com')).toBeNull();
    expect(upstreamFromServer('')).toBeNull();
  });
});

describe('parseImportData servers', () => {
  it('takes the operation server, else the path one, else the spec one', () => {
    const result = parseImportData(
      spec({
        servers: [{ url: 'http://root.example.com' }, { url: 'http://other.example.com' }],
        paths: {
          '/op': { get: { servers: [{ url: 'http://op.example.com' }] } },
          '/path': { servers: [{ url: 'http://path.example.com' }], get: {} },
          '/root': { get: {} },
        },
      })
    );
    expect(result.routes.map((r) => r.uri)).toEqual(['/op', '/path', '/root']);
    expect(result.servers).toEqual([
      'http://op.example.com',
      'http://path.example.com',
      'http://root.example.com',
    ]);
  });

  it('no longer turns a server into a host to match', () => {
    const result = parseImportData(
      spec({ paths: { '/a': { get: { servers: [{ url: 'http://api.example.com' }] } } } })
    );
    expect(result.routes[0].hosts).toBeUndefined();
  });

  it('still sets hosts from x-apisix-hosts', () => {
    const result = parseImportData(
      spec({ paths: { '/a': { get: { 'x-apisix-hosts': ['gw.example.com'] } } } })
    );
    expect(result.routes[0].hosts).toEqual(['gw.example.com']);
  });

  it('reads a Swagger 2.0 host, base path and scheme', () => {
    const swagger = (body: Record<string, unknown>) =>
      parseImportData(JSON.stringify({ swagger: '2.0', paths: { '/a': { get: {} } }, ...body }));
    expect(
      swagger({ host: 'api.example.com:8443', basePath: '/v2', schemes: ['https'] }).servers
    ).toEqual(['https://api.example.com:8443/v2']);
    expect(swagger({ host: 'api.example.com' }).servers).toEqual(['http://api.example.com']);
    // No host: relative to wherever the spec was served from.
    expect(swagger({ basePath: '/v2' }).servers).toEqual([undefined]);
  });

  it('has no server for APISIX route JSON', () => {
    const result = parseImportData(JSON.stringify([{ uri: '/a' }, { uri: '/b' }]));
    expect(result.servers).toEqual([undefined, undefined]);
  });
});

describe('withBackend', () => {
  const parsed = parseImportData(
    spec({
      servers: [{ url: 'https://api.example.com/v1' }],
      paths: {
        '/plain': { get: {} },
        '/own': { get: { 'x-apisix-upstream_id': 'theirs' } },
        '/rewritten': {
          get: { 'x-apisix-plugins': { 'proxy-rewrite': { uri: '/elsewhere' } } },
        },
      },
    })
  );
  const [plain, own, rewritten] = [0, 1, 2];

  it('builds each route an upstream from its server, and prefixes the base path', () => {
    const routes = withBackend(parsed, { kind: 'servers' });
    expect(routes[plain].upstream).toEqual(upstreamFromServer('https://api.example.com')?.upstream);
    expect(routes[plain].plugins).toEqual({
      'proxy-rewrite': { regex_uri: ['^(.*)$', '/v1$1'] },
    });
  });

  it('leaves a route that names its own destination alone', () => {
    for (const backend of [
      { kind: 'servers' } as const,
      { kind: 'upstream', upstreamId: 'chosen' } as const,
      { kind: 'service', serviceId: 'chosen' } as const,
    ]) {
      const route = withBackend(parsed, backend)[own];
      expect(route.upstream_id).toBe('theirs');
      expect(route.upstream).toBeUndefined();
      expect(route.service_id).toBeUndefined();
    }
  });

  it('leaves a route on a plugin config alone', () => {
    const [route] = withBackend(
      parseImportData(JSON.stringify([{ uri: '/a', plugin_config_id: 'p' }])),
      { kind: 'upstream', upstreamId: 'u' }
    );
    expect(route.upstream_id).toBeUndefined();
  });

  it('does not overwrite a proxy-rewrite the spec already set', () => {
    const route = withBackend(parsed, { kind: 'servers' })[rewritten];
    expect(route.upstream).toBeDefined();
    expect(route.plugins).toEqual({ 'proxy-rewrite': { uri: '/elsewhere' } });
  });

  it('points routes at a chosen upstream or service', () => {
    expect(withBackend(parsed, { kind: 'upstream', upstreamId: 'u1' })[plain]).toMatchObject({
      upstream_id: 'u1',
    });
    expect(withBackend(parsed, { kind: 'service', serviceId: 's1' })[plain]).toMatchObject({
      service_id: 's1',
    });
  });

  it('changes nothing as in the spec, and leaves what it parsed untouched', () => {
    const before = JSON.stringify(parsed);
    expect(withBackend(parsed, { kind: 'spec' })).toEqual(parsed.routes);
    withBackend(parsed, { kind: 'servers' });
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it('gives no destination where the server is unusable', () => {
    const unusable = parseImportData(
      spec({ servers: [{ url: 'https://{env}.example.com' }], paths: { '/a': { get: {} } } })
    );
    const [route] = withBackend(unusable, { kind: 'servers' });
    expect(hasDestination(route)).toBe(false);
  });
});

describe('hasDestination', () => {
  it('follows what APISIX requires beside the uri', () => {
    expect(hasDestination({ uri: '/a', methods: [] })).toBe(false);
    expect(hasDestination({ uri: '/a', methods: [], plugins: {} })).toBe(false);
    expect(hasDestination({ uri: '/a', methods: [], upstream_id: 'u' })).toBe(true);
    expect(hasDestination({ uri: '/a', methods: [], service_id: 's' })).toBe(true);
    expect(hasDestination({ uri: '/a', methods: [], upstream: { nodes: {} } })).toBe(true);
    expect(hasDestination({ uri: '/a', methods: [], plugins: { redirect: {} } })).toBe(true);
    expect(hasDestination({ uri: '/a', methods: [], plugin_config_id: 'p' })).toBe(true);
    expect(hasDestination({ uri: '/a', methods: [], script: 'return 1' })).toBe(true);
  });
});

describe('defaultBackend', () => {
  it('is the servers when one is usable for a route that needs it', () => {
    const parsed = parseImportData(
      spec({ servers: [{ url: 'http://api.example.com' }], paths: { '/a': { get: {} } } })
    );
    expect(defaultBackend(parsed)).toEqual({ kind: 'servers' });
  });

  it('is the spec otherwise', () => {
    expect(defaultBackend(parseImportData(spec({ paths: { '/a': { get: {} } } })))).toEqual({
      kind: 'spec',
    });
    const own = parseImportData(
      spec({
        servers: [{ url: 'http://api.example.com' }],
        paths: { '/a': { get: { 'x-apisix-upstream_id': 'u' } } },
      })
    );
    expect(defaultBackend(own)).toEqual({ kind: 'spec' });
  });
});

describe('matchForPath', () => {
  it('keeps a path without parameters as it is', () => {
    expect(matchForPath('/pets')).toEqual({ uri: '/pets' });
  });

  it('matches each parameter as one segment, under the prefix before the first', () => {
    expect(matchForPath('/pets/{petId}')).toEqual({
      uri: '/pets/*',
      vars: [['uri', '~~', '^/pets/[^/]+$']],
    });
    expect(matchForPath('/pets/{petId}/toys/{toyId}')).toEqual({
      uri: '/pets/*',
      vars: [['uri', '~~', '^/pets/[^/]+/toys/[^/]+$']],
    });
    expect(matchForPath('/{tenant}/pets').uri).toBe('/*');
  });

  it('escapes what is literal, inside a segment too', () => {
    expect(matchForPath('/files/{name}.json').vars).toEqual([
      ['uri', '~~', '^/files/[^/]+\\.json$'],
    ]);
    expect(matchForPath('/v1.0/(a)/{id}').vars).toEqual([
      ['uri', '~~', '^/v1\\.0/\\(a\\)/[^/]+$'],
    ]);
  });

  it('gives a pattern that matches the requests the path describes, and no others', () => {
    const [[, , pattern]] = matchForPath('/pets/{petId}/toys').vars as string[][];
    const re = new RegExp(pattern);
    expect(re.test('/pets/42/toys')).toBe(true);
    expect(re.test('/pets/42')).toBe(false);
    expect(re.test('/pets/42/extra/toys')).toBe(false);
    expect(re.test('/pets//toys')).toBe(false);
  });
});

describe('parseImportData path templates', () => {
  const templated = (op: Record<string, unknown>) =>
    parseImportData(spec({ paths: { '/pets/{petId}': { get: op } } })).routes[0];
  const generated = ['uri', '~~', '^/pets/[^/]+$'];

  it('writes the prefix and the match', () => {
    expect(templated({})).toMatchObject({ uri: '/pets/*', vars: [generated] });
  });

  it('adds the spec\'s own expressions to the match', () => {
    expect(templated({ 'x-apisix-vars': [['arg_v', '==', '2']] }).vars).toEqual([
      generated,
      ['arg_v', '==', '2'],
    ]);
  });

  it('keeps a logical expression of the spec\'s whole beside the match', () => {
    const or = ['OR', ['arg_v', '==', '1'], ['arg_v', '==', '2']];
    expect(templated({ 'x-apisix-vars': or }).vars).toEqual(['AND', generated, or]);
  });

  it('leaves the vars of a path without parameters to the spec', () => {
    const route = parseImportData(
      spec({ paths: { '/pets': { get: { 'x-apisix-vars': [['arg_v', '==', '2']] } } } })
    ).routes[0];
    expect(route).toMatchObject({ uri: '/pets', vars: [['arg_v', '==', '2']] });
  });
});

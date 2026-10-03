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
import i18n from '@/config/i18n';


type OpenAPIOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  'x-apisix-plugins'?: Record<string, unknown>;
  'x-apisix-upstream'?: Record<string, unknown>;
  'x-apisix-vars'?: unknown;
  'x-apisix-status'?: number;
  'x-apisix-hosts'?: string[];
  'x-apisix-service_id'?: string;
  'x-apisix-upstream_id'?: string;
  'x-apisix-priority'?: number;
  'x-apisix-labels'?: Record<string, string>;
  servers?: OpenAPIServer[];
};

type OpenAPIServer = { url: string };

// Its operations under method keys, beside other keys such as servers.
type OpenAPIPathItem = Record<string, unknown>;

type OpenAPISpec = {
  openapi?: string;
  swagger?: string;
  servers?: OpenAPIServer[];
  // Swagger 2.0 says where the API lives with these instead of servers.
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, OpenAPIPathItem>;
};

type APISIXRoute = {
  name?: string;
  desc?: string;
  uri: string;
  methods: string[];
  hosts?: string[];
  labels?: Record<string, string>;
  plugins?: Record<string, unknown>;
  upstream?: Record<string, unknown>;
  upstream_id?: string;
  service_id?: string;
  plugin_config_id?: string;
  script?: string;
  vars?: unknown;
  status?: number;
  priority?: number;
};

const KNOWN_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

const firstServer = (servers?: OpenAPIServer[]): string | undefined =>
  Array.isArray(servers) && typeof servers[0]?.url === 'string' ? servers[0].url : undefined;

/**
 * The upstream a server URL describes, and the path its API lives under.
 *
 * The server's own host name goes with each request (`pass_host: node`): it is
 * the one the server answers to, not the gateway's. Null for what the gateway
 * cannot reach: a URL relative to wherever the spec was served from, one with
 * server variables left in it, or one that is not HTTP.
 */
export const upstreamFromServer = (
  serverUrl: string
): { upstream: Record<string, unknown>; basePath: string } | null => {
  if (!serverUrl || serverUrl.includes('{')) return null;
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(':', '');
  if (scheme !== 'http' && scheme !== 'https') return null;
  // Already bracketed for an IPv6 host, which is the shape the node key wants.
  const port = url.port || (scheme === 'https' ? '443' : '80');
  return {
    upstream: {
      type: 'roundrobin',
      scheme,
      pass_host: 'node',
      nodes: { [`${url.hostname}:${port}`]: 1 },
    },
    basePath: url.pathname.replace(/\/+$/, ''),
  };
};

// A Swagger 2.0 spec's one server; none when it names no host, which makes it
// relative to wherever the spec was served from.
const swaggerServer = (spec: OpenAPISpec): string | undefined =>
  spec.swagger && typeof spec.host === 'string' && spec.host
    ? `${spec.schemes?.[0] ?? 'http'}://${spec.host}${spec.basePath ?? ''}`
    : undefined;

const openAPIToRoutes = (spec: OpenAPISpec): { routes: APISIXRoute[]; servers: (string | undefined)[] } => {
  const routes: APISIXRoute[] = [];
  const servers: (string | undefined)[] = [];

  if (!spec.paths) return { routes, servers };

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods: string[] = [];
    let mergedOp: OpenAPIOperation = {};

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!KNOWN_METHODS.has(method.toLowerCase())) continue;
      methods.push(method.toUpperCase());
      // Use the last operation's metadata for route-level fields
      mergedOp = operation as OpenAPIOperation;
    }

    if (methods.length === 0) continue;

    const route: APISIXRoute = {
      uri: path,
      methods,
      status: 1,
    };

    if (mergedOp.summary) {
      route.name = mergedOp.summary;
    }

    if (mergedOp.description) {
      route.desc = mergedOp.description;
    }

    if (mergedOp['x-apisix-labels']) {
      route.labels = mergedOp['x-apisix-labels'];
    } else if (mergedOp.tags && mergedOp.tags.length > 0) {
      route.labels = {};
      for (const tag of mergedOp.tags) {
        route.labels[tag] = 'true';
      }
    }

    // APISIX extensions
    if (mergedOp['x-apisix-plugins']) {
      route.plugins = mergedOp['x-apisix-plugins'];
    }
    if (mergedOp['x-apisix-upstream']) {
      route.upstream = mergedOp['x-apisix-upstream'];
    }
    if (mergedOp['x-apisix-upstream_id']) {
      route.upstream_id = mergedOp['x-apisix-upstream_id'];
    }
    if (mergedOp['x-apisix-service_id']) {
      route.service_id = mergedOp['x-apisix-service_id'];
    }
    if (mergedOp['x-apisix-vars']) {
      route.vars = mergedOp['x-apisix-vars'];
    }
    if (typeof mergedOp['x-apisix-status'] === 'number') {
      route.status = mergedOp['x-apisix-status'];
    }
    if (typeof mergedOp['x-apisix-priority'] === 'number') {
      route.priority = mergedOp['x-apisix-priority'];
    }
    if (mergedOp['x-apisix-hosts'] && Array.isArray(mergedOp['x-apisix-hosts'])) {
      route.hosts = mergedOp['x-apisix-hosts'];
    }

    routes.push(route);
    // Where its backend lives: a server names the backend, not a host to match
    // on, so it is kept beside the route rather than written into it.
    servers.push(
      firstServer(mergedOp.servers) ?? firstServer(pathItem.servers as OpenAPIServer[] | undefined) ??
        firstServer(spec.servers) ??
        swaggerServer(spec)
    );
  }

  return { routes, servers };
};

export type ParseResult = {
  routes: APISIXRoute[];
  // The server URL each route was declared under, at the same index.
  servers: (string | undefined)[];
  format: 'openapi' | 'apisix-json' | 'apisix-array';
};

/** Where imported routes that name no destination of their own are sent. */
export type ImportBackend =
  | { kind: 'spec' }
  | { kind: 'servers' }
  | { kind: 'upstream'; upstreamId: string }
  | { kind: 'service'; serviceId: string };

// What APISIX takes, beside the uri, as where the route goes or what answers it.
const namesItsDestination = (route: APISIXRoute) =>
  Boolean(
    route.upstream ||
      route.upstream_id ||
      route.service_id ||
      route.plugin_config_id ||
      route.script
  );

/**
 * Whether APISIX will take the route: beside its uri it wants an upstream, an
 * upstream_id, a service_id, a plugin_config_id, a script or plugins.
 */
export const hasDestination = (route: APISIXRoute) =>
  namesItsDestination(route) || Object.keys(route.plugins ?? {}).length > 0;

/**
 * The routes to write, each without a destination of its own sent to the
 * chosen backend. What was parsed is left as it was, so the choice can change.
 */
export const withBackend = (result: ParseResult, backend: ImportBackend): APISIXRoute[] =>
  result.routes.map((route, i) => {
    if (backend.kind === 'spec' || namesItsDestination(route)) return route;
    if (backend.kind === 'upstream') return { ...route, upstream_id: backend.upstreamId };
    if (backend.kind === 'service') return { ...route, service_id: backend.serviceId };
    const server = result.servers[i];
    const built = server ? upstreamFromServer(server) : null;
    if (!built) return route;
    const next: APISIXRoute = { ...route, upstream: built.upstream };
    // The spec's paths are relative to the server's: /pets under
    // https://api.example.com/v1 is /v1/pets to the backend. A rewrite the spec
    // set itself wins.
    if (built.basePath && !route.plugins?.['proxy-rewrite']) {
      next.plugins = {
        ...route.plugins,
        'proxy-rewrite': { regex_uri: ['^(.*)$', `${built.basePath}$1`] },
      };
    }
    return next;
  });

/** The servers, when one of them can serve a route that needs a backend. */
export const defaultBackend = (result: ParseResult): ImportBackend =>
  result.routes.some(
    (route, i) => !namesItsDestination(route) && result.servers[i] && upstreamFromServer(result.servers[i]!)
  )
    ? { kind: 'servers' }
    : { kind: 'spec' };

export const parseImportData = (content: string): ParseResult => {
  const parsed = JSON.parse(content);

  // OpenAPI spec
  if (parsed.openapi || parsed.swagger) {
    return { ...openAPIToRoutes(parsed), format: 'openapi' };
  }

  // Array of APISIX routes
  if (Array.isArray(parsed)) {
    const routes = parsed.filter((r) => r.uri || r.uris);
    return { routes, servers: routes.map(() => undefined), format: 'apisix-array' };
  }

  // Single APISIX route
  if (parsed.uri || parsed.uris) {
    return { routes: [parsed], servers: [undefined], format: 'apisix-json' };
  }

  throw new Error(i18n.t('form.import.unrecognized'));
};

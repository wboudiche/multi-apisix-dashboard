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
  servers?: { url: string }[];
};

type OpenAPISpec = {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, OpenAPIOperation>>;
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
  vars?: unknown;
  status?: number;
  priority?: number;
};

const KNOWN_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

const extractHostFromServer = (serverUrl: string): string | null => {
  try {
    const url = new URL(serverUrl);
    return url.host;
  } catch {
    return null;
  }
};

export const openAPIToRoutes = (spec: OpenAPISpec): APISIXRoute[] => {
  const routes: APISIXRoute[] = [];

  if (!spec.paths) return routes;

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods: string[] = [];
    let mergedOp: OpenAPIOperation = {};

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!KNOWN_METHODS.has(method.toLowerCase())) continue;
      methods.push(method.toUpperCase());
      // Use the last operation's metadata for route-level fields
      mergedOp = operation;
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

    if (mergedOp.tags && mergedOp.tags.length > 0) {
      route.labels = {};
      for (const tag of mergedOp.tags) {
        route.labels[tag] = 'true';
      }
    }

    // Extract hosts from servers
    const hosts: string[] = [];
    const servers = mergedOp.servers;
    if (servers && Array.isArray(servers)) {
      for (const server of servers) {
        const host = extractHostFromServer(server.url);
        if (host) hosts.push(host);
      }
    }
    if (hosts.length > 0) {
      route.hosts = hosts;
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
  }

  return routes;
};

export type ParseResult = {
  routes: APISIXRoute[];
  format: 'openapi' | 'apisix-json' | 'apisix-array';
};

export const parseImportData = (content: string): ParseResult => {
  const parsed = JSON.parse(content);

  // OpenAPI spec
  if (parsed.openapi || parsed.swagger) {
    return {
      routes: openAPIToRoutes(parsed),
      format: 'openapi',
    };
  }

  // Array of APISIX routes
  if (Array.isArray(parsed)) {
    return {
      routes: parsed.filter((r) => r.uri || r.uris),
      format: 'apisix-array',
    };
  }

  // Single APISIX route
  if (parsed.uri || parsed.uris) {
    return {
      routes: [parsed],
      format: 'apisix-json',
    };
  }

  throw new Error('Unrecognized format. Expected OpenAPI spec, APISIX route JSON, or array of routes.');
};

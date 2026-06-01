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

const ALL_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

const sanitizeOperationId = (name: string, method: string): string => {
  const sanitized = name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${sanitized}_${method}`;
};

const extractServers = (route: Record<string, unknown>): { url: string }[] => {
  const servers: { url: string }[] = [];
  const seen = new Set<string>();

  const addServer = (host: string) => {
    const url = `https://${host}`;
    if (!seen.has(url)) {
      seen.add(url);
      servers.push({ url });
    }
  };

  if (typeof route.host === 'string') {
    addServer(route.host);
  }

  if (Array.isArray(route.hosts)) {
    for (const h of route.hosts) {
      if (typeof h === 'string') {
        addServer(h);
      }
    }
  }

  return servers;
};

export const routesToOpenAPI = (routes: Record<string, unknown>[], title?: string): object => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const uris: string[] = [];
    if (typeof route.uri === 'string') {
      uris.push(route.uri);
    } else if (Array.isArray(route.uris)) {
      for (const u of route.uris) {
        if (typeof u === 'string') {
          uris.push(u);
        }
      }
    }

    const methods: string[] = Array.isArray(route.methods)
      ? (route.methods as string[]).map((m) => m.toLowerCase())
      : [...ALL_METHODS];

    const routeName = typeof route.name === 'string' ? route.name : '';
    const routeDesc = typeof route.desc === 'string' ? route.desc : '';

    const labels =
      route.labels && typeof route.labels === 'object'
        ? (route.labels as Record<string, string>)
        : null;

    const servers = extractServers(route);

    for (const uri of uris) {
      if (!paths[uri]) {
        paths[uri] = {};
      }

      for (const method of methods) {
        const operation: Record<string, unknown> = {
          summary: routeName,
          description: routeDesc,
          operationId: sanitizeOperationId(routeName || uri, method),
          responses: {
            '200': { description: 'Successful response' },
          },
        };

        if (labels) {
          operation.tags = Object.keys(labels);
          operation['x-apisix-labels'] = labels;
        }

        if (servers.length > 0) {
          operation.servers = servers;
        }

        if (route.upstream && typeof route.upstream === 'object') {
          operation['x-apisix-upstream'] = route.upstream;
        }

        if (typeof route.upstream_id === 'string') {
          operation['x-apisix-upstream_id'] = route.upstream_id;
        }

        if (typeof route.service_id === 'string') {
          operation['x-apisix-service_id'] = route.service_id;
        }

        if (route.plugins && typeof route.plugins === 'object' && route.plugins !== null) {
          operation['x-apisix-plugins'] = route.plugins;
        }

        if (route.vars) {
          operation['x-apisix-vars'] = route.vars;
        }

        paths[uri][method] = operation;
      }
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: title || 'APISIX Routes Export',
      version: '1.0.0',
      description: 'Exported from Apache APISIX Dashboard',
    },
    paths,
  };
};

export const downloadOpenAPI = (spec: object, filename?: string): void => {
  const json = JSON.stringify(spec, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'openapi-export.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

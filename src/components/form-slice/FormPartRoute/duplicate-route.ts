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
import { APISIX, type APISIXType } from '@/types/schema/apisix';
import { withoutDashboardFields } from '@/utils/dashboard-fields';

import {
  addSchemaIssues,
  answerErrors,
  basePathRewrite,
  type QuickRoute,
  type QuickRouteErrors,
  upstreamFromAddress,
  withoutEmpty,
} from './quick-create';

type RouteBody = Omit<APISIXType['Route'], 'id' | 'create_time' | 'update_time'>;

const pathOf = (route: APISIXType['Route']) => route.uri ?? route.uris?.[0] ?? '';

type Rewrite = Record<string, unknown> | undefined;
const rewriteOf = (route: APISIXType['Route']): Rewrite =>
  (route.plugins as Record<string, Record<string, unknown>> | undefined)?.['proxy-rewrite'];

/**
 * A rewrite that only puts a path in front of every request - what an
 * address with a path makes (basePathRewrite) - belongs to that address: a
 * backend elsewhere has its API under a path of its own, or none.
 */
const isBasePathRewrite = (rewrite: Rewrite) => {
  const regex = rewrite?.regex_uri;
  return (
    Array.isArray(regex) &&
    regex.length === 2 &&
    regex[0] === '^(.*)$' &&
    typeof regex[1] === 'string' &&
    /^\/.*\$1$/.test(regex[1]) &&
    rewrite?.uri === undefined
  );
};

/** A rewrite of its own: one of the path that is not just a base path. */
const ownPathRewrite = (rewrite: Rewrite) =>
  (rewrite?.uri !== undefined || rewrite?.regex_uri !== undefined) && !isBasePathRewrite(rewrite);

/**
 * The duplicate page's starting answers: the route's path, methods and
 * host, the name it is given (the caller's, translated), offline, and to the
 * same destination - the copy is the route until told otherwise.
 */
export const quickRouteFromRoute = (route: APISIXType['Route'], name: string): QuickRoute => ({
  path: pathOf(route),
  methods: [...(route.methods ?? [])],
  host: route.host ?? '',
  name,
  status: 0,
  destination: { kind: 'same' },
});

/**
 * The copy, as it is posted: the route whole - its plugins, vars, priority,
 * labels, hosts - with the answers of the quick page over it, and a new
 * destination in place of its own when one is chosen.
 */
export const duplicateRouteBody = (route: APISIXType['Route'], q: QuickRoute): RouteBody => {
  const body = withoutDashboardFields(route as unknown as Record<string, unknown>) as RouteBody &
    Partial<Pick<APISIXType['Route'], 'id' | 'create_time' | 'update_time'>>;
  delete body.id;
  delete body.create_time;
  delete body.update_time;

  body.name = q.name.trim();
  body.status = q.status;
  // A path changed is the copy's one path; one kept keeps uri or uris as
  // the route had them.
  const path = q.path.trim();
  if (path !== pathOf(route)) {
    body.uri = path;
    delete body.uris;
  }
  if (q.methods.length > 0) body.methods = q.methods as RouteBody['methods'];
  else delete body.methods;
  // host and hosts cannot both be set: a host typed is the copy's in place
  // of the route's hosts, which stay as they are otherwise.
  const host = q.host.trim();
  if (host) {
    body.host = host;
    delete body.hosts;
  } else {
    delete body.host;
  }

  const d = q.destination;
  if (d.kind === 'same') return body;

  // The old destination's base path goes with it; what else the rewrite
  // does - its headers, its host - stays.
  const plugins = { ...(body.plugins ?? {}) } as Record<string, Record<string, unknown>>;
  if (isBasePathRewrite(plugins['proxy-rewrite'])) {
    const rest = { ...plugins['proxy-rewrite'] };
    delete rest.regex_uri;
    if (Object.keys(rest).length > 0) plugins['proxy-rewrite'] = rest;
    else delete plugins['proxy-rewrite'];
  }
  body.plugins = plugins;

  delete body.upstream;
  delete body.upstream_id;
  // A service brings plugins - an auth, a limit - as well as an upstream. A
  // copy sent to an upstream keeps its service, as APISIX takes the route's
  // upstream over the service's; only another service replaces it.
  if (d.kind === 'service') return { ...body, service_id: d.serviceId };
  if (d.kind === 'upstream') return { ...body, upstream_id: d.upstreamId };

  const built = upstreamFromAddress(d.url);
  if (!built) return body;
  body.upstream = built.upstream as RouteBody['upstream'];
  if (built.basePath) {
    plugins['proxy-rewrite'] = { ...plugins['proxy-rewrite'], ...basePathRewrite(built.basePath) };
  }
  return body;
};

/**
 * The path rewrite of the route's own a copy sent elsewhere keeps as it is,
 * for the quick page to point out: it was written for the original's backend.
 * Undefined when there is none, or the destination is kept.
 */
export const keptPathRewrite = (route: APISIXType['Route'], q: QuickRoute): string | undefined => {
  if (q.destination.kind === 'same') return undefined;
  const rewrite = rewriteOf(route);
  if (!ownPathRewrite(rewrite)) return undefined;
  return rewrite?.uri !== undefined ? String(rewrite.uri) : JSON.stringify(rewrite?.regex_uri);
};

// The fields the quick page answers for: what the schema refuses elsewhere in
// the route is the route as the gateway already holds it, and left to it.
const QUICK_FIELDS = new Set(['name', 'uri', 'uris', 'methods', 'host', 'hosts', 'status', 'upstream', 'upstream_id', 'service_id']);

// What the gateway may hold beside a copy's own id and times: the route's
// schema, held to what is posted.
const RouteBodySchema = APISIX.Route.omit({ id: true, create_time: true, update_time: true });

/**
 * Why the copy cannot be posted; empty when it can. The quick page's own checks,
 * the route's schema on the body itself, and the one clash a copy can bring:
 * an address with a path, for a route that already rewrites its path - the
 * two rewrites cannot both hold.
 */
export const duplicateRouteErrors = (route: APISIXType['Route'], q: QuickRoute): QuickRouteErrors => {
  const errors = answerErrors(q);
  if (!q.name.trim()) errors.name = 'form.validation.nameRequired';

  // A base path of the old address gives way to the new one's; a rewrite of
  // the route's own and the address's cannot both hold.
  const d = q.destination;
  if (d.kind === 'url' && !errors.destination) {
    if (upstreamFromAddress(d.url)?.basePath && ownPathRewrite(rewriteOf(route))) {
      errors.destination = 'form.validation.destinationPathRewritten';
    }
  }

  const parsed = RouteBodySchema.safeParse(duplicateRouteBody(route, q));
  if (!parsed.success) {
    addSchemaIssues(
      errors,
      parsed.error.issues.filter((issue) => QUICK_FIELDS.has(String(issue.path[0])))
    );
  }
  return withoutEmpty(errors);
};

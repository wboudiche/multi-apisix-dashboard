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
import { parseToNodes } from '@/components/form-slice/FormPartUpstream/node-rows';
import type { APISIXType } from '@/types/schema/apisix';
import { type Restriction, RESTRICTION_PLUGIN, writeRestriction } from '@/utils/auth-clients';
import { upstreamFromServer } from '@/utils/openapi-import';

import { RoutePostSchema, type RoutePostType } from './schema';
import { UPSTREAM_CUSTOM } from './util';

/** Where a route made in the quick-create dialog sends its requests. */
export type QuickDestination =
  | { kind: 'url'; url: string }
  | { kind: 'upstream'; upstreamId: string }
  | { kind: 'service'; serviceId: string }
  /** A copy's destination left as the original's (the duplicate dialog). */
  | { kind: 'same' };

/**
 * The authentication the dialog offers: a key for an application, a username
 * and a password for a person or an internal tool. The others take settings
 * of their own, and are added in the advanced form.
 */
export const QUICK_AUTH_PLUGINS = ['key-auth', 'basic-auth'] as const;
export type QuickAuthPlugin = (typeof QUICK_AUTH_PLUGINS)[number];

/**
 * Who may call the route: anyone, or the clients of one authentication. Its
 * settings are its defaults, or the ones the route's service gives it: the
 * route's own replaces the service's, so a header the service named would be
 * lost to an empty one.
 */
export type QuickAccess =
  | { plugin: null }
  | { plugin: QuickAuthPlugin; restriction: Restriction; config?: Record<string, unknown> };

/** The dialog's answers: what a route needs, and nothing it can do without. */
export type QuickRoute = {
  path: string;
  methods: string[];
  host: string;
  name: string;
  status: 0 | 1;
  destination: QuickDestination;
  /** None: anyone, as a route is without an authentication plugin. */
  access?: QuickAccess;
  /** None: as many calls as come. */
  rateLimit?: QuickRateLimit;
};

/** The windows a quick route's calls are counted over, in seconds. */
export const RATE_WINDOWS = { second: 1, minute: 60, hour: 3600, day: 86400 } as const;
export type RateWindow = keyof typeof RATE_WINDOWS;

/**
 * At most `count` calls each `per`, counted for each caller: each client when
 * `byClient` - a service that asks who calls makes the route know its clients
 * too - or when the route itself asks; each IP address otherwise.
 */
export type QuickRateLimit = { count: number; per: RateWindow; byClient?: boolean };

/**
 * The limit-count a limit comes to. Counted for each client when the route
 * asks who calls - the gateway knows the consumer by the time limit-count
 * runs, below the authentication plugins - and for each IP address when it
 * does not. Counted on each gateway node, with no Redis to share the count.
 */
export const rateLimitPlugins = (
  limit: QuickRateLimit | undefined,
  byClient: boolean
): Record<string, Record<string, unknown>> => {
  if (!limit) return {};
  return {
    'limit-count': {
      count: limit.count,
      time_window: RATE_WINDOWS[limit.per],
      key_type: 'var',
      key: byClient ? 'consumer_name' : 'remote_addr',
      rejected_code: 429,
      policy: 'local',
    },
  };
};

/**
 * The plugins an access comes to: the authentication with its defaults, and
 * the consumer-restriction when only the clients picked may call - the same
 * two the advanced form writes from the same choice.
 */
export const accessPlugins = (
  access: QuickAccess | undefined
): Record<string, Record<string, unknown>> => {
  if (!access?.plugin) return {};
  const { plugin, restriction, config } = access;
  const allowList = restriction.mode === 'only' ? writeRestriction(undefined, restriction.names) : null;
  return {
    [plugin]: { ...config },
    ...(allowList && { [RESTRICTION_PLUGIN]: allowList }),
  };
};

/** The timeouts the wizard starts a new upstream with. */
export const WIZARD_TIMEOUT = { connect: 6, send: 6, read: 6 };

/** Where the add page keeps a route being written, and restores it from. */
export const ROUTE_DRAFT_KEY = 'apisix-route-draft';

/**
 * What the add page's form starts from. A draft replaces these rather than
 * being merged into them, so a draft handed to the page carries them too.
 */
export const ROUTE_ADD_DEFAULTS: RoutePostType = {
  name: '',
  uri: '/*',
  status: 1,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  upstream_id: UPSTREAM_CUSTOM,
  upstream: {
    type: 'roundrobin',
    scheme: 'http',
    nodes: [],
    timeout: WIZARD_TIMEOUT,
  },
  plugins: {},
};

/**
 * A name for a route not named yet: its method and path when it has one
 * method, its path when it has several or all of them - a list of four
 * methods in front of every name is noise. Empty until there is a path.
 */
export const proposeRouteName = (methods: string[], path: string): string => {
  const p = path.trim();
  if (!p) return '';
  return methods.length === 1 ? `${methods[0]} ${p}` : p;
};

/**
 * Why an address cannot be a route's destination, as a key under
 * form.validation; undefined when it can. The same reading as the OpenAPI
 * import's servers, so an address one accepts the other does too.
 */
export const destinationUrlError = (url: string): string | undefined => {
  const value = url.trim();
  if (!value) return 'form.validation.destinationRequired';
  if (!upstreamFromServer(value)) return 'form.validation.destinationUrl';
  // Only where the backend is becomes the route: credentials, a query or a
  // fragment would be dropped without a word, and a $ in the path would be
  // read by proxy-rewrite as a reference to what it matched.
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.includes('$')) {
    return 'form.validation.destinationUrlPlain';
  }
  return undefined;
};

/**
 * The dialog's answers as the wizard's form holds them: what is posted from
 * the dialog, and what the wizard starts from when the dialog hands over to
 * it. One shape for both, so a route made in the dialog is the route the
 * wizard would have made from the same answers.
 */
export const quickRouteToForm = (q: QuickRoute): RoutePostType => {
  const host = q.host.trim();
  const form: RoutePostType = {
    name: q.name.trim() || proposeRouteName(q.methods, q.path),
    uri: q.path.trim(),
    status: q.status,
    plugins: {
      ...accessPlugins(q.access),
      ...rateLimitPlugins(q.rateLimit, !!q.rateLimit?.byClient || !!q.access?.plugin),
    },
    ...(q.methods.length > 0 && { methods: q.methods as RoutePostType['methods'] }),
    ...(host && { host }),
  };

  // Nothing picked yet is no destination, rather than an empty id the
  // wizard would read as one and the gateway would refuse.
  const d = q.destination;
  if (d.kind === 'upstream') return d.upstreamId ? { ...form, upstream_id: d.upstreamId } : form;
  if (d.kind === 'service') return d.serviceId ? { ...form, service_id: d.serviceId } : form;
  if (d.kind === 'same') return form;

  const built = upstreamFromAddress(d.url);
  if (!built) return form;
  return {
    ...form,
    upstream_id: UPSTREAM_CUSTOM,
    upstream: built.upstream as RoutePostType['upstream'],
    ...(built.basePath && {
      plugins: { ...form.plugins, 'proxy-rewrite': basePathRewrite(built.basePath) },
    }),
  };
};

/**
 * The upstream an address makes - the importer's reading of a server, with
 * the wizard's timeouts and nodes in the list shape its node rows edit - and
 * the path the backend's API lives under. Null for what cannot be one.
 */
export const upstreamFromAddress = (url: string) => {
  const built = upstreamFromServer(url.trim());
  if (!built) return null;
  const { nodes, ...upstream } = built.upstream;
  return {
    upstream: {
      ...upstream,
      nodes: parseToNodes(nodes as APISIXType['UpstreamNodeListOrObj']),
      timeout: WIZARD_TIMEOUT,
    },
    basePath: built.basePath,
  };
};

/**
 * The proxy-rewrite for a backend whose API lives under a path: /orders
 * under http://backend/v1 is /v1/orders to it, as the importer reads it.
 */
export const basePathRewrite = (basePath: string) => ({
  regex_uri: ['^(.*)$', `${basePath}$1`],
});

/**
 * The dialog's answers as a draft for the add page, for "Continue in the
 * advanced form".
 *
 * On top of the page's own defaults, since a draft stands in for them: what
 * is not answered yet - no path, no usable address, nothing picked - stays
 * as the page would have started. No methods chosen means every method, and
 * stays so rather than turning into the page's default four.
 */
export const quickRouteToDraft = (q: QuickRoute): RoutePostType => {
  const answered = quickRouteToForm(q);
  const draft: RoutePostType = {
    ...ROUTE_ADD_DEFAULTS,
    ...answered,
    uri: answered.uri || ROUTE_ADD_DEFAULTS.uri,
    methods: answered.methods,
  };
  // A destination picked by id: the page's empty inline upstream is not one
  // to keep beside it.
  if (answered.upstream_id && answered.upstream_id !== UPSTREAM_CUSTOM) delete draft.upstream;
  if (answered.service_id) {
    delete draft.upstream;
    delete draft.upstream_id;
  }
  return draft;
};

/**
 * What the dialog says is wrong, by field: keys under form.validation, but
 * for `access`, which the clients section shows in its own words.
 */
export type QuickRouteErrors = {
  path?: string;
  name?: string;
  destination?: string;
  /**
   * Only the clients picked, and none picked: a route nobody may call. The
   * clients section says so under its own field.
   */
  access?: string;
  rateLimit?: string;
  /** What the wizard's schema refuses that no field of the dialog shows. */
  other?: string[];
};

const DESTINATION_MISSING = {
  upstream: 'form.validation.upstreamRequired',
  service: 'form.validation.serviceRequired',
} as const;

/**
 * Why the dialog's answers cannot be posted; empty when they can.
 *
 * What is posted is held to the wizard's own schema, so a rule the wizard
 * enforces is one the dialog enforces too. On top of it, what the dialog can
 * say better about its own fields: a path the gateway would never match, and
 * which destination is missing rather than that one is.
 */
export const quickRouteErrors = (q: QuickRoute): QuickRouteErrors => {
  const errors = answerErrors(q);
  const parsed = RoutePostSchema.safeParse(quickRouteToForm(q));
  if (!parsed.success) addSchemaIssues(errors, parsed.error.issues);
  return withoutEmpty(errors);
};

/**
 * What the dialog can say about its own fields better than a schema: a path
 * the gateway would never match, and which destination is missing rather
 * than that one is.
 */
export const answerErrors = (q: QuickRoute): QuickRouteErrors => {
  const errors: QuickRouteErrors = {};
  const path = q.path.trim();
  if (!path) errors.path = 'form.validation.uriRequired';
  else if (!path.startsWith('/')) errors.path = 'form.validation.pathSlash';

  const d = q.destination;
  if (d.kind === 'url') errors.destination = destinationUrlError(d.url);
  else if (d.kind === 'upstream' && !d.upstreamId) errors.destination = DESTINATION_MISSING.upstream;
  else if (d.kind === 'service' && !d.serviceId) errors.destination = DESTINATION_MISSING.service;

  const a = q.access;
  if (a?.plugin && a.restriction.mode === 'only' && a.restriction.names.length === 0) {
    errors.access = 'form.plugins.clients.accessEmpty';
  }

  const limit = q.rateLimit;
  if (limit && !(Number.isInteger(limit.count) && limit.count >= 1)) {
    errors.rateLimit = 'form.validation.rateLimitCount';
  }
  return errors;
};

/** A schema's refusals, each by the field of the dialog that shows it. */
export const addSchemaIssues = (
  errors: QuickRouteErrors,
  issues: { path: (string | number)[]; message: string }[]
) => {
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'uri') errors.path ??= issue.message;
    else if (field === 'name') errors.name ??= issue.message;
    // The destination is told apart by kind, in answerErrors.
    else if (field === 'upstream_id' || field === 'upstream' || field === 'service_id') errors.destination ??= issue.message;
    else (errors.other ??= []).push(issue.message);
  }
};

export const withoutEmpty = (errors: QuickRouteErrors): QuickRouteErrors =>
  Object.fromEntries(Object.entries(errors).filter(([, v]) => v !== undefined)) as QuickRouteErrors;

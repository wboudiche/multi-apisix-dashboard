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
import { upstreamFromServer } from '@/utils/openapi-import';

import type { RoutePostType } from './schema';
import { UPSTREAM_CUSTOM } from './util';

/** Where a route made in the quick-create dialog sends its requests. */
export type QuickDestination =
  | { kind: 'url'; url: string }
  | { kind: 'upstream'; upstreamId: string }
  | { kind: 'service'; serviceId: string };

/** The dialog's answers: what a route needs, and nothing it can do without. */
export type QuickRoute = {
  path: string;
  methods: string[];
  host: string;
  name: string;
  status: 0 | 1;
  destination: QuickDestination;
};

/** The timeouts the wizard starts a new upstream with. */
const WIZARD_TIMEOUT = { connect: 6, send: 6, read: 6 };

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
  if (!url.trim()) return 'form.validation.destinationRequired';
  return upstreamFromServer(url.trim()) ? undefined : 'form.validation.destinationUrl';
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
    plugins: {},
    ...(q.methods.length > 0 && { methods: q.methods as RoutePostType['methods'] }),
    ...(host && { host }),
  };

  const d = q.destination;
  if (d.kind === 'upstream') return { ...form, upstream_id: d.upstreamId };
  if (d.kind === 'service') return { ...form, service_id: d.serviceId };

  const built = upstreamFromServer(d.url.trim());
  if (!built) return form;
  const { nodes, ...upstream } = built.upstream;
  return {
    ...form,
    upstream_id: UPSTREAM_CUSTOM,
    upstream: {
      ...upstream,
      // The list shape: the one the wizard's node rows edit.
      nodes: parseToNodes(nodes as APISIXType['UpstreamNodeListOrObj']),
      timeout: WIZARD_TIMEOUT,
    } as RoutePostType['upstream'],
    // The address's path is where the backend's API lives: /orders under
    // http://backend/v1 is /v1/orders to it, as the importer reads a server.
    ...(built.basePath && {
      plugins: { 'proxy-rewrite': { regex_uri: ['^(.*)$', `${built.basePath}$1`] } },
    }),
  };
};

/**
 * The dialog's answers as a draft for the add page, for "More options".
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

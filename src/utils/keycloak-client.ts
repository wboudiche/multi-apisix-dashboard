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
import type { ClientCredentials } from '@/apis/idps';

/** What the route form knows of the route a client is made for. */
export type OidcRouteContext = {
  id?: string;
  name?: string;
  hosts: string[];
  uris: string[];
};

/**
 * The address the plugin itself would use for a login (the request URI plus
 * .apisix/redirect), when the route has one host and one URI ending in /*;
 * anything else is the operator's to say.
 */
export const proposeRedirectUri = (hosts: string[], uris: string[]): string => {
  if (hosts.length !== 1 || uris.length !== 1) return '';
  const host = hosts[0].trim();
  const uri = uris[0].trim();
  if (!host || host.startsWith('*') || !uri.startsWith('/') || !uri.endsWith('/*')) return '';
  return `https://${host}${uri.slice(0, -1)}.apisix/redirect`;
};

/** What follows the connection's prefix in the client id: the route's name, or its id. */
export const proposeClientIdSuffix = (route: OidcRouteContext): string =>
  (route.name?.trim() || route.id || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

/** The plugin configuration with a client's credentials and the settings its mode needs. */
export const applyClientCredentials = (
  config: Record<string, unknown>,
  c: ClientCredentials
): Record<string, unknown> => {
  const next: Record<string, unknown> = {
    ...config,
    discovery: c.discovery,
    client_id: c.client_id,
    client_secret: c.client_secret,
  };
  if (c.mode === 'login') {
    delete next.bearer_only;
    next.use_pkce = c.options.pkce;
    if (c.redirect_uri) next.redirect_uri = c.redirect_uri;
    return next;
  }
  next.bearer_only = true;
  if (c.options.validation === 'jwks') {
    next.use_jwks = true;
    delete next.introspection_endpoint;
  } else {
    delete next.use_jwks;
    if (c.introspection_endpoint) next.introspection_endpoint = c.introspection_endpoint;
  }
  return next;
};

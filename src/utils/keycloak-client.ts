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
import type { ClientCredentials, OidcClientItem } from '@/apis/idps';
import type { OwnTeams } from '@/stores/team';

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

/**
 * A client id suffix made of a name: lowercase, what it cannot hold made a
 * dash, starting with a letter or digit as the backend requires
 * (^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$), at most 64 long.
 */
const toClientIdSuffix = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|-+$/g, '')
    .slice(0, 64);

/** What follows the connection's prefix in the client id: the route's name, or its id. */
export const proposeClientIdSuffix = (route: OidcRouteContext): string =>
  toClientIdSuffix(route.name?.trim() ?? '') || toClientIdSuffix(route.id ?? '');

/** The plugin configuration with a client's credentials and the settings its mode needs. */
export const applyClientCredentials = (
  config: Record<string, unknown>,
  c: ClientCredentials
): Record<string, unknown> => {
  const claims = config.claim_validator;
  const next: Record<string, unknown> = {
    ...config,
    discovery: c.discovery,
    client_id: c.client_id,
    client_secret: c.client_secret,
    // Only the tokens issued for this client: its own id is in their aud
    // (the backend gives every created client that mapper). Without it any
    // client of the realm, another team's too, gets through. A login route
    // checks it as well, since it also takes a bearer token.
    claim_validator: {
      ...(claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : {}),
      audience: { required: true, match_with_client_id: true },
    },
  };
  if (c.mode === 'login') {
    // What only a token check uses, and a redirect address of an earlier client.
    delete next.bearer_only;
    delete next.use_jwks;
    delete next.introspection_endpoint;
    delete next.redirect_uri;
    next.use_pkce = c.options.pkce;
    if (c.redirect_uri) next.redirect_uri = c.redirect_uri;
    return next;
  }
  // What only a login uses.
  delete next.use_pkce;
  delete next.redirect_uri;
  next.bearer_only = true;
  if (c.options.validation === 'jwks') {
    next.use_jwks = true;
    delete next.introspection_endpoint;
  } else {
    delete next.use_jwks;
    if (c.introspection_endpoint) next.introspection_endpoint = c.introspection_endpoint;
    else delete next.introspection_endpoint;
  }
  return next;
};

/** The realm's token address, derived from its discovery document's. */
export const tokenEndpoint = (discovery: string): string =>
  discovery.replace(/\/\.well-known\/openid-configuration$/, '/protocol/openid-connect/token');

/**
 * The team a non-admin uses a client for: the team their requests name when
 * they are a developer in it, else their only developer team - the backend's
 * acting team, the one the route being written belongs to. None when they
 * name a team they only view, or have several and name none.
 */
export const actingTeam = (own: OwnTeams | undefined, sent: string): string => {
  const writable = own ? own.ids.filter((id) => own.roles[id] === 'developer') : [];
  if (sent) return writable.includes(sent) ? sent : '';
  return writable.length === 1 ? writable[0] : '';
};

/**
 * The clients a caller may put on a route: an admin any of them; anyone else
 * only those of the team the route belongs to. A client of another of their
 * teams would put its secret in a route every member of this one reads, and
 * the backend refuses it.
 */
export const usableClients = <T extends Pick<OidcClientItem, 'team_id'>>(
  clients: T[],
  isAdmin: boolean,
  team: string
): T[] => {
  if (isAdmin) return clients;
  return team ? clients.filter((c) => c.team_id === team) : [];
};

/**
 * A client as a picker lists it. An admin sees every team's, so each says
 * whose it is: by `teamName`, the team's name when known, else its id.
 */
export const clientOptionLabel = (
  c: Pick<OidcClientItem, 'client_id' | 'idp_name' | 'team_id'>,
  isAdmin: boolean,
  teamName?: (id: string) => string | undefined
): string => {
  const base = `${c.client_id} - ${c.idp_name}`;
  if (!isAdmin || !c.team_id) return base;
  return `${base} (${teamName?.(c.team_id) ?? c.team_id})`;
};

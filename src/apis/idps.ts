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
import { parseRecordList } from '@/utils/list-shape';

import { apiClient } from './client';

export type IdentityProvider = {
  id: string;
  name: string;
  type: 'keycloak';
  base_url: string;
  realm: string;
  admin_client_id: string;
  has_secret: boolean;
  client_id_prefix: string;
  instance_ids: string[];
  developers_can_create: boolean;
  /** DNS names a developer's login client may redirect inside; admins are not bound by them. */
  redirect_domains: string[];
  /** The server root the gateways reach Keycloak at, written into routes; empty = base_url. */
  gateway_base_url: string;
};

export type IdentityProviderInput = Omit<IdentityProvider, 'id' | 'type' | 'has_secret'> & {
  admin_client_secret?: string;
};

export type LinkedIdp = {
  id: string;
  name: string;
  discovery: string;
  developers_can_create: boolean;
};

export type OidcClientOptions = {
  pkce: boolean;
  validation?: 'introspection' | 'jwks';
  client_credentials: boolean;
};

export type ClientCredentials = {
  client_id: string;
  client_secret: string;
  discovery: string;
  introspection_endpoint?: string;
  mode: 'login' | 'token';
  options: OidcClientOptions;
  redirect_uri?: string;
};

export type OidcClientItem = {
  uuid: string;
  client_id: string;
  idp_id: string;
  idp_name: string;
  route_id: string;
  team_id: string;
  mode: 'login' | 'token';
  status?: 'ok' | 'no_route' | 'missing' | 'changed' | 'unknown';
  routes?: string[];
};

export type IdpTestResult = { ok: boolean; reason?: string };

const IDPS_PATH = '/api/v1/idps';

/**
 * The body of an update: a secret left empty is not sent, so the stored one
 * is kept (the backend reads an absent field as "unchanged").
 */
export const updatePayload = (input: IdentityProviderInput): IdentityProviderInput => {
  const { admin_client_secret: secret, ...rest } = input;
  return secret ? { ...rest, admin_client_secret: secret } : rest;
};

/**
 * The sentence for the reason a connection test failed. A reason this build
 * does not know reads as unavailable, which is the safest thing to say.
 */
export const testFailureKey = (
  reason: string | undefined
): 'settings.idp.test.auth' | 'settings.idp.test.forbidden' | 'settings.idp.test.unavailable' => {
  switch (reason) {
    case 'auth':
      return 'settings.idp.test.auth';
    case 'forbidden':
      return 'settings.idp.test.forbidden';
    default:
      return 'settings.idp.test.unavailable';
  }
};

/** The Keycloak connections: super admin only, secret write-only. */
export const idpApi = {
  list: async (): Promise<IdentityProvider[]> => {
    const response = await apiClient.get<IdentityProvider[]>(IDPS_PATH);
    return parseRecordList<IdentityProvider>(response.data, IDPS_PATH);
  },
  get: async (id: string): Promise<IdentityProvider> => {
    const response = await apiClient.get<IdentityProvider>(`${IDPS_PATH}/${id}`);
    return response.data;
  },
  create: async (input: IdentityProviderInput): Promise<IdentityProvider> => {
    const response = await apiClient.post<IdentityProvider>(IDPS_PATH, input);
    return response.data;
  },
  update: async (id: string, input: IdentityProviderInput): Promise<IdentityProvider> => {
    const response = await apiClient.put<IdentityProvider>(`${IDPS_PATH}/${id}`, updatePayload(input));
    return response.data;
  },
  /** `force` deletes a connection that still has clients in the registry. */
  remove: async (id: string, force = false): Promise<void> => {
    await apiClient.delete(`${IDPS_PATH}/${id}`, { params: force ? { force: true } : undefined });
  },
  test: async (id: string): Promise<IdpTestResult> => {
    const response = await apiClient.post<IdpTestResult>(`${IDPS_PATH}/${id}/test`);
    return response.data;
  },
};

// The instance of the path must be the one the header names: apiClient sets
// X-Instance-ID from the current instance, and the backend refuses a mismatch.
const instancePath = (instanceId: string) => `/api/v1/instances/${instanceId}`;

/**
 * The instance and team a chain of requests was started for. Named on each
 * request, it is answered for them even after a switch made while it runs.
 */
export type PinnedScope = { instanceId: string; teamId: string };

const pinnedHeaders = (pin?: PinnedScope) =>
  pin ? { headers: { 'X-Instance-ID': pin.instanceId, 'X-Team-ID': pin.teamId } } : undefined;

export const oidcClientApi = {
  /** The connections linked to the instance, with what the route form needs. */
  linked: async (instanceId: string): Promise<LinkedIdp[]> => {
    const response = await apiClient.get<LinkedIdp[]>(`${instancePath(instanceId)}/idps`);
    return parseRecordList<LinkedIdp>(response.data, `${instancePath(instanceId)}/idps`);
  },
  list: async (instanceId: string, withStatus = false, pin?: PinnedScope): Promise<OidcClientItem[]> => {
    const path = `${instancePath(instanceId)}/oidc-clients`;
    const response = await apiClient.get<OidcClientItem[]>(path, {
      params: withStatus ? { status: true } : undefined,
      ...pinnedHeaders(pin),
    });
    return parseRecordList<OidcClientItem>(response.data, path);
  },
  create: async (idpId: string, body: Record<string, unknown>, pin?: PinnedScope): Promise<ClientCredentials> => {
    const response = await apiClient.post<ClientCredentials>(`${IDPS_PATH}/${idpId}/clients`, body, pinnedHeaders(pin));
    return response.data;
  },
  /**
   * A client's credentials, to write into the route `routeId` when it is
   * saved already: the backend then checks the client against that route's
   * team, not the acting one.
   */
  use: async (
    instanceId: string,
    uuid: string,
    pin?: PinnedScope,
    routeId?: string
  ): Promise<ClientCredentials> => {
    const response = await apiClient.post<ClientCredentials>(
      `${instancePath(instanceId)}/oidc-clients/${uuid}/use`,
      undefined,
      { ...pinnedHeaders(pin), params: routeId ? { route: routeId } : undefined }
    );
    return response.data;
  },
  remove: async (instanceId: string, uuid: string, pin?: PinnedScope): Promise<void> => {
    await apiClient.delete(`${instancePath(instanceId)}/oidc-clients/${uuid}`, pinnedHeaders(pin));
  },
};

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

/**
 * Keycloak connections and the clients created through them, for specs that
 * seed through the API and assert on screen.
 *
 * Every connection a spec makes carries a name prefix, and every client a
 * client-id prefix of its own: cleanup removes what carries them, so two specs
 * running at once never take each other's.
 */
import { getFixtures } from './fixtures';
import { apiFetch, HttpError, loginAdmin } from './seed-client';
import {
  KEYCLOAK_ADMIN_CLIENT_ID,
  KEYCLOAK_ADMIN_CLIENT_SECRET,
  KEYCLOAK_FROM_GATEWAY,
  KEYCLOAK_REALM,
  stack,
} from './stack';

export type Idp = {
  id: string;
  name: string;
  base_url: string;
  realm: string;
  admin_client_id: string;
  has_secret: boolean;
  client_id_prefix: string;
  instance_ids: string[];
  developers_can_create: boolean;
  redirect_domains: string[];
  gateway_base_url: string;
};

export type OidcClient = {
  uuid: string;
  client_id: string;
  idp_id: string;
  idp_name: string;
  route_id: string;
  team_id: string;
  mode: 'login' | 'token';
  status?: string;
  routes?: string[];
};

/** The connection to the e2e realm, as an operator would fill it in. */
export const e2eConnection = (name: string, prefix: string) => ({
  name,
  base_url: stack.keycloak,
  realm: KEYCLOAK_REALM,
  admin_client_id: KEYCLOAK_ADMIN_CLIENT_ID,
  admin_client_secret: KEYCLOAK_ADMIN_CLIENT_SECRET,
  client_id_prefix: prefix,
  instance_ids: [getFixtures().localInstanceId],
  developers_can_create: false,
  redirect_domains: [] as string[],
  gateway_base_url: '',
});

export const discoveryUrl = () =>
  `${stack.keycloak}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`;

const onLocal = () => ({ 'X-Instance-ID': getFixtures().localInstanceId });
const clientsPath = () => `/api/v1/instances/${getFixtures().localInstanceId}/oidc-clients`;

export const createIdp = async (
  token: string,
  body: ReturnType<typeof e2eConnection>
): Promise<Idp> => (await apiFetch('/api/v1/idps', token, { method: 'POST', json: body })) as Idp;

export const updateIdp = async (token: string, id: string, body: Record<string, unknown>) =>
  (await apiFetch(`/api/v1/idps/${id}`, token, { method: 'PUT', json: body })) as Idp;

export const listIdps = async (token: string) =>
  (await apiFetch('/api/v1/idps', token)) as Idp[];

/** The clients of the Local instance; with statuses, as the OIDC clients tab reads them. */
export const listOidcClients = async (token: string, withStatus = false) =>
  (await apiFetch(`${clientsPath()}${withStatus ? '?status=true' : ''}`, token, {
    headers: onLocal(),
  })) as OidcClient[];

/**
 * Removes the clients whose id starts with `clientPrefix` (from Keycloak, then
 * from the registry), then the connections whose name starts with `namePrefix`.
 */
export const cleanUpKeycloak = async (namePrefix: string, clientPrefix: string) => {
  const token = await loginAdmin();
  for (const c of await listOidcClients(token).catch(() => [] as OidcClient[])) {
    if (!c.client_id.startsWith(clientPrefix)) continue;
    await apiFetch(`${clientsPath()}/${c.uuid}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
  for (const idp of await listIdps(token)) {
    if (!idp.name.startsWith(namePrefix)) continue;
    await apiFetch(`/api/v1/idps/${idp.id}?force=true`, token, { method: 'DELETE' }).catch(
      (err: unknown) => {
        if (!(err instanceof HttpError) || err.status !== 404) throw err;
      }
    );
  }
};

/** The discovery document's address as the first gateway reaches it. */
export const gatewayDiscoveryUrl = () =>
  `${KEYCLOAK_FROM_GATEWAY}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`;

/**
 * An access token for a client, by the client credentials grant: one call,
 * as a backend calling a protected route makes it.
 */
export const clientCredentialsToken = async (
  clientId: string,
  clientSecret: string
): Promise<string> => {
  const res = await fetch(
    `${stack.keycloak}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );
  if (!res.ok) throw new Error(`[keycloak] token for ${clientId}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
};

/**
 * A token of the e2e service account, straight from Keycloak: what a spec
 * uses to change a client behind the dashboard's back.
 */
const keycloakToken = () =>
  clientCredentialsToken(KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET);

/** Deletes a client in Keycloak directly, by its internal id. */
export const deleteInKeycloak = async (uuid: string) => {
  const res = await fetch(`${stack.keycloak}/admin/realms/${KEYCLOAK_REALM}/clients/${uuid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await keycloakToken()}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`[keycloak] delete client: ${res.status}`);
};

/** The client of that id in Keycloak, or undefined. */
export const findInKeycloak = async (clientId: string) => {
  const res = await fetch(
    `${stack.keycloak}/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${encodeURIComponent(clientId)}`,
    { headers: { Authorization: `Bearer ${await keycloakToken()}` } }
  );
  if (!res.ok) throw new Error(`[keycloak] find client: ${res.status}`);
  const found = (await res.json()) as Record<string, unknown>[];
  return found[0];
};

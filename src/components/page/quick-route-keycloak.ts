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
import type { KeycloakChoice } from '@/components/form-slice/FormPartRoute/quick-create';
import type { RoutePostType } from '@/components/form-slice/FormPartRoute/schema';
import { applyClientCredentials } from '@/utils/keycloak-client';

/** What the save needs from the outside, so the order of its steps can be tested alone. */
export type KeycloakSaveDeps = {
  /** Returns the new route's id. */
  postRoute(body: RoutePostType): Promise<string>;
  patchRoute(id: string, body: Record<string, unknown>): Promise<void>;
  deleteRoute(id: string): Promise<void>;
  createClient(idpId: string, body: Record<string, unknown>): Promise<ClientCredentials>;
  useClient(uuid: string): Promise<ClientCredentials>;
  listClients(): Promise<OidcClientItem[]>;
  deleteClient(uuid: string): Promise<void>;
  isAdmin: boolean;
};

export type KeycloakSaveFailure = {
  step: 'route' | 'client' | 'attach' | 'reuse';
  /** The error of the step that failed, never one of a cleanup. */
  cause: unknown;
  route: 'none' | 'deleted' | 'kept-disabled';
  routeId?: string;
  /** 'left': the client has no route and an administrator has to delete it. */
  client: 'none' | 'deleted' | 'left';
  clientId?: string;
};

export class KeycloakSaveError extends Error {
  failure: KeycloakSaveFailure;
  cause: unknown;
  constructor(failure: KeycloakSaveFailure) {
    super('keycloak-save-failed');
    this.cause = failure.cause;
    this.name = 'KeycloakSaveError';
    this.failure = failure;
  }
}

/**
 * What of a rejection may be kept: its message and the backend's answer. A
 * request error (an AxiosError) also carries the request it sent, whose body
 * holds the client secret, so the error itself is never stored.
 */
export type SafeCause = { message?: string; status?: number; data?: unknown };

const safeCause = (error: unknown): SafeCause => {
  if (!error || typeof error !== 'object') return {};
  const e = error as { message?: unknown; response?: { status?: unknown; data?: unknown } };
  const out: SafeCause = {};
  if (typeof e.message === 'string') out.message = e.message;
  if (e.response && typeof e.response === 'object') {
    if (typeof e.response.status === 'number') out.status = e.response.status;
    if (e.response.data !== undefined) out.data = e.response.data;
  }
  return out;
};

const withPlugin = (
  form: RoutePostType,
  status: 0 | 1,
  credentials: ClientCredentials
): RoutePostType => ({
  ...form,
  status,
  plugins: {
    ...form.plugins,
    'openid-connect': applyClientCredentials({}, credentials),
  },
});

/** Removes the route made for the save; false when it is still there. */
const dropRoute = async (deps: KeycloakSaveDeps, routeId: string): Promise<boolean> => {
  try {
    await deps.deleteRoute(routeId);
    return true;
  } catch {
    return false;
  }
};

/** An administrator removes the client of a route that did not come to be; anyone else leaves it. */
const dropClient = async (
  deps: KeycloakSaveDeps,
  credentials: ClientCredentials,
  routeId: string,
  idpId: string
): Promise<'deleted' | 'left'> => {
  if (!deps.isAdmin) return 'left';
  try {
    // The id alone may be held by another connection or realm: only the client
    // made for this route, on this connection, is ours, and only if it is one.
    const found = (await deps.listClients()).filter(
      (c) =>
        c.client_id === credentials.client_id && c.route_id === routeId && c.idp_id === idpId
    );
    if (found.length !== 1) return 'left';
    await deps.deleteClient(found[0].uuid);
    return 'deleted';
  } catch {
    return 'left';
  }
};

/**
 * Saves a route that is protected by a Keycloak client, or leaves neither
 * behind. A reused client needs one request: the route is posted with the
 * plugin. A new client is made for a route that exists, so the route is
 * posted disabled first, then the client is made and the plugin attached; if
 * either fails, what was made is taken back.
 */
export const saveWithKeycloak = async (
  deps: KeycloakSaveDeps,
  form: RoutePostType,
  status: 0 | 1,
  choice: KeycloakChoice
): Promise<{ routeId: string; credentials: ClientCredentials; created: boolean }> => {
  if (choice.kind === 'reuse') {
    let credentials: ClientCredentials;
    try {
      credentials = await deps.useClient(choice.uuid);
    } catch (cause) {
      throw new KeycloakSaveError({ step: 'reuse', cause: safeCause(cause), route: 'none', client: 'none' });
    }
    try {
      const routeId = await deps.postRoute(withPlugin(form, status, credentials));
      return { routeId, credentials, created: false };
    } catch (cause) {
      throw new KeycloakSaveError({ step: 'route', cause: safeCause(cause), route: 'none', client: 'none' });
    }
  }

  const plugins = { ...form.plugins };
  delete plugins['openid-connect'];
  let routeId: string;
  try {
    routeId = await deps.postRoute({ ...form, status: 0, plugins });
  } catch (cause) {
    throw new KeycloakSaveError({ step: 'route', cause: safeCause(cause), route: 'none', client: 'none' });
  }

  let credentials: ClientCredentials;
  try {
    credentials = await deps.createClient(choice.idpId, {
      route_id: routeId,
      client_id: choice.suffix,
      mode: 'token',
      options: { pkce: false, validation: choice.validation, client_credentials: true },
    });
  } catch (cause) {
    const deleted = await dropRoute(deps, routeId);
    throw new KeycloakSaveError({
      step: 'client',
      cause: safeCause(cause),
      route: deleted ? 'deleted' : 'kept-disabled',
      routeId,
      client: 'none',
    });
  }

  try {
    await deps.patchRoute(routeId, {
      status,
      plugins: { 'openid-connect': applyClientCredentials({}, credentials) },
    });
  } catch (cause) {
    const deleted = await dropRoute(deps, routeId);
    const client = await dropClient(deps, credentials, routeId, choice.idpId);
    throw new KeycloakSaveError({
      step: 'attach',
      cause: safeCause(cause),
      route: deleted ? 'deleted' : 'kept-disabled',
      routeId,
      client,
      clientId: credentials.client_id,
    });
  }
  return { routeId, credentials, created: true };
};

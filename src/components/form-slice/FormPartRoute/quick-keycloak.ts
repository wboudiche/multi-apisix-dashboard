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
import type { LinkedIdp, OidcClientItem } from '@/apis/idps';
import type { KeycloakSaveFailure, SafeCause } from '@/components/page/quick-route-keycloak';

import type { KeycloakChoice } from './quick-create';

/**
 * The clients the quick page may reuse: those that check a token. A login
 * client would put a browser login on the route, which needs a redirect
 * address and a session - the advanced form's.
 */
export const tokenClients = (clients: OidcClientItem[]): OidcClientItem[] =>
  clients.filter((c) => c.mode === 'token');

/**
 * Whether the quick page offers a Keycloak token: not on a copy, which keeps
 * the original's plugins, nor beside a service that sets an authentication,
 * and only with a connection to make a client with or a token client to reuse.
 */
export const keycloakChoiceAvailable = (a: {
  duplicating: boolean;
  serviceHasAuth: boolean;
  creators: LinkedIdp[];
  reusable: OidcClientItem[];
}): boolean =>
  !a.duplicating &&
  !a.serviceHasAuth &&
  (a.creators.length > 0 || tokenClients(a.reusable).length > 0);

/**
 * Where the choice starts: a client made on the first connection the caller
 * may create with, checked by its signature (no call to Keycloak per
 * request); with none, a client to pick.
 */
export const initialKeycloakChoice = (creators: LinkedIdp[], suffix: string): KeycloakChoice =>
  creators.length > 0
    ? { kind: 'create', idpId: creators[0].id, suffix, validation: 'jwks' }
    : { kind: 'reuse', uuid: '' };

/**
 * The choice the route is saved with. Fails closed: with no choice yet, it is
 * a client still to pick - never no authentication while the control says
 * Keycloak token. A reused client gone from the list (deleted, or the list
 * read again) is one the select can no longer show, so it is picked again.
 */
export const effectiveKeycloakChoice = (
  choice: KeycloakChoice | null,
  reusable: OidcClientItem[]
): KeycloakChoice => {
  if (!choice) return { kind: 'reuse', uuid: '' };
  if (choice.kind === 'reuse' && choice.uuid && !reusable.some((c) => c.uuid === choice.uuid)) {
    return { kind: 'reuse', uuid: '' };
  }
  return choice;
};

/** Another instance: its connections and clients are others, so the choice starts over. */
export const keycloakChoiceAfterInstanceChange = (): KeycloakChoice | null => null;

/** What becomes of a Keycloak token picked as the access, when the page changes under it. */
export type KeycloakAccessState = {
  /**
   * The access the form keeps. Only a service that sets an authentication of
   * its own takes it back to anyone: the service then protects the route.
   */
  access: 'openid-connect' | 'anyone';
  /** Whether the client picked starts over: another instance's are others. */
  resetChoice: boolean;
  /** Why the route cannot be saved as it stands, a key. */
  error?: 'form.quickRoute.keycloak.notOffered';
};

/**
 * A Keycloak token stays the access when the instance changes or Keycloak
 * stops being offered: falling back to anyone would save a route open to
 * all while the user asked for a token. Not offered, it blocks the save and
 * says so, for another access to be picked.
 */
export const keycloakAccessState = (a: {
  offered: boolean;
  serviceHasAuth: boolean;
  instanceChanged: boolean;
}): KeycloakAccessState => {
  if (a.serviceHasAuth) return { access: 'anyone', resetChoice: a.instanceChanged };
  return {
    access: 'openid-connect',
    resetChoice: a.instanceChanged,
    ...(!a.offered && { error: 'form.quickRoute.keycloak.notOffered' as const }),
  };
};

/** The sentences a failed save can be told in. */
export type FailureMessageKey =
  | 'form.quickRoute.keycloak.failed.routeKeptDisabled'
  | 'form.quickRoute.keycloak.failed.routeKeptDisabledClientLeft'
  | 'form.quickRoute.keycloak.failed.reuse'
  | 'form.quickRoute.keycloak.failed.clientRouteDeleted'
  | 'form.quickRoute.keycloak.failed.attachClientLeft'
  | 'form.quickRoute.keycloak.failed.attachRouteDeleted'
  | 'routes.createFailed';

/** What the page says of a failed save: what failed, and what was left behind. */
export const failureMessageKey = (f: KeycloakSaveFailure): FailureMessageKey => {
  // A client left behind is said too: it is listed for an administrator to delete.
  if (f.route === 'kept-disabled') {
    return f.client === 'left'
      ? 'form.quickRoute.keycloak.failed.routeKeptDisabledClientLeft'
      : 'form.quickRoute.keycloak.failed.routeKeptDisabled';
  }
  switch (f.step) {
    case 'reuse':
      return 'form.quickRoute.keycloak.failed.reuse';
    case 'client':
      return 'form.quickRoute.keycloak.failed.clientRouteDeleted';
    case 'attach':
      return f.client === 'left'
        ? 'form.quickRoute.keycloak.failed.attachClientLeft'
        : 'form.quickRoute.keycloak.failed.attachRouteDeleted';
    default:
      return 'routes.createFailed';
  }
};

/**
 * The reason the step's answer gave: the backend's (`{ error }`), the
 * gateway's (`{ error_msg }`), else the request's own message.
 */
export const failureReason = (f: KeycloakSaveFailure): string | undefined => {
  const cause = (f.cause ?? {}) as SafeCause;
  const data = (cause.data ?? {}) as { error?: unknown; error_msg?: unknown };
  if (typeof data.error === 'string' && data.error) return data.error;
  if (typeof data.error_msg === 'string' && data.error_msg) return data.error_msg;
  return cause.message || undefined;
};

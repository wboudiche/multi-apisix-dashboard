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
import { describe, expect, it } from 'vitest';

import type { LinkedIdp, OidcClientItem } from '@/apis/idps';
import type { KeycloakSaveFailure } from '@/components/page/quick-route-keycloak';

import {
  failureMessageKey,
  failureReason,
  initialKeycloakChoice,
  keycloakChoiceAfterInstanceChange,
  keycloakChoiceAvailable,
  tokenClients,
} from './quick-keycloak';

const idp = (id: string): LinkedIdp => ({
  id,
  name: id,
  discovery: `http://kc/realms/${id}/.well-known/openid-configuration`,
  developers_can_create: true,
});
const client = (uuid: string, mode: 'login' | 'token'): OidcClientItem =>
  ({ uuid, client_id: `c-${uuid}`, idp_id: 'idp1', idp_name: 'kc', route_id: 'r', team_id: '', mode }) as OidcClientItem;

const base = { duplicating: false, serviceHasAuth: false, creators: [], reusable: [] };

describe('tokenClients', () => {
  it('keeps the token clients only: a login one would make a browser login', () => {
    expect(tokenClients([client('a', 'login'), client('b', 'token')]).map((c) => c.uuid)).toEqual(['b']);
  });
});

describe('keycloakChoiceAvailable', () => {
  it('is not offered on a copy', () => {
    expect(keycloakChoiceAvailable({ ...base, duplicating: true, creators: [idp('a')] })).toBe(false);
  });
  it('is not offered when the service sets an authentication', () => {
    expect(keycloakChoiceAvailable({ ...base, serviceHasAuth: true, creators: [idp('a')] })).toBe(false);
  });
  it('is not offered with no connection and no client', () => {
    expect(keycloakChoiceAvailable(base)).toBe(false);
  });
  it('is offered with a connection to create with', () => {
    expect(keycloakChoiceAvailable({ ...base, creators: [idp('a')] })).toBe(true);
  });
  it('is offered with only a token client to reuse', () => {
    expect(keycloakChoiceAvailable({ ...base, reusable: [client('b', 'token')] })).toBe(true);
  });
  it('is not offered with only a login client', () => {
    expect(keycloakChoiceAvailable({ ...base, reusable: [client('a', 'login')] })).toBe(false);
  });
});

describe('initialKeycloakChoice', () => {
  it('creates on the first connection, checked by JWKS', () => {
    expect(initialKeycloakChoice([idp('a'), idp('b')], 'orders')).toEqual({
      kind: 'create',
      idpId: 'a',
      suffix: 'orders',
      validation: 'jwks',
    });
  });
  it('reuses, nothing picked, without a connection', () => {
    expect(initialKeycloakChoice([], 'orders')).toEqual({ kind: 'reuse', uuid: '' });
  });
});

describe('keycloakChoiceAfterInstanceChange', () => {
  it('starts over', () => {
    expect(keycloakChoiceAfterInstanceChange()).toBeNull();
  });
});

const failure = (over: Partial<KeycloakSaveFailure>): KeycloakSaveFailure => ({
  step: 'route',
  cause: {},
  route: 'none',
  client: 'none',
  ...over,
});

describe('failureMessageKey', () => {
  it('client failed, route deleted', () => {
    expect(failureMessageKey(failure({ step: 'client', route: 'deleted' }))).toBe(
      'form.quickRoute.keycloak.failed.clientRouteDeleted'
    );
  });
  it('attach failed, route deleted, client left for an administrator', () => {
    expect(failureMessageKey(failure({ step: 'attach', route: 'deleted', client: 'left' }))).toBe(
      'form.quickRoute.keycloak.failed.attachClientLeft'
    );
  });
  it('attach failed, route and client deleted', () => {
    expect(failureMessageKey(failure({ step: 'attach', route: 'deleted', client: 'deleted' }))).toBe(
      'form.quickRoute.keycloak.failed.attachRouteDeleted'
    );
  });
  it('route kept disabled, whichever step failed', () => {
    expect(failureMessageKey(failure({ step: 'client', route: 'kept-disabled' }))).toBe(
      'form.quickRoute.keycloak.failed.routeKeptDisabled'
    );
    expect(failureMessageKey(failure({ step: 'attach', route: 'kept-disabled', client: 'left' }))).toBe(
      'form.quickRoute.keycloak.failed.routeKeptDisabled'
    );
  });
  it('reuse failed', () => {
    expect(failureMessageKey(failure({ step: 'reuse' }))).toBe('form.quickRoute.keycloak.failed.reuse');
  });
  it('the route itself failed: the page says so as for any route', () => {
    expect(failureMessageKey(failure({ step: 'route' }))).toBe('routes.createFailed');
  });
});

describe('failureReason', () => {
  it("reads the backend's reason", () => {
    expect(failureReason(failure({ cause: { status: 400, data: { error: 'client exists' }, message: 'x' } }))).toBe(
      'client exists'
    );
  });
  it("reads the gateway's reason", () => {
    expect(failureReason(failure({ cause: { data: { error_msg: 'bad plugin' } } }))).toBe('bad plugin');
  });
  it('falls back to the message, then to nothing', () => {
    expect(failureReason(failure({ cause: { message: 'Network Error' } }))).toBe('Network Error');
    expect(failureReason(failure({ cause: {} }))).toBeUndefined();
    expect(failureReason(failure({ cause: undefined }))).toBeUndefined();
  });
});

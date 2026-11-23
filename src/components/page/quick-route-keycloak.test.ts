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

import type { ClientCredentials, OidcClientItem } from '@/apis/idps';
import type { RoutePostType } from '@/components/form-slice/FormPartRoute/schema';

import {
  type KeycloakSaveDeps,
  KeycloakSaveError,
  type KeycloakSaveFailure,
  saveWithKeycloak,
} from './quick-route-keycloak';

const creds: ClientCredentials = {
  client_id: 'apisix-orders',
  client_secret: 's3cret',
  discovery: 'http://kc/realms/r/.well-known/openid-configuration',
  mode: 'token',
  options: { pkce: false, validation: 'jwks', client_credentials: true },
};

const form = { name: 'orders', uris: ['/orders'], status: 1 } as unknown as RoutePostType;

type Calls = string[];
const entry = (uuid: string, over: Partial<OidcClientItem> = {}): OidcClientItem =>
  ({ uuid, client_id: creds.client_id, route_id: 'r1', idp_id: 'idp1', ...over }) as OidcClientItem;

const makeDeps = (over: Partial<KeycloakSaveDeps> = {}) => {
  const calls: Calls = [];
  const posted: RoutePostType[] = [];
  const patched: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const deps: KeycloakSaveDeps = {
    postRoute: async (body) => {
      calls.push('post');
      posted.push(body);
      return 'r1';
    },
    patchRoute: async (_id, body) => {
      calls.push('patch');
      patched.push(body);
    },
    deleteRoute: async () => {
      calls.push('delete-route');
    },
    createClient: async (_idp, body) => {
      calls.push('create');
      created.push(body);
      return creds;
    },
    useClient: async () => {
      calls.push('use');
      return creds;
    },
    listClients: async () => {
      calls.push('list');
      return [entry('u9')];
    },
    deleteClient: async () => {
      calls.push('delete-client');
    },
    isAdmin: true,
    ...over,
  };
  return { deps, calls, posted, patched, created };
};

const create = { kind: 'create', idpId: 'idp1', suffix: 'orders', validation: 'jwks' } as const;

const failureOf = async (p: Promise<unknown>): Promise<KeycloakSaveFailure> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(KeycloakSaveError);
    return (e as KeycloakSaveError).failure;
  }
  throw new Error('did not reject');
};

describe('saveWithKeycloak', () => {
  it('create: posts the route disabled, makes the client for it, then attaches and publishes', async () => {
    const t = makeDeps();
    const out = await saveWithKeycloak(t.deps, form, 1, create);
    expect(t.calls).toEqual(['post', 'create', 'patch']);
    expect(t.posted[0].status).toBe(0);
    expect(t.posted[0].plugins?.['openid-connect']).toBeUndefined();
    expect(t.created[0]).toEqual({
      route_id: 'r1',
      client_id: 'orders',
      mode: 'token',
      options: { pkce: false, validation: 'jwks', client_credentials: true },
    });
    const body = t.patched[0] as { status: number; plugins: Record<string, Record<string, unknown>> };
    expect(body.status).toBe(1);
    const plugin = body.plugins['openid-connect'];
    expect(plugin.bearer_only).toBe(true);
    expect(plugin.use_jwks).toBe(true);
    expect(
      (plugin.claim_validator as { audience: { match_with_client_id: boolean } }).audience
        .match_with_client_id
    ).toBe(true);
    expect(out).toEqual({ routeId: 'r1', credentials: creds, created: true });
  });

  it('create as draft keeps status 0 in the PATCH', async () => {
    const t = makeDeps();
    await saveWithKeycloak(t.deps, form, 0, create);
    expect((t.patched[0] as { status: number }).status).toBe(0);
  });

  it('client refused (409): deletes the route', async () => {
    const t = makeDeps({
      createClient: async () => {
        t.calls.push('create');
        throw new Error('409');
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({ step: 'client', route: 'deleted', client: 'none' });
    expect(t.calls).toEqual(['post', 'create', 'delete-route']);
  });

  it('attach fails for an admin: deletes the route and the client', async () => {
    const t = makeDeps();
    const cause = new Error('patch refused');
    t.deps.patchRoute = async () => {
      t.calls.push('patch');
      throw cause;
    };
    let deleted = '';
    t.deps.deleteClient = async (uuid) => {
      deleted = uuid;
    };
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({ step: 'attach', route: 'deleted', client: 'deleted' });
    expect(f.cause).toEqual({ message: cause.message });
    expect(deleted).toBe('u9');
  });

  it('attach fails for a developer: deletes the route, leaves the client', async () => {
    const t = makeDeps({
      isAdmin: false,
      patchRoute: async () => {
        throw new Error('no');
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({
      step: 'attach',
      route: 'deleted',
      client: 'left',
      clientId: creds.client_id,
    });
    expect(t.calls).not.toContain('list');
    expect(t.calls).not.toContain('delete-client');
  });

  it('route delete fails: the route is kept disabled', async () => {
    const t = makeDeps({
      createClient: async () => {
        throw new Error('409');
      },
      deleteRoute: async () => {
        throw new Error('gone wrong');
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({ step: 'client', route: 'kept-disabled', routeId: 'r1' });
  });

  it('reuse: reads the client first, then posts the route once with the plugin and the status', async () => {
    const t = makeDeps();
    const out = await saveWithKeycloak(t.deps, form, 1, { kind: 'reuse', uuid: 'u1' });
    expect(t.calls).toEqual(['use', 'post']);
    expect(t.posted[0].status).toBe(1);
    expect(
      (t.posted[0].plugins?.['openid-connect'] as { client_id: string }).client_id
    ).toBe(creds.client_id);
    expect(out.created).toBe(false);
  });

  it('reuse fails: nothing is posted', async () => {
    const t = makeDeps({
      useClient: async () => {
        throw new Error('nope');
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, { kind: 'reuse', uuid: 'u1' }));
    expect(f).toMatchObject({ step: 'reuse', route: 'none' });
    expect(t.calls).not.toContain('post');
  });

  it('route refused: nothing else is tried', async () => {
    const t = makeDeps({
      postRoute: async () => {
        throw new Error('400');
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({ step: 'route', route: 'none' });
    expect(t.calls).toEqual([]);
  });

  it('never keeps the request of a failed call, which holds the client secret', async () => {
    const request = () =>
      Object.assign(new Error('Request failed'), {
        config: { data: JSON.stringify({ plugins: { 'openid-connect': { client_secret: 's3cret' } } }) },
        response: { status: 400, data: { error_msg: 'refused' } },
      });
    const t1 = makeDeps({
      patchRoute: async () => {
        throw request();
      },
    });
    const t2 = makeDeps({
      postRoute: async () => {
        throw request();
      },
    });
    const reuse = { kind: 'reuse', uuid: 'u1' } as const;
    for (const run of [
      saveWithKeycloak(t1.deps, form, 1, create),
      saveWithKeycloak(t2.deps, form, 1, reuse),
      saveWithKeycloak(t2.deps, form, 1, create),
    ]) {
      let error: KeycloakSaveError | undefined;
      try {
        await run;
      } catch (e) {
        error = e as KeycloakSaveError;
      }
      expect(error).toBeInstanceOf(KeycloakSaveError);
      expect(JSON.stringify(error?.failure)).not.toContain('s3cret');
      expect(JSON.stringify(error?.cause)).not.toContain('s3cret');
      expect(error?.failure.cause).toMatchObject({ status: 400, data: { error_msg: 'refused' } });
    }
  });

  it.each([
    ['another connection', [entry('a', { idp_id: 'idp2' })]],
    ['another route', [entry('a', { route_id: 'r2' })]],
    ['two matches', [entry('a'), entry('b')]],
  ])('attach fails for an admin: leaves the client when the list holds %s', async (_n, list) => {
    const deleted: string[] = [];
    const t = makeDeps({
      patchRoute: async () => {
        throw new Error('no');
      },
      listClients: async () => list,
      deleteClient: async (u) => {
        deleted.push(u);
      },
    });
    const f = await failureOf(saveWithKeycloak(t.deps, form, 1, create));
    expect(f).toMatchObject({ client: 'left', clientId: creds.client_id });
    expect(deleted).toEqual([]);
  });
});

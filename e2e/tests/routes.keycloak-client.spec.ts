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
import { headerTeamSelect, permission } from '@e2e/pom/permission';
import { settingsPom } from '@e2e/pom/settings';
import { deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  cleanUpKeycloak,
  clientCredentialsToken,
  createIdp,
  deleteInKeycloak,
  discoveryUrl,
  e2eConnection,
  findInKeycloak,
  gatewayDiscoveryUrl,
  type Idp,
  listOidcClients,
  updateIdp,
} from '@e2e/utils/keycloak';
import {
  apiFetch,
  ensureUser,
  ensureUserInstanceRole,
  loginAdmin,
} from '@e2e/utils/seed-client';
import {
  KEYCLOAK_ADMIN_CLIENT_ID,
  KEYCLOAK_ADMIN_CLIENT_SECRET,
  KEYCLOAK_FROM_GATEWAY,
  stack,
} from '@e2e/utils/stack';
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { roleText } from '@e2e/utils/ui/roles';
import { expect, type Locator, type Page } from '@playwright/test';
import { customAlphabet } from 'nanoid';

/**
 * The openid-connect form of a saved route makes its Keycloak client, in
 * either mode, or reuses one the dashboard made; developers do so only when
 * the connection lets them, and a login client of theirs only inside the
 * connection's redirect domains. The OIDC clients tab then says which client
 * no route uses any more, and which is gone from Keycloak. A backend gets a
 * token for a created client by the client credentials grant, and the gateway
 * lets it through the route that client protects; a token of another client
 * of the realm is refused.
 *
 * Seeded through the API, asserted on screen. Keycloak is the e2e stack's
 * (realm `apis`); the clients are removed from it in afterAll.
 */
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);
const RUN = nanoid();
const NAME_PREFIX = `e2e-kc-${RUN}`;
const IDP_NAME = `${NAME_PREFIX}-conn`;
const CLIENT_PREFIX = `e2e${RUN}-`;
// The domain developers may redirect inside; every route host below but one is in it.
const DOMAIN = 'kc.e2e.test';
const PROXY = '/api/v1/apisix/admin';
const PASSWORD = 'E2e-Kc!Admin#1';

const fx = () => getFixtures();
const onLocal = (team?: string) => ({
  'X-Instance-ID': fx().localInstanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});

/** The routes, all of dev_user's team (Backend Team). */
const ROUTES = {
  login: { id: `e2ekc-${RUN}-login`, host: `${RUN}-login.${DOMAIN}` },
  token: { id: `e2ekc-${RUN}-token`, host: `${RUN}-token.${DOMAIN}` },
  reuse: { id: `e2ekc-${RUN}-reuse`, host: `${RUN}-reuse.${DOMAIN}` },
  devIn: { id: `e2ekc-${RUN}-devin`, host: `${RUN}-devin.${DOMAIN}` },
  devOut: { id: `e2ekc-${RUN}-devout`, host: `${RUN}-devout.elsewhere.e2e.test` },
  backend: { id: `e2ekc-${RUN}-backend`, host: `${RUN}-backend.${DOMAIN}` },
} as const;
type RouteKey = keyof typeof ROUTES;
/** A route of Frontend Team, the other team of the two-team developer below. */
const FRONT_ROUTE = { id: `e2ekc-${RUN}-front`, host: `${RUN}-front.${DOMAIN}` };

let idp: Idp;
/** The client ids the tests made, by the route they were made on. */
const made: Partial<Record<RouteKey, string>> = {};

/**
 * A client id an earlier test of this serial file made. Asked for by name, so
 * a test whose predecessor failed says which client it lacks, rather than
 * looking for a row or an option named "undefined".
 */
const madeBy = (key: RouteKey, by: string): string => {
  const id = made[key];
  expect(id, `the client id is set by the test "${by}"`).toBeTruthy();
  return id ?? '';
};
const LOGIN_TEST = 'an admin creates a login client from a saved route';
const TOKEN_TEST = 'an admin creates a token client checked by signature';

/**
 * What the gateway sends a request of the backend route to once it lets it
 * through: Keycloak's realm document, a 200 that only a request past the
 * openid-connect check gets. Every other route points nowhere.
 */
const upstreamOf = (key: RouteKey) =>
  key === 'backend'
    ? {
        upstream: {
          type: 'roundrobin',
          nodes: [{ host: new URL(KEYCLOAK_FROM_GATEWAY).hostname, port: 8080, weight: 1 }],
        },
        plugins: { 'proxy-rewrite': { uri: '/realms/apis' } },
      }
    : { upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] } };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const token = await loginAdmin();
  idp = await createIdp(token, e2eConnection(IDP_NAME, CLIENT_PREFIX));
  for (const [key, r] of Object.entries(ROUTES)) {
    await apiFetch(`${PROXY}/routes/${r.id}`, token, {
      method: 'PUT',
      headers: onLocal(fx().backendTeamId),
      json: {
        name: `${RUN}-${key}`,
        uri: `/${r.id}/*`,
        host: r.host,
        ...upstreamOf(key as RouteKey),
      },
    });
  }
  await apiFetch(`${PROXY}/routes/${FRONT_ROUTE.id}`, token, {
    method: 'PUT',
    headers: onLocal(fx().frontendTeamId),
    json: { name: `${RUN}-front`, uri: `/${FRONT_ROUTE.id}/*`, host: FRONT_ROUTE.host, ...upstreamOf('token') },
  });
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const r of [...Object.values(ROUTES), FRONT_ROUTE]) {
    await apiFetch(`${PROXY}/routes/${r.id}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }
  await cleanUpKeycloak(NAME_PREFIX, CLIENT_PREFIX);
  await deleteUsersByPrefix(NAME_PREFIX);
});

const savedOidc = async (routeId: string) => {
  const res = (await apiFetch(`${PROXY}/routes/${routeId}`, await loginAdmin(), {
    headers: onLocal(),
  })) as { value: { plugins?: Record<string, Record<string, unknown>> } };
  return res.value.plugins?.['openid-connect'];
};

/** The route's edit form, on the openid-connect drawer; returns the drawer and its section. */
const openOidcOnRoute = async (page: Page, routeId: string) => {
  await page.goto(`routes/detail/${routeId}`);
  await page.getByRole('button', { name: i18n.t('form.btn.edit'), exact: true }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: i18n.t('form.btn.next') }).click();
  }
  await page.getByRole('button', { name: i18n.t('form.plugins.selectPlugins.title') }).click();
  const picker = page.getByRole('dialog', { name: i18n.t('form.plugins.selectPlugins.title') });
  await picker.getByPlaceholder(i18n.t('form.search'), { exact: true }).fill('openid-connect');
  await picker
    .getByTestId('plugin-openid-connect')
    .getByRole('button', { name: i18n.t('form.btn.add') })
    .click();
  const drawer = page.getByRole('dialog', { name: i18n.t('form.plugins.addPlugin') });
  const section = drawer.getByTestId('oidc-section');
  return { drawer, section, kc: section.getByTestId('oidc-keycloak-picker') };
};

const chooseProvider = async (page: Page, kc: Locator) => {
  await kc.getByRole('textbox', { name: i18n.t('form.plugins.oidc.kc.provider') }).click();
  await page.getByRole('option', { name: IDP_NAME, exact: true }).click();
};

/** Creates the client from the picker, and reads back the id it filled in. */
const createClient = async (page: Page, kc: Locator) => {
  await kc.getByRole('button', { name: i18n.t('form.plugins.oidc.kc.createBtn') }).click();
  const filled = kc.getByText(/^Client .* is filled in/);
  await expect(filled).toBeVisible();
  const id = /^Client (\S+) is filled in/.exec((await filled.textContent()) ?? '')?.[1] ?? '';
  expect(id.startsWith(CLIENT_PREFIX)).toBe(true);
  await expect(filled).toHaveText(i18n.t('form.plugins.oidc.kc.filled', { id }));
  return id;
};

const saveRoute = async (page: Page, drawer: Locator) => {
  await drawer.getByRole('button', { name: i18n.t('form.btn.add'), exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: i18n.t('form.btn.next') }).click();
  await page.getByRole('button', { name: i18n.t('form.btn.submit') }).click();
  await uiHasToastMsg(page, {
    hasText: i18n.t('info.edit.success', { name: i18n.t('routes.singular') }),
  });
};

test(`${LOGIN_TEST}, and the route is saved with it`, async ({
  page,
}) => {
  const { drawer, section, kc } = await openOidcOnRoute(page, ROUTES.login.id);
  await expect(section.getByRole('radio', { name: i18n.t('form.plugins.oidc.login') })).toBeChecked();
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') }).check();
  await chooseProvider(page, kc);
  // Proposed from the route: its name, and the plugin's own callback on its host.
  await expect(
    kc.getByRole('textbox', { name: i18n.t('form.plugins.oidc.kc.clientId'), exact: true })
  ).toHaveValue(`${RUN}-login`);
  await expect(kc.getByRole('textbox', { name: 'redirect_uri' })).toHaveValue(
    `https://${ROUTES.login.host}/${ROUTES.login.id}/.apisix/redirect`
  );

  const id = await createClient(page, kc);
  made.login = id;
  await expect(drawer.getByRole('textbox', { name: '* discovery' })).toHaveValue(discoveryUrl());
  await expect(drawer.getByRole('textbox', { name: '* client_id' })).toHaveValue(id);
  await saveRoute(page, drawer);

  const saved = await savedOidc(ROUTES.login.id);
  expect(saved?.client_id).toBe(id);
  expect(saved?.client_secret).toBeTruthy();
  expect(saved?.use_pkce).toBe(true);
  expect(saved?.bearer_only).toBeUndefined();
  expect(saved?.redirect_uri).toBe(
    `https://${ROUTES.login.host}/${ROUTES.login.id}/.apisix/redirect`
  );

  // In Keycloak, as the dashboard made it, and in the dashboard's registry.
  const inKeycloak = await findInKeycloak(id);
  expect(inKeycloak?.standardFlowEnabled).toBe(true);
  expect(inKeycloak?.publicClient).toBe(false);
  expect(inKeycloak?.directAccessGrantsEnabled).toBe(false);
  const listed = (await listOidcClients(await loginAdmin(), true)).find((c) => c.client_id === id);
  expect(listed?.route_id).toBe(ROUTES.login.id);
  expect(listed?.status).toBe('ok');
});

test(TOKEN_TEST, async ({ page }) => {
  const { drawer, section, kc } = await openOidcOnRoute(page, ROUTES.token.id);
  await section.getByRole('radio', { name: i18n.t('form.plugins.oidc.token') }).check();
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') }).check();
  await chooseProvider(page, kc);
  // A token client has no address to return to.
  await expect(kc.getByRole('textbox', { name: 'redirect_uri' })).toHaveCount(0);
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.jwks') }).check();

  made.token = await createClient(page, kc);
  await saveRoute(page, drawer);

  const saved = await savedOidc(ROUTES.token.id);
  expect(saved?.client_id).toBe(made.token);
  expect(saved?.bearer_only).toBe(true);
  expect(saved?.use_jwks).toBe(true);
  expect(saved?.introspection_endpoint).toBeUndefined();
  expect((await findInKeycloak(made.token))?.standardFlowEnabled).toBe(false);
});

test('the token client is reused on a second route', async ({ page }) => {
  const token = madeBy('token', TOKEN_TEST);
  const { drawer, section, kc } = await openOidcOnRoute(page, ROUTES.reuse.id);
  await section.getByRole('radio', { name: i18n.t('form.plugins.oidc.token') }).check();
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.reuse') }).check();
  await kc.getByRole('textbox', { name: i18n.t('form.plugins.oidc.kc.pick') }).click();
  // An admin's option also names the client's team, after its own name.
  await page.getByRole('option', { name: new RegExp(`^${token} - ${IDP_NAME}( \\(.+\\))?$`) }).click();
  await kc.getByRole('button', { name: i18n.t('form.plugins.oidc.kc.useBtn') }).click();
  await expect(kc.getByText(i18n.t('form.plugins.oidc.kc.filled', { id: token }))).toBeVisible();
  await saveRoute(page, drawer);

  const first = await savedOidc(ROUTES.token.id);
  const second = await savedOidc(ROUTES.reuse.id);
  expect(second?.client_id).toBe(token);
  expect(second?.client_secret).toBe(first?.client_secret);
  expect(second?.use_jwks).toBe(true);
  expect(second?.bearer_only).toBe(true);
});

test('a backend calls the route with a client credentials token, and only with one', async ({
  page,
  request,
}) => {
  // The gateway does not reach Keycloak at the address the backend does
  // (inside its container, that is its own loopback): the connection says
  // where it does, and the client's settings carry that address to the route.
  const admin = await loginAdmin();
  await updateIdp(admin, idp.id, { gateway_base_url: KEYCLOAK_FROM_GATEWAY });

  const { drawer, section, kc } = await openOidcOnRoute(page, ROUTES.backend.id);
  await section.getByRole('radio', { name: i18n.t('form.plugins.oidc.token') }).check();
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') }).check();
  await chooseProvider(page, kc);
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.jwks') }).check();
  await kc.getByRole('switch', { name: i18n.t('form.plugins.oidc.kc.clientCredentials') }).check();

  made.backend = await createClient(page, kc);
  await saveRoute(page, drawer);
  const inKeycloak = (await findInKeycloak(made.backend)) as
    | { serviceAccountsEnabled?: boolean; protocolMappers?: { protocolMapper: string }[] }
    | undefined;
  expect(inKeycloak?.serviceAccountsEnabled).toBe(true);
  expect(inKeycloak?.protocolMappers?.map((m) => m.protocolMapper)).toContain('oidc-audience-mapper');

  const oidc = (await savedOidc(ROUTES.backend.id)) ?? {};
  expect(oidc.client_id).toBe(made.backend);
  expect(oidc.discovery).toBe(gatewayDiscoveryUrl());
  expect(oidc.claim_validator).toEqual({ audience: { required: true, match_with_client_id: true } });

  // What the backend does: one call for a token, then the route with it.
  const token = await clientCredentialsToken(made.backend, String(oidc.client_secret));
  // Playwright's client, not fetch: fetch drops the Host header the route matches on.
  const call = async (authorization?: string) =>
    (
      await request.get(`${stack.gateway}/${ROUTES.backend.id}/orders`, {
        headers: {
          Host: ROUTES.backend.host,
          ...(authorization ? { Authorization: authorization } : {}),
        },
      })
    ).status();

  // The route answered 200 before the plugin was saved: wait for the gateway
  // to refuse a request without a token, which only the plugin does.
  await expect.poll(() => call(), { timeout: 15_000 }).toBe(401);
  expect(await call(`Bearer ${token}`)).toBe(200);
  expect(await call('Bearer not.a.token')).toBe(401);
  // A token Keycloak signed for another client of the realm - as another
  // team's created client would get - is not one for this route's client:
  // a valid token, refused for its audience (403, not 401).
  const other = await clientCredentialsToken(
    KEYCLOAK_ADMIN_CLIENT_ID,
    KEYCLOAK_ADMIN_CLIENT_SECRET
  );
  expect(await call(`Bearer ${other}`)).toBe(403);

  // The tests after this one write the backend's address, as before.
  await updateIdp(admin, idp.id, { gateway_base_url: '' });
});

test('an instance admin opens Settings on the OIDC clients alone', async ({ browser }) => {
  const login = madeBy('login', LOGIN_TEST);
  const token = await loginAdmin();
  const username = `${NAME_PREFIX}-ia`;
  const user = await ensureUser(token, { username, password: PASSWORD });
  await ensureUserInstanceRole(token, user.id, fx().localInstanceId, {
    role: 'instance_admin',
    team_id: fx().backendTeamId,
  });
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await permission.loginAs(page, username, PASSWORD);
    await permission.switchInstance(page, 'Local APISIX');
    await settingsPom.toSettings(page);

    await expect(settingsPom.tab(page, 'settings.oidcClients.title')).toBeVisible();
    await expect(settingsPom.tab(page, 'settings.idp.title')).toHaveCount(0);
    await expect(settingsPom.tab(page, 'settings.passwordPolicy')).toHaveCount(0);
    const row = settingsPom.rowShowing(page, login);
    await expect(row).toContainText(i18n.t('settings.oidcClients.status.ok'));
    await expect(row).toContainText(IDP_NAME);
  } finally {
    await context.close();
  }
});

const asDeveloper = async (page: Page) => {
  await permission.loginAs(page, fx().users.dev.username, fx().users.dev.password);
  await permission.switchInstance(page, 'Local APISIX');
};

test('a developer cannot create a client while the connection does not let them', async ({
  page,
}) => {
  // The connection as beforeAll made it: the next test is the one that opens it to developers.
  expect(idp.developers_can_create, 'the connection is still closed to developers').toBe(false);
  madeBy('token', TOKEN_TEST); // what makes the reuse option appear for this developer
  await asDeveloper(page);
  const { kc } = await openOidcOnRoute(page, ROUTES.devIn.id);
  // Their team's clients are offered for reuse; creating is not.
  await expect(kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.reuse') })).toBeVisible();
  await expect(kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') })).toHaveCount(0);
});

// The backend's reason, which the picker shows as it comes: CreateClient in
// api/internal/handlers/idp_clients.go answers 403 "redirect_uri host must be
// inside one of the connection's redirect domains". Matched on the part that
// names the rule, so a rewording of the rest does not break the spec.
const OUTSIDE_DOMAINS = /the connection's redirect domains/;

test('a developer creates a login client inside the redirect domains, not outside', async ({
  page,
}) => {
  idp = await updateIdp(await loginAdmin(), idp.id, {
    developers_can_create: true,
    redirect_domains: [DOMAIN],
  });
  await asDeveloper(page);

  await test.step('inside the domain: created', async () => {
    const { kc } = await openOidcOnRoute(page, ROUTES.devIn.id);
    await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') }).check();
    await chooseProvider(page, kc);
    made.devIn = await createClient(page, kc);
  });

  await test.step('outside it: refused, and the form says why', async () => {
    const { kc } = await openOidcOnRoute(page, ROUTES.devOut.id);
    await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') }).check();
    await chooseProvider(page, kc);
    await expect(kc.getByRole('textbox', { name: 'redirect_uri' })).toHaveValue(
      `https://${ROUTES.devOut.host}/${ROUTES.devOut.id}/.apisix/redirect`
    );
    await kc.getByRole('button', { name: i18n.t('form.plugins.oidc.kc.createBtn') }).click();
    await expect(kc.getByRole('alert').filter({ hasText: OUTSIDE_DOMAINS })).toBeVisible();
  });

  const ids = (await listOidcClients(await loginAdmin())).map((c) => c.client_id);
  expect(ids).toContain(made.devIn);
  expect(ids.filter((id) => id.includes('devout'))).toEqual([]);
});

// A developer of two teams, acting for one, edits a route of the other: the
// picker offers the clients of the route's team, and the backend refuses a
// client of the acting team for that route (#464).
test('a developer of two teams reuses only clients of the route\'s own team', async ({
  page,
}) => {
  const backendClient = madeBy('token', TOKEN_TEST);
  const admin = await loginAdmin();
  const front = (await apiFetch(`/api/v1/idps/${idp.id}/clients`, admin, {
    method: 'POST',
    headers: onLocal(fx().frontendTeamId),
    json: {
      route_id: FRONT_ROUTE.id,
      client_id: `front-${RUN}`,
      mode: 'token',
      options: { validation: 'jwks' },
    },
  })) as { client_id: string };
  const frontUuid = (await listOidcClients(admin)).find((c) => c.client_id === front.client_id)?.uuid;
  expect(frontUuid, 'the Frontend Team client is listed').toBeTruthy();

  const username = `${NAME_PREFIX}-two`;
  const user = await ensureUser(admin, { username, password: PASSWORD });
  await ensureUserInstanceRole(admin, user.id, fx().localInstanceId, {
    role: 'developer',
    team_ids: [fx().backendTeamId, fx().frontendTeamId],
  });

  await test.step('the picker of a Backend Team route offers Backend Team clients', async () => {
    await permission.loginAs(page, username, PASSWORD);
    await permission.switchInstance(page, 'Local APISIX');
    await expect(headerTeamSelect(page)).toBeVisible({ timeout: 30000 });
    await headerTeamSelect(page).click();
    await page
      .getByRole('option', { name: `Frontend Team · ${roleText('developer')}`, exact: true })
      .click();
    const { section, kc } = await openOidcOnRoute(page, ROUTES.devOut.id);
    await section.getByRole('radio', { name: i18n.t('form.plugins.oidc.token') }).check();
    await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.reuse') }).check();
    await kc.getByRole('textbox', { name: i18n.t('form.plugins.oidc.kc.pick') }).click();
    await expect(page.getByRole('option', { name: `${front.client_id} - ${IDP_NAME}` })).toHaveCount(0);
    await page.getByRole('option', { name: `${backendClient} - ${IDP_NAME}`, exact: true }).click();
    await kc.getByRole('button', { name: i18n.t('form.plugins.oidc.kc.useBtn') }).click();
    await expect(kc.getByText(i18n.t('form.plugins.oidc.kc.filled', { id: backendClient }))).toBeVisible();
  });

  await test.step('the backend refuses the acting team\'s client for that route', async () => {
    const dev = await loginAdmin(username, PASSWORD);
    const use = (route: string) =>
      apiFetch(`/api/v1/instances/${fx().localInstanceId}/oidc-clients/${frontUuid}/use?route=${route}`, dev, {
        method: 'POST',
        headers: onLocal(fx().frontendTeamId),
      });
    await expect(use(ROUTES.devOut.id)).rejects.toMatchObject({ status: 403 });
    await expect(use(FRONT_ROUTE.id)).resolves.toMatchObject({ client_id: front.client_id });
  });
});

test('a client no route uses any more reads "No route"', async ({ page }) => {
  const tokenClient = madeBy('token', TOKEN_TEST);
  const login = madeBy('login', LOGIN_TEST);
  // The reusing route drops the plugin, then the route it was made for goes.
  const token = await loginAdmin();
  const reuse = (await apiFetch(`${PROXY}/routes/${ROUTES.reuse.id}`, token, {
    headers: onLocal(),
  })) as { value: Record<string, unknown> };
  const withoutPlugins = { ...reuse.value };
  delete withoutPlugins.plugins;
  await apiFetch(`${PROXY}/routes/${ROUTES.reuse.id}`, token, {
    method: 'PUT',
    headers: onLocal(),
    json: withoutPlugins,
  });
  await apiFetch(`${PROXY}/routes/${ROUTES.token.id}`, token, {
    method: 'DELETE',
    headers: onLocal(),
  });

  await settingsPom.toOidcClients(page);
  await expect(settingsPom.rowShowing(page, tokenClient)).toContainText(
    i18n.t('settings.oidcClients.status.noRoute')
  );
  await expect(settingsPom.rowShowing(page, login)).toContainText(
    i18n.t('settings.oidcClients.status.ok')
  );
});

test('a client deleted in Keycloak reads "Missing in Keycloak"', async ({ page }) => {
  const login = madeBy('login', LOGIN_TEST);
  const entry = (await listOidcClients(await loginAdmin())).find((c) => c.client_id === login);
  expect(entry, `${login} is in the registry`).toBeTruthy();
  await deleteInKeycloak(entry?.uuid ?? '');

  await settingsPom.toOidcClients(page);
  await expect(settingsPom.rowShowing(page, login)).toContainText(
    i18n.t('settings.oidcClients.status.missing')
  );
});

test('the OIDC clients tab still loads once the routes of this spec are gone', async ({
  page,
}) => {
  const login = madeBy('login', LOGIN_TEST);
  const token = await loginAdmin();
  for (const r of Object.values(ROUTES)) {
    await apiFetch(`${PROXY}/routes/${r.id}`, token, {
      method: 'DELETE',
      headers: onLocal(),
    }).catch(() => undefined);
  }

  // On an instance with no route left, the gateway answers its route list
  // with {} rather than [], which the tab once read as a failure (502): a
  // failed list shows no row at all.
  await settingsPom.toOidcClients(page);
  await expect(settingsPom.rowShowing(page, login)).toBeVisible();
});

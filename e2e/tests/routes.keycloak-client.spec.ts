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
import { permission } from '@e2e/pom/permission';
import { settingsPom } from '@e2e/pom/settings';
import { deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  cleanUpKeycloak,
  createIdp,
  deleteInKeycloak,
  discoveryUrl,
  e2eConnection,
  findInKeycloak,
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
import { test } from '@e2e/utils/test';
import { uiHasToastMsg } from '@e2e/utils/ui';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Locator, type Page } from '@playwright/test';
import { customAlphabet } from 'nanoid';

/**
 * The openid-connect form of a saved route makes its Keycloak client, in
 * either mode, or reuses one the dashboard made; developers do so only when
 * the connection lets them, and a login client of theirs only inside the
 * connection's redirect domains. The OIDC clients tab then says which client
 * no route uses any more, and which is gone from Keycloak.
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
} as const;
type RouteKey = keyof typeof ROUTES;

let idp: Idp;
/** The client ids the tests made, by the route they were made on. */
const made: Partial<Record<RouteKey, string>> = {};

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
        upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
      },
    });
  }
});

test.afterAll(async () => {
  const token = await loginAdmin();
  for (const r of Object.values(ROUTES)) {
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
  await picker.getByPlaceholder('Search').fill('openid-connect');
  await picker
    .getByTestId('plugin-openid-connect')
    .getByRole('button', { name: i18n.t('form.btn.add') })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Add Plugin' });
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

test('an admin creates a login client from a saved route, and the route is saved with it', async ({
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

test('an admin creates a token client checked by signature', async ({ page }) => {
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
  const { drawer, section, kc } = await openOidcOnRoute(page, ROUTES.reuse.id);
  await section.getByRole('radio', { name: i18n.t('form.plugins.oidc.token') }).check();
  await kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.reuse') }).check();
  await kc.getByRole('textbox', { name: i18n.t('form.plugins.oidc.kc.pick') }).click();
  await page.getByRole('option', { name: `${made.token} - ${IDP_NAME}`, exact: true }).click();
  await kc.getByRole('button', { name: i18n.t('form.plugins.oidc.kc.useBtn') }).click();
  await expect(kc.getByText(i18n.t('form.plugins.oidc.kc.filled', { id: made.token }))).toBeVisible();
  await saveRoute(page, drawer);

  const first = await savedOidc(ROUTES.token.id);
  const second = await savedOidc(ROUTES.reuse.id);
  expect(second?.client_id).toBe(made.token);
  expect(second?.client_secret).toBe(first?.client_secret);
  expect(second?.use_jwks).toBe(true);
  expect(second?.bearer_only).toBe(true);
});

test('an instance admin opens Settings on the OIDC clients alone', async ({ browser }) => {
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
    const row = settingsPom.rowShowing(page, made.login ?? '');
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
  await asDeveloper(page);
  const { kc } = await openOidcOnRoute(page, ROUTES.devIn.id);
  // Their team's clients are offered for reuse; creating is not.
  await expect(kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.reuse') })).toBeVisible();
  await expect(kc.getByRole('radio', { name: i18n.t('form.plugins.oidc.kc.create') })).toHaveCount(0);
});

// The backend's reason, shown as the form's problem.
const OUTSIDE_DOMAINS = "redirect_uri host must be inside one of the connection's redirect domains";

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

test('a client no route uses any more reads "No route"', async ({ page }) => {
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
  await expect(settingsPom.rowShowing(page, made.token ?? '')).toContainText(
    i18n.t('settings.oidcClients.status.noRoute')
  );
  await expect(settingsPom.rowShowing(page, made.login ?? '')).toContainText(
    i18n.t('settings.oidcClients.status.ok')
  );
});

test('a client deleted in Keycloak reads "Missing in Keycloak"', async ({ page }) => {
  const entry = (await listOidcClients(await loginAdmin())).find((c) => c.client_id === made.login);
  expect(entry).toBeTruthy();
  await deleteInKeycloak(entry?.uuid ?? '');

  await settingsPom.toOidcClients(page);
  await expect(settingsPom.rowShowing(page, made.login ?? '')).toContainText(
    i18n.t('settings.oidcClients.status.missing')
  );
});

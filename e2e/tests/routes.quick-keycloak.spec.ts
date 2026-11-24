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
import { headerSelect } from '@e2e/pom/permission';
import { routesPom } from '@e2e/pom/routes';
import { deleteRoutesByNamePrefix } from '@e2e/utils/cleanup';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  cleanUpKeycloak,
  clientCredentialsToken,
  createIdp,
  e2eConnection,
  gatewayDiscoveryUrl,
  type Idp,
  listOidcClients,
  type OidcClient,
} from '@e2e/utils/keycloak';
import { e2eReq, listEvery } from '@e2e/utils/req';
import { apiFetch, loginAdmin } from '@e2e/utils/seed-client';
import {
  KEYCLOAK_ADMIN_CLIENT_ID,
  KEYCLOAK_ADMIN_CLIENT_SECRET,
  KEYCLOAK_FROM_GATEWAY,
  KEYCLOAK_REALM,
  stack,
} from '@e2e/utils/stack';
import { test } from '@e2e/utils/test';
import { i18n } from '@e2e/utils/ui/i18n';
import { expect, type Locator, type Page } from '@playwright/test';
import { customAlphabet } from 'nanoid';

import { API_ROUTES } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

/**
 * The quick route page's "Keycloak token": the route is saved with a client
 * made for it in Keycloak (or one made earlier), and the gateway then lets
 * through only a token of that client - none is a 401, another client's a
 * 403. The client's secret is shown once, in a dialog. A client that cannot
 * be made leaves no route behind: the route is posted disabled first, and
 * taken back when Keycloak refuses the client.
 *
 * Unit tests stand in for every request of that chain; this file makes them
 * through the backend and the gateway, which is where a request the backend
 * does not route would show.
 *
 * Seeded through the API (the connection, and a token client to reuse),
 * asserted on screen and at the gateway. Keycloak is the e2e stack's (realm
 * `apis`); the clients are removed from it in afterAll.
 */
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);
const RUN = nanoid();
const NAME_PREFIX = `e2e-qk-${RUN}`;
const IDP_NAME = `${NAME_PREFIX}-conn`;
const CLIENT_PREFIX = `e2eqk${RUN}-`;

/** The routes of this file, by name; their paths sit under one prefix of their own. */
const ROUTES = {
  seed: `${NAME_PREFIX}-seed`,
  made: `${NAME_PREFIX}-made`,
  reuse: `${NAME_PREFIX}-reuse`,
  clash: `${NAME_PREFIX}-clash`,
  moved: `${NAME_PREFIX}-moved`,
  unoffered: `${NAME_PREFIX}-unoffered`,
} as const;
type RouteKey = keyof typeof ROUTES;
const pathOf = (key: RouteKey) => `/${NAME_PREFIX}-${key}/*`;

/** The client the page makes, and the one seeded for the page to reuse and to clash with. */
const MADE_ID = `${CLIENT_PREFIX}${RUN}-made`;
const SEED_SUFFIX = `${RUN}-seed`;
const SEED_ID = `${CLIENT_PREFIX}${SEED_SUFFIX}`;
let seedSecret = '';

// In order, on one connection, but each test on its own: none needs another's
// client (the one reused is seeded), so a failure does not skip the rest.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  const token = await loginAdmin();
  // The gateway reaches Keycloak by its service name, not at the address the
  // backend does: the connection says so, and the route's plugin takes it.
  const idp = await createIdp(token, {
    ...e2eConnection(IDP_NAME, CLIENT_PREFIX),
    gateway_base_url: KEYCLOAK_FROM_GATEWAY,
  });
  // A token client made earlier, as the advanced form makes one: on a route
  // of its own, so the tests below do not hang on the first one's.
  await e2eReq.put(`${API_ROUTES}/${ROUTES.seed}`, {
    name: ROUTES.seed,
    uri: pathOf('seed'),
    upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
  });
  const seeded = (await apiFetch(`/api/v1/idps/${idp.id}/clients`, token, {
    method: 'POST',
    headers: { 'X-Instance-ID': getFixtures().localInstanceId },
    json: {
      route_id: ROUTES.seed,
      client_id: SEED_SUFFIX,
      mode: 'token',
      options: { pkce: false, validation: 'jwks', client_credentials: true },
    },
  })) as { client_id: string; client_secret: string };
  expect(seeded.client_id).toBe(SEED_ID);
  seedSecret = seeded.client_secret;
});

test.afterAll(async () => {
  await deleteRoutesByNamePrefix(NAME_PREFIX);
  // A save the page should have refused would have landed on the second gateway.
  for (const r of await stagingRoutes()) {
    if (r.name?.startsWith(NAME_PREFIX)) {
      await e2eReq.delete(`${API_ROUTES}/${r.id}`, { headers: onStaging() });
    }
  }
  await cleanUpKeycloak(NAME_PREFIX, CLIENT_PREFIX);
});

/** The second gateway, "Staging APISIX" to the dashboard. */
const STAGING = 'Staging APISIX';
const onStaging = () => ({ 'X-Instance-ID': getFixtures().stagingInstanceId });
const stagingRoutes = async () =>
  (
    await e2eReq.get<unknown, { data: { list?: { value: APISIXType['Route'] }[] } }>(API_ROUTES, {
      headers: onStaging(),
    })
  ).data.list?.map((r) => r.value) ?? [];

const routesNamed = async (name: string) =>
  (await listEvery<APISIXType['Route']>(API_ROUTES))
    .map((r) => r.value)
    .filter((r) => r.name === name);

const ourClients = async () =>
  (await listOidcClients(await loginAdmin()))
    .filter((c) => c.client_id.startsWith(CLIENT_PREFIX))
    .map((c) => c.client_id)
    .sort();

/**
 * The quick page filled in for a route to Keycloak's realm document - a 200
 * only a request past the openid-connect check gets - with the Keycloak token
 * chosen. Returns the form and its Keycloak section.
 */
const openKeycloakRoute = async (page: Page, key: RouteKey) => {
  await routesPom.toIndex(page);
  await routesPom.getAddRouteBtn(page).click();
  const form = page.getByRole('region', { name: i18n.t('form.quickRoute.title') });
  await expect(form).toBeVisible();
  await form.getByRole('textbox', { name: i18n.t('form.quickRoute.path') }).fill(pathOf(key));
  await form.getByRole('textbox', { name: i18n.t('form.quickRoute.destUrl') }).fill(KEYCLOAK_FROM_GATEWAY);
  await form.getByRole('textbox', { name: i18n.t('form.quickRoute.name') }).fill(ROUTES[key]);
  // Every path of the route goes to the realm's document.
  await form
    .locator('label')
    .filter({ hasText: new RegExp(`^${i18n.t('form.quickRoute.override')}$`) })
    .click();
  await form
    .getByRole('radiogroup', { name: i18n.t('form.requestOverride.uri') })
    .getByRole('radio', { name: i18n.t('form.requestOverride.uriStatic') })
    .check();
  await form.getByRole('textbox', { name: '/new/path' }).fill(`/realms/${KEYCLOAK_REALM}`);

  await form
    .locator('label')
    .filter({ hasText: new RegExp(`^${i18n.t('form.quickRoute.accessKeycloak')}$`) })
    .click();
  const section = form.getByTestId('quick-keycloak-section');
  await expect(section).toBeVisible();
  return { form, section };
};

/**
 * This file's connection, when there is a choice: other specs may link
 * connections of their own to the same instance, and the page starts on the
 * first. With one, the page offers no choice.
 */
const pickConnection = async (page: Page, section: Locator) => {
  const select = section.getByRole('textbox', { name: i18n.t('form.quickRoute.keycloak.connection') });
  if ((await select.count()) === 0) return;
  await select.click();
  await page.getByRole('option', { name: IDP_NAME, exact: true }).click();
};

const createNewClient = async (page: Page, section: Locator, suffix: string) => {
  await section.getByRole('radio', { name: i18n.t('form.quickRoute.keycloak.create') }).check();
  await pickConnection(page, section);
  await section
    .getByRole('textbox', { name: i18n.t('form.quickRoute.keycloak.clientId') })
    .fill(suffix);
  await expect(
    section.getByRole('radio', { name: i18n.t('form.quickRoute.keycloak.jwks') })
  ).toBeChecked();
};

/** The dialog a new client's secret is shown in, while it is open. */
const secretDialog = (page: Page) =>
  page.getByRole('dialog', { name: i18n.t('form.quickRoute.keycloak.secretTitle') });

const storedOidc = async (name: string) => {
  const [route] = await routesNamed(name);
  expect(route, `the route ${name} is saved`).toBeTruthy();
  return route.plugins?.['openid-connect'] as Record<string, unknown> | undefined;
};

test('a quick route with a new Keycloak client takes only its client\'s tokens', async ({
  page,
  request,
}) => {
  const { form, section } = await openKeycloakRoute(page, 'made');
  await createNewClient(page, section, `${RUN}-made`);
  await form.getByRole('button', { name: i18n.t('form.quickRoute.create'), exact: true }).click();

  // The secret is shown once, with what the caller's application needs beside it.
  const dialog = secretDialog(page);
  await expect(dialog).toBeVisible();
  const shown = (label: string) => dialog.getByLabel(i18n.t(label), { exact: true });
  await expect(shown('form.quickRoute.keycloak.clientId')).toHaveText(MADE_ID);
  const secret = ((await shown('form.quickRoute.keycloak.clientSecret').textContent()) ?? '').trim();
  expect(secret).not.toBe('');
  await expect(shown('form.quickRoute.keycloak.tokenEndpoint')).toHaveText(
    /\/realms\/apis\/protocol\/openid-connect\/token$/
  );

  await dialog.getByRole('button', { name: i18n.t('form.btn.close'), exact: true }).click();
  await expect(dialog).toBeHidden();
  await routesPom.isIndexPage(page);
  await expect(routesPom.rowByName(page, ROUTES.made).first()).toBeVisible();

  // Saved on, with the plugin as a token client's: a bearer token, checked
  // by its signature, meant for this client.
  const [route] = await routesNamed(ROUTES.made);
  expect(route.status).toBe(1);
  const oidc = await storedOidc(ROUTES.made);
  expect(oidc).toMatchObject({
    client_id: MADE_ID,
    client_secret: secret,
    discovery: gatewayDiscoveryUrl(),
    bearer_only: true,
    use_jwks: true,
    claim_validator: { audience: { match_with_client_id: true } },
  });

  const token = await clientCredentialsToken(MADE_ID, secret);
  // Playwright's client, not fetch: the same one every call of this test makes.
  const call = async (authorization?: string) =>
    (
      await request.get(`${stack.gateway}/${NAME_PREFIX}-made/orders`, {
        headers: authorization ? { Authorization: authorization } : {},
      })
    ).status();
  // A gateway worker that has not read the route yet answers 404.
  await expect.poll(() => call(), { timeout: 15_000 }).toBe(401);
  expect(await call(`Bearer ${token}`)).toBe(200);
  // A valid token of the realm, signed for another client: refused for its audience.
  const other = await clientCredentialsToken(
    KEYCLOAK_ADMIN_CLIENT_ID,
    KEYCLOAK_ADMIN_CLIENT_SECRET
  );
  expect(await call(`Bearer ${other}`)).toBe(403);
});

test('reuses a client made earlier', async ({ page }) => {
  const before = await ourClients();
  const { form, section } = await openKeycloakRoute(page, 'reuse');
  await section.getByRole('radio', { name: i18n.t('form.quickRoute.keycloak.reuse') }).check();
  await section.getByRole('textbox', { name: i18n.t('form.quickRoute.keycloak.client') }).click();
  // An admin's option also names the client's team, after its own name.
  await page.getByRole('option', { name: new RegExp(`^${SEED_ID} - ${IDP_NAME}( \\(.+\\))?$`) }).click();
  await form.getByRole('button', { name: i18n.t('form.quickRoute.create'), exact: true }).click();

  // Nothing new to show: the page goes straight back to the list.
  await routesPom.isIndexPage(page);
  await expect(secretDialog(page)).toHaveCount(0);

  const [route] = await routesNamed(ROUTES.reuse);
  expect(route.status).toBe(1);
  expect(await storedOidc(ROUTES.reuse)).toMatchObject({
    client_id: SEED_ID,
    client_secret: seedSecret,
    bearer_only: true,
    use_jwks: true,
  });
  // No client made for it.
  expect(await ourClients()).toEqual(before);
});

test('a client that cannot be made leaves no route', async ({ page }) => {
  const before = await ourClients();
  expect(before).toContain(SEED_ID);

  const { form, section } = await openKeycloakRoute(page, 'clash');
  // The id the seeded client holds: Keycloak refuses it (409).
  await createNewClient(page, section, SEED_SUFFIX);
  await form.getByRole('button', { name: i18n.t('form.quickRoute.create'), exact: true }).click();

  const failure = form
    .getByRole('alert')
    .filter({ hasText: i18n.t('form.quickRoute.keycloak.failed.clientRouteDeleted', { name: ROUTES.clash }) });
  await expect(failure).toBeVisible();
  // The backend's reason, matched on the part that names it
  // (keycloakFailure in api/internal/handlers/idp_clients.go).
  await expect(failure).toContainText(/client ID already exists in Keycloak/);
  await expect(secretDialog(page)).toHaveCount(0);

  expect(await routesNamed(ROUTES.clash)).toEqual([]);
  expect(await ourClients()).toEqual(before);
});

/**
 * Another instance picked in the header, as a person picks it: the page is
 * not reloaded, so the form keeps what was typed and decides what becomes of
 * the access chosen.
 */
const switchInHeader = async (page: Page, instance: string) => {
  const switcher = headerSelect(page);
  await switcher.click();
  await page.getByRole('option', { name: instance, exact: true }).click();
  await expect(switcher).toHaveValue(instance);
};

const accessRadio = (form: Locator, key: string) =>
  form.getByRole('radio', { name: i18n.t(key), exact: true });

/** Neither on the instance the form was opened on nor on the one it moved to. */
const expectNoRoute = async (name: string) => {
  expect((await stagingRoutes()).filter((r) => r.name === name)).toEqual([]);
  expect(await routesNamed(name)).toEqual([]);
};

/**
 * Switching instance with "Keycloak token" chosen used to take the access
 * back to "Anyone" (fixed by "never open a quick keycloak route to all behind
 * the user's back"): Create then saved a route open to all on the new
 * instance. The access stays; only the client, which is the old instance's,
 * is picked again.
 */
test('keeps the Keycloak token when the instance changes, and asks for a client again', async ({
  page,
}) => {
  const token = await loginAdmin();
  const fx = getFixtures();
  // A connection of its own on both instances: the file's stays on Local only.
  const both: Idp = await createIdp(token, {
    ...e2eConnection(`${NAME_PREFIX}-both`, CLIENT_PREFIX),
    instance_ids: [fx.localInstanceId, fx.stagingInstanceId],
    gateway_base_url: KEYCLOAK_FROM_GATEWAY,
  });
  try {
    const { form, section } = await openKeycloakRoute(page, 'moved');
    await createNewClient(page, section, `${RUN}-moved`);

    await switchInHeader(page, STAGING);

    await expect(accessRadio(form, 'form.quickRoute.accessKeycloak')).toBeChecked();
    await expect(accessRadio(form, 'form.quickRoute.accessAnyone')).not.toBeChecked();
    // Offered here too: the section stays, with no client picked.
    await expect(section).toBeVisible();
    await expect(form.getByText(i18n.t('form.quickRoute.keycloak.notOffered'))).toHaveCount(0);

    await form.getByRole('button', { name: i18n.t('form.quickRoute.create'), exact: true }).click();
    await expect(section.getByText(i18n.t('form.validation.keycloakClientRequired'))).toBeVisible();
    await expect(secretDialog(page)).toHaveCount(0);
    await expect(form).toBeVisible();

    await expectNoRoute(ROUTES.moved);
    expect(await ourClients()).not.toContain(`${CLIENT_PREFIX}${RUN}-moved`);
  } finally {
    await apiFetch(`/api/v1/idps/${both.id}?force=true`, token, { method: 'DELETE' });
  }
});

/**
 * The same switch, to an instance with no connection and no token client:
 * the Keycloak token is no longer offered, and the page says so and refuses
 * to save rather than saving the route open to all.
 */
test('says Keycloak is not offered on an instance without it, and creates nothing', async ({
  page,
}) => {
  const token = await loginAdmin();
  const staging = getFixtures().stagingInstanceId;
  const onIt = { headers: { 'X-Instance-ID': staging } };
  // The premise: Staging offers no Keycloak - no connection, no token client.
  const linked = (await apiFetch(`/api/v1/instances/${staging}/idps`, token, onIt)) as Idp[];
  expect(linked, 'no Keycloak connection is linked to Staging').toEqual([]);
  const clients = (await apiFetch(
    `/api/v1/instances/${staging}/oidc-clients`,
    token,
    onIt
  )) as OidcClient[];
  expect(clients.filter((c) => c.mode === 'token'), 'Staging has no token client').toEqual([]);

  const { form, section } = await openKeycloakRoute(page, 'unoffered');
  await createNewClient(page, section, `${RUN}-unoffered`);

  await switchInHeader(page, STAGING);

  const notOffered = form
    .getByRole('alert')
    .filter({ hasText: i18n.t('form.quickRoute.keycloak.notOffered') });
  await expect(notOffered).toBeVisible();
  await expect(accessRadio(form, 'form.quickRoute.accessKeycloak')).toBeChecked();
  await expect(accessRadio(form, 'form.quickRoute.accessAnyone')).not.toBeChecked();
  await expect(section).toBeHidden();

  await form.getByRole('button', { name: i18n.t('form.quickRoute.create'), exact: true }).click();
  await expect(notOffered).toBeVisible();
  await expect(secretDialog(page)).toHaveCount(0);
  await expect(form).toBeVisible();

  await expectNoRoute(ROUTES.unoffered);
  expect(await ourClients()).not.toContain(`${CLIENT_PREFIX}${RUN}-unoffered`);
});

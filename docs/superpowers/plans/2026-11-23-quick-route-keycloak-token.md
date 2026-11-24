# Quick route: Keycloak token access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth "Who can call it" choice on the quick route page, *Keycloak token*, that creates or reuses a Keycloak client and protects the new route with `openid-connect` (bearer only, audience checked), leaving nothing behind on failure.

**Architecture:** The choice is held in `QuickAccess` as *what to do*, never as credentials. Saving goes through a pure orchestrator with injected calls (route disabled → client → PATCH with plugin and status; rollback by deleting the route, and the client for an admin). The page wires the orchestrator to the real APIs, shows a section for the choice, and a one-time dialog with the secret.

**Tech Stack:** React 19, Mantine, TanStack Query, vitest (no component testing library: logic stays in pure functions), Playwright e2e against the e2e compose with Keycloak.

**Spec:** `docs/superpowers/specs/2026-11-23-quick-route-keycloak-token-design.md`

**Worktree:** `~/working/mad-quick-route-oidc`, branch `feat/quick-route-keycloak-token`. Never the shared checkout.

## Global Constraints

- No backend change. Client creation stays `POST /api/v1/idps/:id/clients` with an existing `route_id`.
- The route is never enabled without `openid-connect`: it is posted with `status: 0` and only the final PATCH sets the status asked for.
- On failure after the route was posted, the route is deleted (user's rule). If that delete fails, it stays disabled.
- The client secret never enters `QuickRoute`, a draft (`ROUTE_DRAFT_KEY`), localStorage, a query/mutation cache or a log.
- Browser login (Authorization Code) is not offered on the quick page; a link points to the advanced form.
- Validation default: `jwks`. Client credentials: on.
- Every new string through `t()`, key in all five locales (use the `add-i18n-key` skill). ASF header on new files. Commits: Conventional Commits, scope `route`, body explains why, no Co-Authored-By trailer.

## Review Focus

1. **Rate limit with Keycloak access** — `openid-connect` sets no consumer, so `limit-count` must key on `remote_addr`, not `consumer_name` (otherwise every caller shares one counter). Test in Task 1.
2. **"Continue in the advanced form" with Keycloak chosen** — the draft must carry no `openid-connect` and no Keycloak choice; the wizard has its own picker. Test in Task 1.
3. **Instance switched in the header mid-form** — a picked connection or client of the old instance must be dropped. Test in Task 3 (`keycloakChoiceAfterInstanceChange`).
4. **Leaving the page while the chain runs** — the secret would be lost with the client already made: the page must not release its leave-blocker during a Keycloak save. Covered in Task 3, Step 4.
5. **Client id already taken in Keycloak (409)** — a client-step failure: route deleted, backend reason shown. Test in Task 2.

---

### Task 1: The choice in the quick route model

**Files:**
- Modify: `src/components/form-slice/FormPartRoute/quick-create.ts`
- Test: `src/components/form-slice/FormPartRoute/quick-create.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type KeycloakChoice =
    | { kind: 'create'; idpId: string; suffix: string; validation: 'jwks' | 'introspection' }
    | { kind: 'reuse'; uuid: string };
  // QuickAccess gains the variant:
  | { plugin: 'openid-connect'; keycloak: KeycloakChoice }
  ```
  `accessPlugins` returns `{}` for it (the plugin is added at save time). `quickRouteToForm` posts it without `openid-connect`.

- [ ] **Step 1: Write the failing tests** in `quick-create.test.ts`, in a `describe('Keycloak token access')`:
  - `posts no openid-connect and no consumer-restriction`: `quickRouteToForm({...base, access: { plugin: 'openid-connect', keycloak: { kind: 'create', idpId: 'i', suffix: 's', validation: 'jwks' } }}).plugins` has neither `openid-connect` nor `consumer-restriction`.
  - `counts a limit by IP address`: same access with `rateLimit: { count: 5, per: 'minute' }` → `plugins['limit-count'].key === 'remote_addr'`.
  - `hands nothing of it to the advanced form`: `quickRouteToDraft(...)` has no `openid-connect` in `plugins`, and `JSON.stringify(draft)` contains neither `keycloak` nor `secret`.
  - `refuses a create with no connection or no client id`: `answerErrors` with `{kind:'create', idpId:'', ...}` → `errors.access === 'form.quickRoute.keycloak.connectionRequired'`; with `suffix: '  '` → `'form.quickRoute.keycloak.clientIdRequired'`.
  - `refuses a reuse with no client picked`: `{kind:'reuse', uuid:''}` → `errors.access === 'form.quickRoute.keycloak.clientRequired'`.

- [ ] **Step 2: Run, expect FAIL** — `pnpm exec vitest run src/components/form-slice/FormPartRoute/quick-create.test.ts` (type errors / missing variant).

- [ ] **Step 3: Implement.** Add `KeycloakChoice` and the variant. `accessPlugins`: return `{}` when `plugin === 'openid-connect'`. `quickRouteToForm`: the `byClient` argument of `rateLimitPlugins` is true only for `key-auth`/`basic-auth` (`QUICK_AUTH_PLUGINS.includes(...)`), not for `openid-connect`. `answerErrors`: the three keys above. Narrow the existing `restriction` check to the consumer plugins. Add the three keys with `add-i18n-key` ("Pick a Keycloak connection.", "Give the client an id.", "Pick a client to reuse.").

- [ ] **Step 4: Run, expect PASS**, plus `pnpm exec tsc -b` (QuickRouteForm still compiles: it never builds the new variant yet).

- [ ] **Step 5: Commit** — `feat(route): hold a Keycloak token choice in the quick route answers`.

---

### Task 2: Save orchestrator with rollback

**Files:**
- Create: `src/components/page/quick-route-keycloak.ts`
- Test: `src/components/page/quick-route-keycloak.test.ts`
- Modify: `src/utils/keycloak-client.ts` (add `tokenEndpoint`), test in `src/utils/keycloak-client.test.ts`

**Interfaces:**
- Consumes: `KeycloakChoice` (Task 1); `applyClientCredentials`, `ClientCredentials`, `OidcClientItem`.
- Produces:
  ```ts
  export type KeycloakSaveDeps = {
    postRoute(body: RoutePostType): Promise<string>;           // returns the new route id
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
    cause: unknown;
    route: 'none' | 'deleted' | 'kept-disabled';
    routeId?: string;
    client: 'none' | 'deleted' | 'left';   // 'left': no route, for an admin to delete
    clientId?: string;
  };
  export class KeycloakSaveError extends Error { failure: KeycloakSaveFailure }
  export const saveWithKeycloak = (
    deps: KeycloakSaveDeps, form: RoutePostType, status: 0 | 1, choice: KeycloakChoice
  ): Promise<{ routeId: string; credentials: ClientCredentials; created: boolean }>;
  export const tokenEndpoint = (discovery: string): string; // in keycloak-client.ts
  ```

- [ ] **Step 1: Write the failing tests** with fake deps that record calls (array of `'post' | 'create' | 'patch' | 'delete-route' | 'delete-client' | 'use' | 'list'`):
  - `create: posts the route disabled, makes the client for it, then attaches and publishes`: calls are `post, create, patch`; the posted body has `status: 0` and no `openid-connect`; `createClient` got `{ route_id: 'r1', client_id: 'orders', mode: 'token', options: { pkce: false, validation: 'jwks', client_credentials: true } }`; the PATCH body is `{ status: 1, plugins: { 'openid-connect': applyClientCredentials({}, creds) } }` and that plugin has `bearer_only: true`, `use_jwks: true`, `claim_validator.audience.match_with_client_id: true`.
  - `create as draft keeps status 0 in the PATCH`.
  - `client refused (409): deletes the route`: `createClient` rejects → `KeycloakSaveError` with `{ step: 'client', route: 'deleted', client: 'none' }`; calls `post, create, delete-route`.
  - `attach fails for an admin: deletes the route and the client`: `patchRoute` rejects, `listClients` returns `[{ uuid: 'u9', client_id: creds.client_id, ... }]` → `{ step: 'attach', route: 'deleted', client: 'deleted' }`, `deleteClient('u9')` called.
  - `attach fails for a developer: deletes the route, leaves the client`: `isAdmin: false` → `client: 'left'`, `clientId` set, no `list`/`delete-client` call.
  - `route delete fails: the route is kept disabled`: `createClient` and `deleteRoute` reject → `{ route: 'kept-disabled', routeId: 'r1' }`.
  - `reuse: reads the client first, then posts the route once with the plugin and the status`: calls `use, post`; posted body has `status: 1` and `plugins['openid-connect'].client_id`; `created: false`.
  - `reuse fails: nothing is posted`: `useClient` rejects → `{ step: 'reuse', route: 'none' }`, no `post`.
  - `route refused: nothing else is tried`: `postRoute` rejects → `{ step: 'route', route: 'none' }`.
  - In `keycloak-client.test.ts`: `tokenEndpoint('http://kc/realms/apis/.well-known/openid-configuration') === 'http://kc/realms/apis/protocol/openid-connect/token'`.

- [ ] **Step 2: Run, expect FAIL** — `pnpm exec vitest run src/components/page/quick-route-keycloak.test.ts src/utils/keycloak-client.test.ts`.

- [ ] **Step 3: Implement** `saveWithKeycloak` and `tokenEndpoint` as specified. Cleanup errors are swallowed into the failure record, never thrown over the original cause. No `console` output of credentials.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat(route): save a quick route with its Keycloak client, or leave nothing`.

---

### Task 3: The page — section, wiring, one-time secret dialog

**Files:**
- Create: `src/components/form-slice/FormPartRoute/QuickKeycloakSection.tsx` (the choice's fields)
- Create: `src/components/page/ClientSecretDialog.tsx`
- Create: `src/components/form-slice/FormPartRoute/quick-keycloak.ts` (pure helpers) + `quick-keycloak.test.ts`
- Modify: `src/components/page/QuickRouteForm.tsx` (choice in the SegmentedControl, save branch, dialog)
- Modify: locales (via `add-i18n-key`)

**Interfaces:**
- Consumes: Task 1 types, Task 2 `saveWithKeycloak` / `KeycloakSaveError` / `tokenEndpoint`, `oidcClientApi` (`linked`, `list`, `create`, `use`, `remove`), `proposeClientIdSuffix`, `postRouteReq`, `req`.
- Produces (pure, in `quick-keycloak.ts`):
  ```ts
  export const keycloakChoiceAvailable = (a: {
    duplicating: boolean; serviceHasAuth: boolean; creators: LinkedIdp[]; reusable: OidcClientItem[];
  }) => boolean;                       // reusable = token-mode clients only
  export const initialKeycloakChoice = (creators: LinkedIdp[], suffix: string): KeycloakChoice;
  export const keycloakChoiceAfterInstanceChange = (): KeycloakChoice | null; // always null: start over
  export const failureMessageKey = (f: KeycloakSaveFailure): string; // a key under form.quickRoute.keycloak.failed.*
  ```

- [ ] **Step 1: Write the failing tests** for the helpers:
  - `keycloakChoiceAvailable`: false when duplicating; false when the service sets an authentication; false with no creator and no token client; true with a creator; true with only a reusable token client; false with only a `login` client.
  - `initialKeycloakChoice`: with creators → `{ kind: 'create', idpId: creators[0].id, suffix, validation: 'jwks' }`; with none → `{ kind: 'reuse', uuid: '' }`.
  - `failureMessageKey`: `client`+`deleted` → `...failed.clientRouteDeleted`; `attach`+`deleted`+`client: 'left'` → `...failed.attachClientLeft`; `attach`+`deleted`+`client: 'deleted'` → `...failed.attachRouteDeleted`; `kept-disabled` → `...failed.routeKeptDisabled`; `reuse` → `...failed.reuse`; `route` → the page's existing `routes.createFailed`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the helpers; run, expect PASS.**
- [ ] **Step 4: Wire the page.**
  - Queries `['idps','linked',instanceId]` and `['oidc-clients',instanceId]` (same keys as `KeycloakClientPicker`, so the cache is shared); `creators` filtered by `isAdmin || developers_can_create`.
  - SegmentedControl gains `{ value: 'openid-connect', label: t('form.quickRoute.accessKeycloak') }` only when `keycloakChoiceAvailable(...)`; a service with an authentication switches an active Keycloak choice back to `anyone`.
  - `QuickKeycloakSection`: Create / Reuse radio (Create hidden without creators); Create shows connection select (hidden when one), client id suffix with the connection's prefix as left section, validation JWKS / Introspection; Reuse shows a select of token clients by `client_id`; an advanced-form link for browser login (`form.quickRoute.keycloak.loginHint`). Errors from `answerErrors(...).access`.
  - Instance change: the existing `formInstance` reset also sets the Keycloak choice to `keycloakChoiceAfterInstanceChange()` and the access to `anyone`.
  - Save: when `access.plugin === 'openid-connect'`, call `saveWithKeycloak` with deps built from `req` (post returns `res.data.value.id`; `req.patch(\`${API_ROUTES}/${id}\`, body)`; `req.delete(...)`) and `oidcClientApi`. **Do not set `leavingRef.current = true`** for this branch: leaving asks, as before a create. Invalidate `['oidc-clients', instanceId]` after any outcome.
  - Success with `created: true` → `ClientSecretDialog` (client id, secret, `tokenEndpoint(credentials.discovery)`, each with a `CopyButton`; text says it is shown once and readable again only in Keycloak). Closing calls `onCreated()` and clears the credentials from state. `created: false` → `onCreated()` directly, with the usual success notification.
  - Failure → `setSubmitError(t(failureMessageKey(f), { name, clientId }))` plus the backend reason (`describeError`) on a second line; for `kept-disabled`, a link to the route's detail page.
  - i18n keys (five languages): `form.quickRoute.accessKeycloak`, `form.quickRoute.keycloak.{create,reuse,connection,clientId,validation,jwks,introspection,client,loginHint,secretTitle,secretOnce,tokenEndpoint,clientSecret}`, `form.quickRoute.keycloak.failed.{clientRouteDeleted,attachRouteDeleted,attachClientLeft,routeKeptDisabled,reuse}`.
- [ ] **Step 5: Verify** — `pnpm exec tsc -b`, `pnpm exec vitest run src/config/locale-keys.test.ts src/components`, `pnpm exec eslint --no-cache --max-warnings=0` on every touched file. All pass.
- [ ] **Step 6: Commit** — `feat(route): offer a Keycloak token on the quick route page`.

---

### Task 4: End to end

**Files:**
- Create: `e2e/tests/routes.quick-keycloak.spec.ts` (reuse `e2e/utils/keycloak.ts`: `e2eConnection`, `createIdp`, `updateIdp`, `clientCredentialsToken`, `cleanUpKeycloak`, `listOidcClients`; `KEYCLOAK_FROM_GATEWAY` from `e2e/utils/stack.ts`; route pattern of `routes.keycloak-client.spec.ts`)

**Interfaces:**
- Consumes: the page from Task 3 (labels via i18n, as the other specs).

- [ ] **Step 1: Write the specs** (prefix every name for cleanup):
  - `a quick route with a new Keycloak client takes only its client's tokens`: connection with `gateway_base_url: KEYCLOAK_FROM_GATEWAY`; quick page, path `/e2e-qk/*` to the Keycloak upstream as in the existing spec; choose Keycloak token, create; the dialog shows client id and secret; through the gateway: 401 without token, 200 with `clientCredentialsToken(id, secret)`, 403 with another client's token. The route's stored plugin has `bearer_only` and `use_jwks`.
  - `reuses a client made earlier`: second quick route, Reuse, pick the first client; no dialog; the route holds the same `client_id`.
  - `a client that cannot be made leaves no route`: suffix equal to an existing client's id (409) → error shown, the route list has no route with that name, and `listOidcClients` has no new entry.
- [ ] **Step 2: Run** — `pnpm e2e e2e/tests/routes.quick-keycloak.spec.ts` against the worktree stack (`worktree-stack` skill; Keycloak service of the e2e compose up). Expected: 3 passed. Then `pnpm e2e e2e/tests/routes.quick-create.spec.ts e2e/tests/routes.keycloak-client.spec.ts` — no regression.
- [ ] **Step 3: Commit** — `test(route): cover the quick route's Keycloak token end to end`.

---

### Task 5: Docs

- [ ] Update `CLAUDE.md` (quick route offers Keycloak token; the save chain and its rollback) and the spec's status to "implemented". Commit `docs(route): note the quick route's Keycloak token`.

# Keycloak Client Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dashboard create, reuse and clean up Keycloak OIDC clients for routes, from the route's `openid-connect` form and from Settings.

**Architecture:** The Go backend stores Keycloak connections (with a service-account secret that never leaves it) and a registry of the clients it created, both in etcd; it calls Keycloak's Admin REST API on demand. The React app gets two new Settings tabs and a client picker in the `openid-connect` section of the route form.

**Tech Stack:** Go 1.22+/Gin, etcd v3, React 19 + Mantine + TanStack Query, Playwright, Keycloak 26 in the e2e compose.

**Spec:** `docs/superpowers/specs/2026-11-22-keycloak-client-provisioning-design.md`

## Global Constraints

- Work only in the worktree `~/working/mad-docs-keycloak-clients`, branch `feat/keycloak-client-provisioning`. Never in the shared checkout.
- Keycloak only; `type` is the constant `keycloak`.
- The service-account secret (`admin_client_secret`) never appears in an API response, an error message or a log line.
- The dashboard reads, deletes or returns secrets only for clients present in its registry, whose `client_id` starts with the prefix stored on the entry.
- Clients are always `publicClient: false`, `implicitFlowEnabled: false`, `directAccessGrantsEnabled: false`.
- A created client's secret is never stored; it is returned by the create call and read again from Keycloak by the "use" call.
- A client's team is never stored: it is the current owner of `routes/<entry.route_id>` (`OwnershipService.GetOwner`).
- Conventional Commits with this repo's scopes (`api`, `common`, `route`, `test`…), body explaining why; no `Co-Authored-By`.
- ASF header on every new `.go`, `.ts`, `.tsx` file; i18n keys in all five locales through the `add-i18n-key` skill; `pnpm lint --no-cache` clean.
- No `log.Printf` of tokens, secrets or Keycloak response bodies.

## Review Focus

1. **Keycloak unreachable or slow** - every Keycloak call is bounded (10 s); create/use answer 502 with a short reason, the OIDC clients tab shows status `unknown` instead of failing the whole list. Tests: Task 2 `TestKeycloakTimeout`, Task 6 `TestClientStatusUnknownWhenKeycloakFails`.
2. **A developer naming another team's route, or a route of no team, in the create body** - 403. Test: Task 4 `TestMayCreateClient` rows.
3. **A Keycloak error body echoing credentials** - errors carry status and Keycloak's `error`/`errorMessage` field only, never the body nor the secret. Test: Task 2 `TestKeycloakErrorsNeverCarrySecrets`.
4. **A route whose host or URI cannot give a redirect URI** (several hosts, wildcard host, exact path without `*`, regex) - the proposal is empty and the operator must type one, rather than a wrong value. Test: Task 8 `proposeRedirectUri` cases.
5. **A cached admin token that expired, or was revoked, between two calls** - refreshed before expiry, and a 401 from an admin call refetches once. Test: Task 2 `TestKeycloakRefetchesTokenOn401`.

---

### Task 0: Branch and models

**Files:**
- Modify: `api/internal/models/models.go`
- Test: `api/internal/models/idp_test.go`

**Interfaces:**
- Produces:
  ```go
  const IdPTypeKeycloak = "keycloak"
  const KeyPrefixIdPs = "/idps/"
  const KeyPrefixIdPClients = "/idp_clients/"
  type IdentityProvider struct {
      ID, Name, Type, BaseURL, Realm string            // json: id,name,type,base_url,realm
      AdminClientID, AdminClientSecret string           // json: admin_client_id, admin_client_secret
      ClientIDPrefix string                             // json: client_id_prefix
      InstanceIDs []string                              // json: instance_ids
      DevelopersCanCreate bool                          // json: developers_can_create
      CreatedAt, UpdatedAt NullTime
  }
  type IdPClientOptions struct {
      PKCE bool `json:"pkce"`
      Validation string `json:"validation"` // "introspection" | "jwks", token mode only
      ClientCredentials bool `json:"client_credentials"`
  }
  type IdPClient struct {
      IdPID, InstanceID, Realm, Prefix string   // json: idp_id, instance_id, realm, prefix
      ClientID, KeycloakUUID, RouteID string    // json: client_id, keycloak_uuid, route_id
      Mode string                               // "login" | "token"
      Options IdPClientOptions
      RedirectURI, CreatedBy string             // json: redirect_uri, created_by
      CreatedAt NullTime
  }
  func (p IdentityProvider) LinkedTo(instanceID string) bool
  func IdPClientKey(idpID, uuid string) string // KeyPrefixIdPClients + idpID + "/" + uuid
  ```

- [ ] **Step 1:** Write `TestIdentityProviderLinkedTo` (linked id → true, other id → false, empty list → false) and `TestIdPClientKey` (`IdPClientKey("kc1","u-1") == "/idp_clients/kc1/u-1"`).
- [ ] **Step 2:** `go test -C api ./internal/models -run 'IdentityProvider|IdPClientKey'` → FAIL (undefined).
- [ ] **Step 3:** Add the types, constants and two functions to `models.go`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(api): add identity provider and created-client models`.

### Task 1: Connection store (`IdPService`)

**Files:**
- Create: `api/internal/services/idp.go`, `api/internal/services/idp_test.go`

**Interfaces:**
- Consumes: Task 0 models.
- Produces:
  ```go
  type kvStore interface {
      GetJSON(ctx context.Context, key string, dest interface{}) error
      PutJSON(ctx context.Context, key string, value interface{}) error
      Delete(ctx context.Context, key string) error
      List(ctx context.Context, prefix string) (map[string][]byte, error)
  }
  var ErrIdPNotFound, ErrIdPInvalid, ErrIdPLocked, ErrIdPHasClients error
  type IdPUpdate struct {
      Name, BaseURL, Realm, AdminClientID, AdminClientSecret, ClientIDPrefix *string
      InstanceIDs *[]string
      DevelopersCanCreate *bool
  }
  func NewIdPService(store kvStore) *IdPService
  func (s *IdPService) Create(ctx context.Context, p *models.IdentityProvider) error // sets ID (uuid), Type default keycloak, timestamps
  func (s *IdPService) Get(ctx context.Context, id string) (*models.IdentityProvider, error)
  func (s *IdPService) List(ctx context.Context) ([]*models.IdentityProvider, error)
  func (s *IdPService) ForInstance(ctx context.Context, instanceID string) ([]*models.IdentityProvider, error)
  func (s *IdPService) Update(ctx context.Context, id string, u IdPUpdate) (*models.IdentityProvider, error)
  func (s *IdPService) Delete(ctx context.Context, id string, force bool) error
  func (s *IdPService) RecordClient(ctx context.Context, c *models.IdPClient) error
  func (s *IdPService) ListClients(ctx context.Context, instanceID string) ([]*models.IdPClient, error) // "" = all
  func (s *IdPService) FindClient(ctx context.Context, instanceID, uuid string) (*models.IdPClient, error) // ErrIdPNotFound
  func (s *IdPService) DeleteClient(ctx context.Context, c *models.IdPClient) error
  func validateIdP(p *models.IdentityProvider) error
  ```
  `*EtcdClient` already satisfies `kvStore`; check what its `GetJSON` returns for a missing key and map it to `ErrIdPNotFound`.

Rules from the spec: `validateIdP` requires `type == keycloak`, an absolute `http(s)` `base_url` not ending in `/realms...`, a non-empty realm, admin client id and secret, and a prefix matching `^[a-z0-9][a-z0-9-]{0,31}$`. `Update` with a nil or empty `AdminClientSecret` keeps the stored one. Once `ListClients` has entries for the connection, changing `BaseURL`, `Realm` or `ClientIDPrefix`, or dropping from `InstanceIDs` an instance that has entries, returns `ErrIdPLocked` with the count in the message (`"%d clients depend on it"`). `Delete` with entries and `force == false` returns `ErrIdPHasClients`; with `force`, deletes the connection and its registry entries (not the Keycloak clients).

- [ ] **Step 1:** Write tests with an in-memory `fakeKV` (map) in `idp_test.go`: `TestValidateIdP` (table: valid; type `lemonldap` refused; `base_url` `sso.example.com` refused; `https://sso/realms/x` refused; empty realm; prefix `Apisix_` refused; prefix empty refused), `TestUpdateKeepsSecretWhenOmitted`, `TestUpdateLockedOnceClientsExist` (realm change → `ErrIdPLocked`, name change → ok, dropping a linked instance with entries → locked, dropping one without → ok), `TestDeleteRefusedWithClientsUnlessForced`, `TestForInstance`, `TestFindClient`.
- [ ] **Step 2:** `go test -C api ./internal/services -run 'IdP|FindClient'` → FAIL.
- [ ] **Step 3:** Implement `idp.go`.
- [ ] **Step 4:** Same command → PASS; `gofmt -l api` empty.
- [ ] **Step 5:** Commit `feat(api): store keycloak connections and the clients created through them`.

### Task 2: Keycloak Admin REST client

**Files:**
- Create: `api/internal/services/keycloak.go`, `api/internal/services/keycloak_test.go`

**Interfaces:**
- Produces:
  ```go
  var ErrKeycloakAuth, ErrKeycloakForbidden, ErrKeycloakClientExists, ErrKeycloakClientMissing, ErrKeycloakUnavailable error
  type ClientRepresentation struct {
      ID string `json:"id,omitempty"`; ClientID string `json:"clientId"`; Protocol string `json:"protocol"`
      PublicClient, StandardFlowEnabled, ImplicitFlowEnabled, DirectAccessGrantsEnabled, ServiceAccountsEnabled bool // json camelCase as Keycloak
      RedirectURIs []string `json:"redirectUris"`
      Attributes map[string]string `json:"attributes,omitempty"`
  }
  func BuildClientRepresentation(clientID, mode string, o models.IdPClientOptions, redirectURI string) ClientRepresentation
  type KeycloakAPI interface {
      TestAccess(ctx context.Context) error
      CreateClient(ctx context.Context, rep ClientRepresentation) (uuid string, err error)
      ClientSecret(ctx context.Context, uuid string) (string, error)
      GetClient(ctx context.Context, uuid string) (*ClientRepresentation, error)
      DeleteClient(ctx context.Context, uuid string) error // 404 → nil
  }
  func NewKeycloakClient(p *models.IdentityProvider, httpClient *http.Client) KeycloakAPI
  func DiscoveryURL(p *models.IdentityProvider) string     // {base}/realms/{realm}/.well-known/openid-configuration
  func IntrospectionURL(p *models.IdentityProvider) string // {base}/realms/{realm}/protocol/openid-connect/token/introspect
  ```

`BuildClientRepresentation`: `protocol: openid-connect`, flags per the spec's flow table - login: `standardFlowEnabled: true`, `redirectUris: [redirectURI]`, `attributes["pkce.code.challenge.method"]="S256"` when `PKCE`; token: `standardFlowEnabled: false`, no redirect URIs, `serviceAccountsEnabled = ClientCredentials`. Endpoints and status mapping are in the spec ("Calling Keycloak"). Token: `client_credentials` grant, cached until 30 s before `expires_in`; an admin call answered 401 refetches the token once and retries. Each request carries a 10 s context timeout. Errors: build from status plus Keycloak's `error` / `errorMessage` JSON field only.

- [ ] **Step 1:** Write tests against `httptest.Server`: `TestBuildClientRepresentation` (login+PKCE, login without PKCE, token+client credentials, token without; assert the three always-false flags), `TestCreateClientReturnsUUIDFromLocation`, `TestCreateClient409IsClientExists`, `TestGetClient404IsMissing`, `TestDeleteClient404IsNil`, `TestKeycloakCachesToken` (two calls, one token request), `TestKeycloakRefetchesTokenOn401`, `TestTestAccessForbidden` (token ok, clients list 403 → `ErrKeycloakForbidden`), `TestKeycloakTimeout` (server sleeps beyond a shortened timeout → `ErrKeycloakUnavailable`; make the timeout a package var for the test), `TestKeycloakErrorsNeverCarrySecrets` (server answers 400 with a body containing the admin secret → `err.Error()` does not contain it).
- [ ] **Step 2:** `go test -C api ./internal/services -run 'Keycloak|ClientRepresentation|CreateClient|GetClient|DeleteClient|TestAccess'` → FAIL.
- [ ] **Step 3:** Implement `keycloak.go`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(api): call keycloak's admin api to create, read and delete clients`.

### Task 3: Connection endpoints (super admin) and linked listing

**Files:**
- Create: `api/internal/handlers/idp.go`, `api/internal/handlers/idp_test.go`
- Modify: `api/cmd/main.go` (construct `IdPService` with `etcdClient`, `IdPHandler`; register routes)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  ```go
  type IdPHandler struct {
      idps *services.IdPService
      ownership *services.OwnershipService
      instances *services.InstanceService
      keycloak func(*models.IdentityProvider) services.KeycloakAPI // NewKeycloakClient in main, a fake in tests
  }
  func NewIdPHandler(...) *IdPHandler
  type idpResponse struct { /* every IdentityProvider field but the secret */ HasSecret bool `json:"has_secret"` }
  func publicIdP(p *models.IdentityProvider) idpResponse
  type linkedIdP struct { ID, Name, Discovery string; DevelopersCanCreate bool } // json snake_case
  func requirePathInstance(c *gin.Context) (string, bool) // :id must equal the X-Instance-ID the RBAC middleware resolved; else 400
  ```
  Routes: in the `admin` group (each handler refuses non-`super_admin` with 403 like `instance.go`): `GET/POST /idps`, `GET/PUT/DELETE /idps/:id` (`?force=true`), `POST /idps/:id/test`. Under `protected` with `rbac`: `GET /instances/:id/idps` (admins and developers of the instance; viewer 403) returning `[]linkedIdP`.
  Error mapping: `ErrIdPInvalid` 400, `ErrIdPNotFound` 404, `ErrIdPLocked`/`ErrIdPHasClients` 409 with the message, test endpoint → `{ok:false, reason:"auth"|"forbidden"|"unavailable"}` 200.

- [ ] **Step 1:** Tests: `TestPublicIdPNeverCarriesSecret` (marshal the response of a provider with secret `s3cr3t`; JSON does not contain it, `has_secret` true), `TestIdPEndpointsRefuseNonSuperAdmin` (gin test context with role `instance_admin` on each admin handler → 403), `TestLinkedIdPsRefuseViewer`, `TestRequirePathInstanceMismatch` (path `i1`, header `i2` → 400).
- [ ] **Step 2:** `go test -C api ./internal/handlers -run 'IdP|LinkedIdP|RequirePathInstance'` → FAIL.
- [ ] **Step 3:** Implement and wire in `main.go`.
- [ ] **Step 4:** Same command → PASS; `go build -C api ./cmd`.
- [ ] **Step 5:** Commit `feat(api): manage keycloak connections from the api`.

### Task 4: Create a client for a route

**Files:**
- Create: `api/internal/handlers/idp_clients.go`, `api/internal/handlers/idp_clients_test.go`
- Modify: `api/cmd/main.go`

**Interfaces:**
- Consumes: Tasks 1-3; `callerTeamScope`, `teamScope.mayWrite` (`caller_scope.go`); `OwnershipService.GetOwner`; `newAdminRequest` + `proxyClient` (as `route_test_handler.go` `readRoute`) to check the route exists.
- Produces:
  ```go
  type createClientRequest struct {
      RouteID, ClientID, Mode, RedirectURI string // json route_id, client_id (suffix), mode, redirect_uri
      Options models.IdPClientOptions `json:"options"`
  }
  type clientCredentials struct { // the response of create and use
      ClientID, ClientSecret, Discovery, IntrospectionEndpoint string // json snake_case; introspection only in token+introspection
      Mode string; Options models.IdPClientOptions; RedirectURI string
  }
  func mayCreateClient(scope teamScope, p *models.IdentityProvider, routeOwner string) bool
  func validClientIDSuffix(s string) bool // ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
  func validateCreateRequest(r createClientRequest) error // mode login|token; login needs an absolute http(s) `redirect_uri`; token needs validation introspection|jwks; PKCE only in login
  func (h *IdPHandler) CreateClient(c *gin.Context) // POST /idps/:id/clients, protected + rbac
  ```
  Order (spec "Creating a client"): connection exists and `LinkedTo(instance)` (else 404); request valid (400); route exists (404); owner = `GetOwner(instance,"routes",route_id)`; `mayCreateClient` (403); `CreateClient` in Keycloak with `prefix+suffix` (409 → 409 "this client ID already exists in Keycloak, choose another"; unavailable → 502); `ClientSecret`; `RecordClient` - on failure `DeleteClient` in Keycloak and answer 500; answer 201 `clientCredentials`. `CreatedBy` = `middleware.GetUserID`.

- [ ] **Step 1:** Tests: `TestMayCreateClient` table - admin any owner incl. "" → true; developer, setting off → false; developer, setting on, owner in writable → true; developer, owner another team → false; developer, owner "" → false; viewer (no writable) → false. `TestValidClientIDSuffix` (`billing`, `bill.v2_x-1` ok; `""`, `-x`, `a/b`, 65 chars refused). `TestValidateCreateRequest` table. `TestCreateClientRollsBackWhenRecordFails` (fake `KeycloakAPI` recording calls + a `kvStore` whose `PutJSON` fails → `DeleteClient` called with the new uuid, 500). `TestCreateClientConflict` (fake returns `ErrKeycloakClientExists` → 409).
- [ ] **Step 2:** `go test -C api ./internal/handlers -run 'MayCreateClient|ClientIDSuffix|CreateRequest|CreateClient'` → FAIL.
- [ ] **Step 3:** Implement; register `protected.POST("/idps/:id/clients", rbac, idpHandler.CreateClient)`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(api): create a keycloak client for a route`.

### Task 5: Reuse a created client

**Files:**
- Modify: `api/internal/handlers/idp_clients.go`, `idp_clients_test.go`, `api/cmd/main.go`

**Interfaces:**
- Produces:
  ```go
  type clientListItem struct { UUID, ClientID, IdPID, IdPName, RouteID, TeamID, Mode string; Status string `json:"status,omitempty"`; Routes []string `json:"routes,omitempty"` }
  func mayUseClient(scope teamScope, team string) bool // admin → true; else scope.mayWrite(team)
  func (h *IdPHandler) ListClients(c *gin.Context) // GET /instances/:id/oidc-clients[?status=1]
  func (h *IdPHandler) UseClient(c *gin.Context)   // POST /instances/:id/oidc-clients/:uuid/use
  ```
  The team of each entry is read live (`GetOwner(instance,"routes",entry.RouteID)`). Without `status`, admins get all entries, developers those `mayUseClient` allows, viewers 403. `UseClient`: `FindClient` (404), `mayUseClient` (403), connection still exists (404), `ClientSecret` from Keycloak (`ErrKeycloakClientMissing` → 410 "the client no longer exists in Keycloak"), answer `clientCredentials`. `?status=1` is Task 6's.

- [ ] **Step 1:** Tests: `TestMayUseClient` table (admin/""; developer own team; developer other team; developer ""), `TestUseClientMissingInKeycloakIs410` (fake `ClientSecret` → `ErrKeycloakClientMissing`).
- [ ] **Step 2:** `go test -C api ./internal/handlers -run 'MayUseClient|UseClient'` → FAIL.
- [ ] **Step 3:** Implement; register both with `rbac`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(api): reuse a keycloak client the dashboard created`.

### Task 6: Statuses and delete

**Files:**
- Modify: `api/internal/handlers/idp_clients.go`, `idp_clients_test.go`, `api/cmd/main.go`

**Interfaces:**
- Produces:
  ```go
  const statusOK, statusNoRoute, statusMissing, statusChanged, statusUnknown = "ok", "no_route", "missing", "changed", "unknown"
  func routesUsingClients(routes []map[string]any) map[string][]string // client_id → route ids, read from value.plugins["openid-connect"].client_id
  func clientStatus(e *models.IdPClient, kc *services.ClientRepresentation, kcErr error, usedBy []string) string
  func (h *IdPHandler) DeleteClient(c *gin.Context) // DELETE /instances/:id/oidc-clients/:uuid
  ```
  `clientStatus` precedence: `kcErr == ErrKeycloakClientMissing` → missing; other `kcErr` → unknown; `len(usedBy)==0` → no_route; representation differs from `BuildClientRepresentation(e.ClientID, e.Mode, e.Options, e.RedirectURI)` on redirect URIs (as sets) or the five flags → changed; else ok. `?status=1` (admins of the instance only, 403 otherwise) lists all routes of the instance once through the Admin API (`GET /routes`, same request helper), calls `GetClient` per entry, fills `Status` and `Routes`. `DeleteClient`: admins only; `FindClient`; Keycloak `DeleteClient` (404 tolerated); registry delete; 204.

- [ ] **Step 1:** Tests: `TestRoutesUsingClients` (two routes share `apisix-a`, one route without the plugin, one with a different client), `TestClientStatus` table (missing; unknown on a timeout error; no_route; changed when Keycloak enabled `directAccessGrantsEnabled`; changed when redirect URIs differ; ok), `TestClientStatusUnknownWhenKeycloakFails`, `TestDeleteClientRefusesDeveloper`.
- [ ] **Step 2:** `go test -C api ./internal/handlers -run 'RoutesUsingClients|ClientStatus|DeleteClient'` → FAIL.
- [ ] **Step 3:** Implement; register.
- [ ] **Step 4:** PASS; full `go test -C api ./...`.
- [ ] **Step 5:** Commit `feat(api): show which created clients no route uses, and delete them`.

### Task 7: Settings - access and Identity providers tab

**Files:**
- Create: `src/apis/idps.ts`, `src/components/page-slice/settings/PasswordPolicyTab.tsx` (the current page body, moved), `src/components/page-slice/settings/IdentityProvidersTab.tsx`
- Modify: `src/routes/settings/index.tsx` (Mantine `Tabs`, each tab rendered only for its role), `src/hooks/usePermission.ts` (`/settings` out of `SUPER_ADMIN_ONLY`; reachable by `isAdmin`), `src/config/navRoutes.ts` if its gating needs it, locales
- Test: `src/hooks/usePermission.test.ts`, `src/apis/idps.test.ts`

**Interfaces:**
- Produces (`src/apis/idps.ts`, all through `apiClient`):
  ```ts
  export type IdentityProvider = { id: string; name: string; type: 'keycloak'; base_url: string; realm: string; admin_client_id: string; has_secret: boolean; client_id_prefix: string; instance_ids: string[]; developers_can_create: boolean };
  export type IdentityProviderInput = Omit<IdentityProvider, 'id' | 'type' | 'has_secret'> & { admin_client_secret?: string };
  export type LinkedIdp = { id: string; name: string; discovery: string; developers_can_create: boolean };
  export type OidcClientOptions = { pkce: boolean; validation?: 'introspection' | 'jwks'; client_credentials: boolean };
  export type ClientCredentials = { client_id: string; client_secret: string; discovery: string; introspection_endpoint?: string; mode: 'login' | 'token'; options: OidcClientOptions; redirect_uri?: string };
  export type OidcClientItem = { uuid: string; client_id: string; idp_id: string; idp_name: string; route_id: string; team_id: string; mode: 'login' | 'token'; status?: 'ok' | 'no_route' | 'missing' | 'changed' | 'unknown'; routes?: string[] };
  export const idpApi: { list(); get(id); create(input); update(id, input); remove(id, force?: boolean); test(id): Promise<{ ok: boolean; reason?: string }> };
  export const oidcClientApi: { linked(instanceId); list(instanceId, withStatus?: boolean); create(idpId, body); use(instanceId, uuid): Promise<ClientCredentials>; remove(instanceId, uuid) };
  ```
  `update` omits `admin_client_secret` when the field is left empty.

- [ ] **Step 1:** Tests: in `usePermission.test.ts`, `canAccessRoute('/settings')` true for super_admin and instance_admin, false for developer and viewer; in `idps.test.ts`, `update` without a secret sends no `admin_client_secret` key (mock `apiClient.put`).
- [ ] **Step 2:** `pnpm vitest run src/hooks/usePermission.test.ts src/apis/idps.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Tab "Identity providers" (super admin): table name / URL+realm / instances, Add/Edit modal per the spec (secret field write-only, placeholder "unchanged" when `has_secret`), Test connection showing the reason, Delete (409 shows the message and offers force). Keys via `add-i18n-key`.
- [ ] **Step 4:** Same command → PASS; `pnpm lint --no-cache`; `npx tsc -b`.
- [ ] **Step 5:** Commit `feat(common): declare keycloak connections in settings`.

### Task 8: Client picker in the openid-connect form

**Files:**
- Create: `src/utils/keycloak-client.ts`, `src/utils/keycloak-client.test.ts`, `src/components/form-slice/FormItemPlugins/KeycloakClientPicker.tsx`
- Modify: `OidcSection.tsx` (render the picker when a `route` prop is given), `PluginEditorDrawer.tsx` and `FormItemPlugins/index.tsx` (thread an optional `route` prop), `src/components/form-slice/FormPartRoute/index.tsx` (pass `route` from the form values: `id`, `name`, `host`/`hosts`, `uri`/`uris`), locales

**Interfaces:**
- Consumes: Task 7 `oidcClientApi`, `LinkedIdp`, `ClientCredentials`; `OidcMode`, `oidcMode` (`src/utils/oidc.ts`).
- Produces:
  ```ts
  export type OidcRouteContext = { id?: string; name?: string; hosts: string[]; uris: string[] };
  export const proposeRedirectUri = (hosts: string[], uris: string[]): string;
  export const proposeClientIdSuffix = (route: OidcRouteContext): string; // name or id, lowercased, outside [a-z0-9._-] → '-', trimmed to 64
  export const applyClientCredentials = (config: Record<string, unknown>, c: ClientCredentials): Record<string, unknown>;
  ```
  `proposeRedirectUri`: exactly one host, not starting with `*`; exactly one URI ending in `/*`; → `https://<host><uri without the *>.apisix/redirect`; otherwise `''`. `applyClientCredentials` sets `discovery`, `client_id`, `client_secret`; login: `redirect_uri`, `use_pkce` = options.pkce, removes `bearer_only`; token: `bearer_only: true`, and `introspection_endpoint` or `use_jwks: true` per validation.
  Picker (spec "Route form"): choice Create / Use a created client / Enter by hand; create disabled with a hint when `route.id` is empty; provider select from `oidcClientApi.linked`; mode options per the flow table with defaults PKCE on, validation introspection, client credentials off; on success `onChange(applyClientCredentials(config, result))` and the choice returns to "Enter by hand" showing the filled fields. Hidden entirely when `linked` returns nothing the caller may use.

- [ ] **Step 1:** Tests in `keycloak-client.test.ts`: `proposeRedirectUri(['api.example.com'], ['/billing/*'])` → `'https://api.example.com/billing/.apisix/redirect'`; two hosts → `''`; `['*.example.com']` → `''`; `['/billing']` (no `*`) → `''`; no host → `''`. `proposeClientIdSuffix({name:'Billing API', hosts:[], uris:[]})` → `'billing-api'`. `applyClientCredentials` login with PKCE (sets `use_pkce: true`, `redirect_uri`, removes `bearer_only`), token+jwks (`bearer_only: true`, `use_jwks: true`, no `introspection_endpoint`), token+introspection.
- [ ] **Step 2:** `pnpm vitest run src/utils/keycloak-client.test.ts` → FAIL.
- [ ] **Step 3:** Implement utils and picker.
- [ ] **Step 4:** PASS; lint; tsc.
- [ ] **Step 5:** Commit `feat(route): create or reuse a keycloak client from the openid-connect form`.

### Task 9: OIDC clients tab

**Files:**
- Create: `src/components/page-slice/settings/OidcClientsTab.tsx`
- Modify: `src/routes/settings/index.tsx`, locales

**Interfaces:**
- Consumes: Task 7 `oidcClientApi.list(instanceId, true)`, `remove`; `currentInstanceIdAtom`; `useTeamNames` (`src/hooks/useTeamColumn.tsx`).
- Produces: a tab for admins of the current instance: columns client id, provider, routes, team (name), status badge (ok green, no_route orange, missing red, changed yellow, unknown gray); Delete in every state, with a confirm that names the routes when `routes` is non-empty.

- [ ] **Step 1:** No unit-testable logic beyond rendering; its tests are Task 10's e2e. Implement.
- [ ] **Step 2:** `pnpm lint --no-cache`; `npx tsc -b` → clean.
- [ ] **Step 3:** Commit `feat(common): list and clean up created oidc clients in settings`.

### Task 10: Keycloak in the e2e stack, specs, docs

**Files:**
- Modify: `e2e/server/docker-compose.yml` (service `keycloak`: `quay.io/keycloak/keycloak:26.0.7`, `start-dev --import-realm`, port `${E2E_KEYCLOAK_PORT:-8180}:8080`, volume of the realm file), `e2e/utils/stack.ts` (`E2E_KEYCLOAK_PORT: 8180`, `keycloak: at('E2E_KEYCLOAK_URL','E2E_KEYCLOAK_PORT')`), the compose-ports test, `.github/workflows/e2e.yml` (wait for `http://127.0.0.1:${E2E_KEYCLOAK_PORT:-8180}/realms/apis` 200, up to 120 s), `CLAUDE.md` (keyspace: `/idps/<id>`, `/idp_clients/<idp>/<uuid>`; port list; Settings no longer super-admin only)
- Create: `e2e/server/keycloak/realm-apis.json` (realm `apis`; confidential client `apisix-dashboard`, secret `e2e-dashboard-secret`, service account with `realm-management` `manage-clients`), `e2e/pom/settings.ts`, `e2e/tests/settings.identity-providers.spec.ts`, `e2e/tests/routes.keycloak-client.spec.ts`

Spec cases (spec "Testing"): add a connection and Test connection OK; secret write-only (edit shows no secret, saving without retyping keeps it - test still OK); create a client in login mode from a saved route, fields filled, route saved, client exists in Keycloak (read via backend list); create in token mode with JWKS; reuse it on a second route; developer with the setting off sees no Create, with it on creates for their team's route; instance admin opens Settings and sees only "OIDC clients"; delete the second route's plugin then the first route → status "No route"; delete in Keycloak directly (admin REST with the e2e service account) → "Missing in Keycloak". Clean up: connections and clients created, through the API, in `afterAll`.

- [ ] **Step 1:** Compose, realm, stack, workflow; `docker compose -f e2e/server/docker-compose.yml up -d keycloak` and `curl -sf http://127.0.0.1:8180/realms/apis` → 200.
- [ ] **Step 2:** Write the specs; run them against the worktree stack (`worktree-stack` skill) → green; run `ssls.list`, `routes.*plugin*` specs touched by the form change → green.
- [ ] **Step 3:** `pnpm vitest run e2e/utils/compose-ports.test.ts` → PASS.
- [ ] **Step 4:** Commit `test(common): run keycloak in the e2e stack and cover client provisioning` and `docs: describe keycloak connections and created clients`.

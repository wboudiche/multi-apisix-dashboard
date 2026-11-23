# Keycloak client provisioning from the dashboard - design

## Intent

Protecting a route with OIDC today means leaving the dashboard: an operator
opens Keycloak's console, creates a client in the right realm, sets its flows
and redirect URI, copies the client id and secret, comes back and pastes them
into the `openid-connect` plugin form. The product owner wants the dashboard to
create that client itself, from the route, and fill the plugin with it.

Keycloak only in this first version. LemonLDAP::NG was considered and set
aside: its Manager API is disabled by default, has no authentication of its own
and no per-client scoping, and is rarely reachable in production. Keycloak's
Admin REST API covers everything needed.

## Goals

- A super admin declares one or more Keycloak connections in **Settings**, and
  links each to the instances that may use it.
- From the `openid-connect` form of a route, an operator allowed to do so
  creates a Keycloak client in one action; the form is filled with discovery,
  `client_id` and `client_secret`, and the operator saves the route as usual.
- The client created matches the route's mode: browser login or token
  validation, with the flow options below.
- A client the dashboard created can be reused on another route from the same
  form, without creating a new one.
- The dashboard keeps a record of every client it created, owned by the team of
  the route, and shows the instance's admins which of them no route uses any
  more, and which have disappeared or changed in Keycloak.

## Non-goals (this version)

- LemonLDAP::NG, or any IdP other than Keycloak.
- Dynamic client registration (RFC 7591).
- `authz-keycloak`, Keycloak Authorization Services, roles, client scopes and
  mappers.
- Deleting a client when its route is deleted (cascade), automatic secret
  rotation, or correcting drift in Keycloak.
- Changing who can read plugin secrets through the proxy (see Open risk).

## Anti-goals

- The Keycloak service-account secret reaching the browser, a log line, or any
  API response.
- The dashboard modifying or deleting a Keycloak client it did not create.
- Enabling a flow in Keycloak that APISIX does not use (implicit, password /
  direct access grants, device).
- A developer reaching another team's clients.

## Decisions taken with the product owner

1. **Where the connection lives:** Settings, a new **Identity providers** tab
   beside the existing password policy (`src/routes/settings/index.tsx`, already
   super-admin only via `SUPER_ADMIN_ONLY` in `src/hooks/usePermission.ts`). A
   list, so several Keycloaks (prod, staging) can be declared.
2. **Who creates clients:** admins of the instance always; developers only when
   the connection's **Developers can create clients** setting is on (off by
   default). A developer creates for a route of a team they can write to, and
   sees only their teams' clients.
3. **Flows:** both route modes the form already has (`src/utils/oidc.ts`,
   `OidcMode = 'login' | 'token'`):

   | Route mode | Choice offered | Keycloak client | Plugin config |
   |---|---|---|---|
   | Browser login | Authorization Code (fixed) | confidential, `standardFlowEnabled: true` | `bearer_only` absent |
   | | PKCE yes/no, yes by default | attribute `pkce.code.challenge.method: S256` | `use_pkce: true` |
   | Token validation | Validation by introspection, or locally by signature (JWKS) | confidential, `standardFlowEnabled: false` | `bearer_only: true`, and `introspection_endpoint` or `use_jwks: true` |
   | | Client Credentials yes/no, no by default | `serviceAccountsEnabled` | - |

   Always: `implicitFlowEnabled: false`, `directAccessGrantsEnabled: false`,
   `publicClient: false`. `use_pkce`, `use_jwks`, `bearer_only` and
   `introspection_endpoint` are in the plugin schema of APISIX 3.16 (checked on
   the e2e gateway).

   The route's `discovery` and `introspection_endpoint` use the connection's
   optional **gateway address** (`gateway_base_url`) when set, for gateways
   that reach Keycloak at another address than the backend does; the
   backend's own calls stay on `base_url`. Keycloak must give the same issuer
   at both. Changing it does not rewrite saved routes; one address per
   instance is #460.
4. **Route deleted:** the client is not deleted in Keycloak. It shows in a
   "clients without a route" list, with an explicit delete.
5. **Approach:** the backend creates the client on demand (below).
6. **Reuse:** the route form also lists the clients the dashboard created, so
   one client can serve several routes. An instance admin sees all of the
   instance's; a developer those of their teams.
7. **Where created clients are managed:** a second Settings tab, **OIDC
   clients**, open to the instance's admins as well as the super admin. Settings
   stops being a super-admin-only page; each tab checks its own role (the
   password policy and the connections stay super-admin only). No new menu
   entry.

## Approaches considered

1. **Backend creates on demand (chosen).** The connection, with its service
   account secret, is stored by the backend; a "Create client" button in the
   route form calls a backend endpoint that checks the caller, creates the
   client in Keycloak, records it and returns id and secret. Follows the
   pattern of APISIX admin keys, allows developer self-service, and lets the
   backend check drift. Costs a powerful credential held by the dashboard, and
   a client left without a route when the form is abandoned - covered by the
   "without a route" list.
2. **Browser calls Keycloak with the operator's own Keycloak login.** No stored
   credential, but every operator needs Keycloak admin rights (no developer
   self-service), Keycloak's CORS must admit the dashboard, and there is no
   reliable registry. Contradicts decision 2.
3. **Created when the route is saved, by the proxy.** No abandoned clients, but
   puts Keycloak logic and a two-system rollback into the APISIX proxy, the most
   sensitive code of the backend, for a problem the registry already covers.

## Design

### Identity provider connection (backend)

A new record under `/apisix-dashboard/idps/<id>`, modelled on `Instance`
(`api/internal/models/models.go`):

| Field | Notes |
|---|---|
| `id`, `name` | |
| `type` | `keycloak` only for now; kept so another type is a new value, not a migration |
| `base_url` | e.g. `https://sso.example.com`, without `/realms` |
| `realm` | where clients are created |
| `admin_client_id`, `admin_client_secret` | the service account; the secret is never returned, as `AdminKey` is emptied in `api/internal/handlers/instance.go` |
| `client_id_prefix` | every client created starts with it, e.g. `apisix-`; required, non-empty |
| `instance_ids` | the instances that may use it |
| `developers_can_create` | default false |
| `redirect_domains` | up to 20 lowercase DNS names (no scheme, port, wildcard or leading dot); bounds the redirect address of a developer's login client; empty by default; changing it needs no secret and is not locked by existing clients |
| `created_at`, `updated_at` | |

Endpoints, under the existing super-admin group of `api/cmd/main.go`:
`GET/POST /api/v1/idps`, `GET/PUT/DELETE /api/v1/idps/:id`,
`POST /api/v1/idps/:id/test`. An update that omits the secret keeps the stored
one, as for instances. The test obtains a token by `client_credentials` and
checks the account can list clients of the realm, reporting which of the two
failed.

A read-only listing for non-super-admins, `GET /api/v1/instances/:id/idps`,
returns the connections linked to the instance with what the route form needs
(`id`, `name`, `discovery` URL, `developers_can_create`), never credentials.

Deleting a connection that still has clients in the registry is refused unless
forced, like an instance with dependencies.

*Builder-check call:* once a connection has clients in the registry, changing
its `base_url`, `realm` or `client_id_prefix`, or unlinking an instance that has
clients, is refused with a message naming how many clients depend on it. The
secret, name, other instances and the developer setting stay editable. Without
this, existing entries would point at the wrong realm or fall outside the
prefix and could no longer be managed.

Deleting an instance drops the registry entries of its clients and unlinks it
from every connection (`IdPService.ForgetInstance`): neither could be undone
by hand once the instance is gone. The Keycloak clients stay in Keycloak, and
their client ids are logged for the operator to remove there.

### Calling Keycloak

A small client in `api/internal/services` (`keycloak.go`):

- Token: `POST {base_url}/realms/{realm}/protocol/openid-connect/token`,
  `grant_type=client_credentials`, cached until shortly before expiry.
- Create: `POST {base_url}/admin/realms/{realm}/clients` with the
  representation from the flow table; 201 gives the internal id in `Location`;
  409 means the client id is taken.
- Secret: `GET .../clients/{uuid}/client-secret`.
- Read for drift: `GET .../clients/{uuid}`; 404 means gone.
- Delete: `DELETE .../clients/{uuid}`.

One client per connection is kept (rebuilt when the connection's `updated_at`
changes), so its token serves every request; concurrent callers share one
token fetch, none waits past its own deadline, and a failed fetch is answered
for 5 s without asking again. The status list's Keycloak reads share one 30 s
deadline, and a connection found unreachable is not asked again in that list;
rows not reached read "unknown".

Created clients keep Keycloak's default `fullScopeAllowed: true` (R6): their
tokens carry the user's realm roles, as a client made by hand in the console
would. Narrowing roles and scopes is left to the roles/scopes follow-up.

The service account needs the `manage-clients` role of `realm-management` in
that realm (documented in the Settings tab's help text). Recommended to the
operator: a realm dedicated to the gateway's APIs.

Outbound calls have a timeout and go only to the connection's `base_url`;
errors from Keycloak are passed on as a short reason, never with tokens or
secrets. No token or secret in logs, including the backend's debug logs.

### Registry of created clients

`/apisix-dashboard/idp_clients/<idp_id>/<keycloak_uuid>`:

| Field | Notes |
|---|---|
| `client_id`, `keycloak_uuid` | |
| `idp_id`, `instance_id`, `realm`, `prefix` | realm and prefix copied from the connection at creation |
| `route_id` | the route it was created for |
| `route_create_time` | the route's APISIX `create_time` when the client was created (security-review call, R9) |
| `mode`, `options` | login/token, PKCE, validation, client credentials |
| `redirect_uri` | login mode only |
| `created_by`, `created_at` | |

The dashboard only ever deletes or reads clients present in this registry, and
only those whose `client_id` starts with the prefix stored on the entry.

*Builder-check call:* the team is not stored. It is read live from the route's
ownership record whenever it is needed, so a client follows its route when an
admin reassigns the route, and a route with no team gives a client only admins
see. An admin may create a client for a route with no team; a developer cannot
reach such a route anyway.

*Builder-check call:* a route may have several entries (a client created again
after a lost secret, or replaced later). Each is judged on its own.

### Creating a client (endpoint)

`POST /api/v1/idps/:id/clients`, with `X-Instance-ID` and `X-Team-ID` as other
calls, body: `route_id`, `client_id` (without prefix; the backend adds it),
`mode`, options, `redirect_uri` for login.

Checks, in order: the connection is linked to the instance; the caller is an
admin of the instance, or a developer and `developers_can_create` is on; the
route exists and the caller may write it (its owning team is one they write
to, the same rule as the proxy, `api/internal/handlers/caller_scope.go`); the
client id is valid (Keycloak's charset, length) and prefixed.

In login mode the redirect URI is an absolute http(s) URL without wildcard,
fragment or credentials, and, when the route (or its service) has hosts, its
host is one of them, case ignored. A route host `*.x.y` accepts a redirect
host with exactly one more label (`a.x.y`; not `x.y`, not `a.b.x.y`), as APISIX
matches it.

*Security-review call (R8):* a developer writes the hosts of their own routes, so
binding a developer's login client to the route's hosts alone binds it to data
the developer controls. In login mode a developer's redirect host must also
equal one of the connection's `redirect_domains` or be a subdomain of one
(`evilexample.com` is not a subdomain of `example.com`). A domain's last label cannot be all digits, and a developer's redirect host
must be ASCII (punycode) and not an IP address. With no domain set,
developers cannot create login clients on that connection (403); admins and
token mode are unaffected.

*Builder-check call:* a 409 from Keycloak (the client id is taken) is refused
with "this client ID already exists in Keycloak, choose another". The dashboard
never adopts or overwrites an existing client, its own included; an operator who
lost a secret deletes the old entry from the registry list and creates again.

Then: create in Keycloak, read the secret, write the registry record, return
`client_id`, `client_secret`, `discovery`
(`{base_url}/realms/{realm}/.well-known/openid-configuration`) and, in token
mode with introspection, `introspection_endpoint`. If the registry write fails
after Keycloak created the client, the backend deletes the client it just
created and reports the failure.

The secret is returned once, in that response; the registry does not store it.

### Reusing a client (endpoints)

`GET /api/v1/instances/:id/oidc-clients` lists the registry entries of the
instance the caller may use: all of them for an admin of the instance, those
whose team (read live, see the registry) is one the caller writes to for a
developer, none for a viewer. Each entry has `client_id`, the connection's name
and the route it was created for; the list used by the route form does not
compute statuses.

`POST /api/v1/instances/:id/oidc-clients/:uuid/use` returns what the plugin
needs - `discovery`, `client_id`, `client_secret` read from Keycloak at that
moment, and `introspection_endpoint` for a token-mode client - under the same
rule. The secret is read again each time rather than stored.

*Security-review call (R9):* a route deleted and re-created under the same id
must not inherit the old route's client. For a non-admin, `use` and the list
require the live route to exist with the same `create_time` as the entry's
`route_create_time` (an entry without one counts as different); otherwise the
answer is the same oracle-free 403 and the entry stays admin-only. Admins are
not subject to it, and a client still follows its route when an admin reassigns
the route, since the create time does not change.
APISIX keeps a `create_time` sent in a request body, so the dashboard's proxy
strips `create_time` and `update_time` from every write to `routes` (the
collection and one route): the value is not caller-writable, APISIX sets it on
a create and keeps the previous one on an update. For a developer, the list and
`use` answer 502 when the gateway cannot be read. The same proxy checks a route
write body is exactly one JSON object (400 otherwise) and forwards the object it
checked, not the raw bytes. A successful delete of a route also sets
`route_create_time` to 0 on the entries made for it (they keep their `route_id`
and become admin-only), so a route re-created under the same id within the same
second inherits nothing.

### Route form

In the `openid-connect` section (`src/components/form-slice/FormItemPlugins/OidcSection.tsx`),
when the instance has at least one connection the caller may use:

```
openid-connect
  Client   (•) Create in Keycloak
           ( ) Use a client created by the dashboard   → [apisix-billing - KC prod - route billing ▾]
           ( ) Enter an existing client
  Provider [Keycloak prod ▾]
  Mode     (•) Browser login   ( ) Token validation      ← the existing mode choice
  PKCE     [x]                                            (login)
  Validate (•) Introspection   ( ) Signature (JWKS)      (token)
  Client credentials [ ]                                  (token)
  Client ID     apisix-[billing            ]   proposed from the route name
  Redirect URI  [https://api.example.com/billing/.apisix/redirect]   (login, to confirm)
                                              [Create client]
  ✓ Client apisix-billing created - discovery, client ID and secret filled in
```

- The proposed redirect URI follows the plugin's own default (it appends
  `.apisix/redirect` to the request URI when none is set) on the route's host
  if it has a single one; the operator confirms or edits it. The form's
  existing `redirectUriProblem` check still applies.
- The button is disabled until the route has been saved once (a route id is
  needed for ownership); on a new route the form says to save first.
- After creation the fields are filled and the choice switches to "Enter an
  existing client" showing them, so the operator saves the route normally.

### Settings tabs

```
Settings
 [ Password policy ]  [ Identity providers ]  [ OIDC clients ]
   super admin          super admin              super admin + the instance's admins

 Identity providers                                         [+ Add]
 ┌──────────────┬────────────────────────────────┬────────┬─────────────────┐
 │ Name         │ URL / Realm                    │ Status │ Instances       │
 └──────────────┴────────────────────────────────┴────────┴─────────────────┘

 OIDC clients - Prod                       (the instance selected in the header)
 ┌──────────────────┬──────────┬────────────┬───────┬──────────────┬──────────┐
 │ Client ID        │ Provider │ Routes     │ Team  │ Status       │          │
 ├──────────────────┼──────────┼────────────┼───────┼──────────────┼──────────┤
 │ apisix-billing   │ KC prod  │ billing, … │ Paie. │ ● OK         │          │
 │ apisix-old-shop  │ KC prod  │ -          │ -     │ ● No route   │ [Delete] │
 └──────────────────┴──────────┴────────────┴───────┴──────────────┴──────────┘
```

`/settings` leaves `SUPER_ADMIN_ONLY` (`src/hooks/usePermission.ts`) and is
reachable by an admin of the current instance; the page shows only the tabs
the caller's role allows, and the backend checks each endpoint as before.

**Identity providers** - add/edit form: name, base URL, realm, admin client id
and secret (write-only), client id prefix, instances, "Developers can create
clients", and "Test connection".

**OIDC clients** - the registry entries of the instance selected in the header,
with `GET /api/v1/instances/:id/oidc-clients?status=1` (admins of the instance
only; statuses computed when the tab is opened, not in the background) and
`DELETE /api/v1/instances/:id/oidc-clients/:uuid` (deletes in Keycloak, then
the entry). Columns: client id, connection, the routes that use it, team,
status:

- **OK**;
- **No route** - no route of the instance names this `client_id` in its
  `openid-connect` config any more (read through the instance's Admin API).
  Every route is checked, not only the one it was created for, since a reused
  client may serve several. This is also what catches a client created and then
  never saved into a route;
- **Missing in Keycloak**;
- **Changed in Keycloak** - redirect URIs or enabled flows differ from the
  registry.

Delete is offered in every state; a client still used by a route asks for a
confirmation naming those routes.

### Permissions summary

| Action | super_admin | instance_admin | developer | viewer |
|---|---|---|---|---|
| Manage connections (Settings, Identity providers) | yes | no | no | no |
| List connections linked to an instance | yes | yes | yes | no |
| Create a client | yes | yes | if enabled, own teams' routes | no |
| Reuse a client in the route form | yes | the instance's | their teams' | no |
| See statuses / delete (Settings, OIDC clients) | yes | the instance's | no | no |

## Open risk, outside this scope

The proxy returns plugin configurations unmasked: a viewer of a route's team
reads its `client_secret`. This is already true of a secret pasted by hand;
provisioning makes it more frequent. Tracked separately.

## Testing

- Go unit tests: Keycloak client against an `httptest` server (token caching,
  201/409/404 handling, secret never in errors); permission checks of the
  create, reuse and delete endpoints for each role; rollback when the registry
  write fails; secret never returned by connection endpoints; status computed
  across every route of the instance.
- e2e: a Keycloak container in `e2e/server/docker-compose.yml` with a realm
  imported at start and a service account; specs for the Settings tab (add,
  test, secret write-only), creating a client in each mode from a route,
  reusing it on a second route, the developer setting on and off, an instance
  admin reaching only the OIDC clients tab, and the "No route" / "Missing in
  Keycloak" states.

## Left to the builder

- Exact Keycloak client id charset and length check.
- Token cache structure; HTTP timeouts.
- Help-text wording, translations in the five languages.
- How the Keycloak image and realm are provisioned in the e2e stack.

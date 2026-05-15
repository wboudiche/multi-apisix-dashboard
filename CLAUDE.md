# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Multi-Tenant APISIX Dashboard** — a fork of `apache/apisix-dashboard` that adds a Go backend in front of APISIX's Admin API to provide user accounts, JWT auth, multiple APISIX instances, teams, per-instance roles, and resource ownership.

Two moving parts in this repo:

- **`api/`** — Gin-based Go backend. Persists users/teams/instances/roles/labels/ownership in etcd under the `/apisix-dashboard` prefix. Proxies `/api/v1/apisix/admin/*` to whichever APISIX instance the request targets, attaching that instance's admin key server-side.
- **`src/`** — React SPA (TanStack Router + Mantine + Ant Design Pro). The browser never sees an APISIX admin key — only JWTs from the Go backend.

Package manager is **pnpm@10.10.0** (pinned). Node 22, Go 1.22+ (toolchain auto-fetches 1.24 declared in `api/go.mod`).

## Commands

### Frontend

```sh
pnpm dev          # vite dev server :5173 (proxies /apisix/admin/* and /api/* to :8086)
pnpm build        # tsc -b && vite build
pnpm lint         # eslint --max-warnings=0
pnpm lint:fix     # eslint --fix
pnpm e2e          # playwright test
```

Single E2E spec: `pnpm e2e e2e/tests/multi-instance.spec.ts` (`--headed`, `--debug`, `--ui` as needed).

### Backend

```sh
go build -C api -o ../bin/api ./cmd
go test  -C api ./...
go test  -C api ./internal/services -run Label
```

Run the backend:

```sh
PORT=8086 ETCD_ENDPOINTS=http://localhost:2379 ADMIN_PASSWORD=admin ./bin/api
```

**Note:** the default `PORT` in `api/internal/config/config.go` is `8080`, but `vite.config.ts` proxies to `:8086`. Always export `PORT=8086` when running the backend for local dev — there's a config drift here worth fixing one day.

### Stack bring-up

```sh
docker compose -f e2e/server/docker-compose.yml up -d   # APISIX :9180 + etcd
go build -C api -o ../bin/api ./cmd                     # build backend
PORT=8086 ETCD_ENDPOINTS=http://localhost:2379 ./bin/api &
pnpm install --frozen-lockfile && pnpm dev              # frontend :5173
```

Open <http://localhost:5173/ui>, log in with `admin / admin`.

The dev stack uses the host's etcd via `apisix-docker-etcd-1` (or whichever container publishes `:2379`). APISIX's own etcd (`server-etcd-1`) is **not** exposed on the host and is only reachable from inside the `server_apisix` docker network.

## Architecture

### Request flow

```
Browser ──/api/v1/login (POST)──▶ Go backend (:8086) ──▶ etcd /apisix-dashboard/users/
            │                                                 │ bcrypt verify
            │ ◀── { access_token, refresh_token, expires_in } ┘ + jwt.sign(HS256, JWT_SECRET)
            │
            │ Authorization: Bearer <jwt>
            │ X-Instance-ID: <inst-id>
            │ X-Team-ID:     <team-id>
            ▼
       Vite proxy ──/apisix/admin/*──▶ Go backend ProxyHandler
                                            │  AuthMW   → reject 401 if bad/expired JWT
                                            │  RBACMW   → reject 403 if user has no role on instance
                                            │           → reject 403 if viewer + non-GET
                                            ▼
                                        Instance lookup → X-API-KEY injection → APISIX:9180
```

The browser **never** has the APISIX admin key. It's stored in etcd alongside the `Instance` record and attached by the backend at proxy time.

### The Go backend (`api/`)

```
api/
├── cmd/main.go                          ← Gin server wiring
└── internal/
    ├── config/         ← env-driven config (PORT, ETCD_*, JWT_SECRET, ADMIN_PASSWORD)
    ├── models/         ← Instance, User, Team, UserInstance, Role, Ownership, Label, Scope
    ├── services/       ← business logic + etcd persistence
    │   ├── etcd.go     ← thin etcd client (GetJSON / PutJSON / List / Delete)
    │   ├── auth.go     ← login, JWT generate/validate, user CRUD, per-instance role
    │   ├── team.go
    │   ├── instance.go
    │   ├── ownership.go ← per-resource team ownership on each instance
    │   ├── label.go    ← label key/value catalog (+ _test.go)
    │   └── overview.go ← cross-instance aggregation
    ├── handlers/       ← HTTP layer (one per resource + proxy.go for APISIX passthrough)
    ├── middleware/
    │   ├── auth.go     ← Bearer JWT validation, sets userID/username/role on context
    │   ├── rbac.go     ← per-instance role check; viewer is GET-only
    │   └── label_validation.go ← validates label keys/values against the catalog
    └── utils/auth.go   ← bcrypt + JWT helpers
```

**etcd keyspace owned by the backend** (all under `/apisix-dashboard/`):

```
/users/<userID>
/teams/<teamID>
/instances/<instanceID>
/user_instances/<userID>/<instanceID>   ← role + team + scope for that pair
/ownership/<instanceID>/<resourceType>/<resourceID>
/labels/<key>
/roles/<name>
/config/admin_initialized
```

The backend does **not** read or write APISIX's own `/apisix/` prefix in etcd. APISIX's data lives separately, accessed only through its Admin API.

**Role model** (`models/models.go`):

| Role | Permissions |
|---|---|
| `super_admin` | `*` — global, never narrowed by instance assignments |
| `instance_admin` | all `<resource>:*` on the assigned instance |
| `developer` | routes/services/upstreams/consumers/consumer_groups/stream_routes on the instance |
| `viewer` | `<resource>:read` only |

The effective role is **per (user, instance)**, not global. The same user can be admin on staging and viewer on prod.

**JWT** — HS256, signed with `JWT_SECRET`. Access tokens expire in 15 min; refresh tokens in 7 days. The backend has no token revocation list — logout is client-side only. Rotating `JWT_SECRET` invalidates all live tokens.

### The frontend (`src/`)

New top-level pages on top of upstream:

```
src/routes/
├── login/index.tsx       ← username/password form, POSTs /api/v1/login
├── overview/index.tsx    ← gateway health, global resource matrix, instance connectivity
├── instances/index.tsx   ← CRUD APISIX instances (Admin URL + admin key registered here)
├── teams/index.tsx       ← CRUD teams
└── users/index.tsx       ← CRUD users, per-instance role + team assignments
```

All other resource pages (routes, services, upstreams, consumers, ssls, …) come from upstream but are edited to support labels, team-ownership chips, and viewer-role write-gating.

**Two axios clients coexist** — be careful which one you reach for:

- **`src/apis/client.ts`** (`apiClient`) — JWT-authenticated. Injects `Authorization: Bearer <jwt>`, `X-Instance-ID`, `X-Team-ID`. Response interceptor auto-refreshes once on 401, otherwise redirects to `/ui/login`. **Use this for `/api/*` calls to the Go backend** (users, teams, instances, overview, etc.).
- **`src/config/req.ts`** (`req`) — kept from upstream. Prefixes `/apisix/admin`, serializes the `filter` qs quirk, normalizes empty-list `{}` → `[]`. **Use this for APISIX Admin API resource calls** (routes, services, upstreams, etc.). It does NOT inject the admin key anymore — that happens in the Go backend's proxy layer.

**Auth state** (`src/stores/auth.ts`):

- jotai atoms `accessTokenAtom` / `refreshTokenAtom` / `tokenExpiryAtom` / `currentUserAtom` that wrap localStorage so writes also trigger React re-renders.
- `isAuthenticatedAtom` is derived: true iff access token present and not expired.
- `logoutActionAtom` clears tokens + user; the router then redirects to `/ui/login`.

**Instance + team state** (`src/stores/instance.ts`, `src/stores/team.ts`):

- `currentInstanceIdAtom` persists to `localStorage` key `instance:current_id`.
- `currentTeamIdAtom` persists to `team:current_id:<instanceID>` — team selection is scoped to the active instance.
- Both are read by the request interceptor in `apiClient` to populate `X-Instance-ID` / `X-Team-ID`.

**Permission gating** (`src/hooks/usePermission.ts`):

- Derived atom returns `{ role, isViewer, isAdmin, isSuperAdmin, canCreate, canEdit, canDelete, canAccessRoute(path) }`.
- `super_admin` shortcircuits (never narrowed by instance assignments).
- Otherwise: look up the user's `UserInstance` record for `currentInstanceIdAtom`, fall back to `user.role`.
- Use this hook anywhere you'd otherwise check the user's role manually — it has the per-instance logic, the nav-gating logic (`SUPER_ADMIN_ONLY` paths like `/users`, `/instances`, `/teams`), and the developer-resource allowlist baked in.

### Data fetching

TanStack Query is still the data layer. Route `loader`s call `queryClient.ensureQueryData(...QueryOptions(deps))`. The `src/apis/` directory has one file per resource (upstream pattern preserved) plus new files: `auth.ts`, `client.ts`, `instances.ts`, `teams.ts`, `labels.ts`, `apisix.ts`, `route-test.ts`. `src/apis/hooks.ts` is still the registry combining `genDetailQueryOptions` + `genListQueryOptions` + `genUseList`.

### Schemas & types

Zod schemas in `src/types/schema/apisix/` remain the source of truth for APISIX resource shapes. Form payload schemas derive via `.omit(...).extend(...)`. For multi-tenant types (User, Team, Instance, Role), see the matching `src/apis/*.ts` files — those are hand-typed TS interfaces that mirror `api/internal/models/models.go`.

### UI composition

- **Mantine** for the app shell, modals, notifications, and most multi-tenant pages.
- **Ant Design Pro** (`@ant-design/pro-components`) for the data tables on resource list pages. Wrap antd subtrees in `<AntdConfigProvider>` (`src/config/antdConfigProvider.tsx`).
- **React 19** — the antd v5 patch (`@ant-design/v5-patch-for-react-19`) is imported globally in `main.tsx`.
- Forms use `react-hook-form` against Zod schemas. Resource-specific bodies in `src/components/form-slice/FormPart<Resource>/`. New: `FormWizard` for multi-step flows, `RouteTestDrawer`, `ImportRoutesModal` (OpenAPI), `LabelFilter`, `BatchDeleteBtn`.
- **State**: jotai for global, MobX with `mobx-react-observer` (SWC plugin in `vite.config.ts`) for reactive form/UI state, TanStack Query for server state. No Redux.

### i18n

Languages: `en` (source of truth), `de`, `es`, `tr`, `zh`. Files under `src/locales/<lang>/common.json`.

ESLint enforces no-literal-string, no-unknown-key (keys must exist in `en/common.json`), no-text-as-children/attribute. **Don't hardcode user-visible strings.** A custom Vite plugin (`vite-plugin-i18n-progress.ts`) reports translation coverage during dev/build.

### E2E (Playwright)

Specs in `e2e/tests/*.spec.ts`. POM pattern: each resource has `e2e/pom/<resource>.ts` with `locator` / `assert` / `goto` helpers. Worker-scoped auth fixture in `e2e/utils/test.ts` logs in once per worker.

Multi-tenant tests of note: `multi-instance.spec.ts`, `route-test.spec.ts`, `routes.reassign-team.spec.ts`, `routes.request-override.spec.ts`, `routes.proxy-e2e.spec.ts`. Some need a second APISIX (see `e2e/server/apisix_conf_2.yml`) or the Go backend running on `:8086`.

Default target is `http://localhost:9180/ui/` (upstream behavior, still respected for the auth bootstrap fixture); override via `E2E_TARGET_URL`.

## Conventions enforced by tooling

- **ASF license header** required on every `.ts`/`.tsx` and source file in `src/` and `e2e/` (`headers/header-format` ESLint rule). Go files have a similar comment-block header. `pnpm lint:fix` inserts the JS/TS one. **Do not remove these — they're required by Apache 2.0 §4(b) since the project is a derivative.**
- **Single quotes** only in JS/TS (no template literals as substitutes).
- **Imports**: `simple-import-sort` orders them; `unused-imports` removes dead ones. Path aliases: `@/*` → `src/*`; in E2E, `@e2e/*` → `e2e/*` and `@/*` → `src/*`.
- **Strict TS** with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` — use `import type` for type-only imports.
- **React rules**: `react/jsx-curly-brace-presence` forbids `{'string'}`; `react/self-closing-comp` enforced.
- `pnpm lint --max-warnings=0` — warnings fail the build. `lint-staged` runs `pnpm lint:fix` on staged JS/TS via husky.

## Commit messages

Conventional Commits, extended for this fork's scope:

```
<type>(<scope>): <summary>
```

- type ∈ `build | ci | docs | feat | fix | perf | refactor | test`
- scope ∈ upstream (`route | upstream | consumer | ssl | plugin | common`) **or** multi-tenant (`auth | user | team | instance | role | label | overview | api`)
- summary: imperative, lowercase, no trailing period, ≤100 chars/line

Body required for everything except `docs:` and must explain *why*. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full spec including breaking-change footers.

## Things to watch for when working in this code

- **Debug logging in the backend is loud and unconditional** (`auth.go`, `rbac.go` log JWT secret prefixes, token prefixes, every validation and RBAC decision via `log.Printf("[DEBUG ...")`). Gate behind a log level before deploying to anything non-local.
- **`UserID` quoting fallbacks in `middleware/rbac.go`** (three successive lookups with different quote-stripping/wrapping). This is a workaround for inconsistent etcd keys written by earlier bugs. Do a migration pass, then remove.
- **`JWT_SECRET` is required and validated at startup** — the backend `log.Fatal`s if it is empty, equal to the legacy default `your-secret-key-change-in-production`, or shorter than 32 bytes. The quickstart recipe generates one with `openssl rand -hex 32`.
- **`X-Team-ID` is client-controlled** for admins; for non-admins the proxy ignores the header and forces the team to `UserInstance.TeamID`. The "admin" status is sourced from `UserInstance.Role`, not the JWT global role — only `super_admin` is honored from the JWT.
- **Resource-type RBAC** is enforced in `handlers/proxy.go` via `models.HasResourcePermission(effRole, resourceType, "read"|"write")`. A `developer` is limited to the resource types in `models.RolePermissions[RoleDeveloper]` (routes/services/upstreams/consumers/consumer_groups/stream_routes); they cannot write to `ssls`, `global_rules`, `plugin_configs`, `secrets`, etc. Keep the role-table in `models.go` aligned with APISIX path segments (plural where APISIX is plural).
- **Two axios instances**: `req` for APISIX resource calls, `apiClient` for `/api/v1/*` calls to the Go backend. Mixing them up means the wrong headers (or no JWT) on a request — easy to do, hard to spot.

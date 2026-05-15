---
title: Development
---

# Development

This document describes how to bring up the **Multi-Tenant APISIX Dashboard** locally.

The stack has three moving parts:

1. **APISIX + etcd** — one or more APISIX gateways, each backed by etcd. Brought up with Docker.
2. **Go backend (`api/`)** — Gin server on `:8086` that holds users/teams/instances/roles/labels in etcd under the `/apisix-dashboard` prefix, and proxies Admin API requests to the right APISIX instance with the per-instance admin key.
3. **React frontend (`src/`)** — Vite dev server on `:5173`, proxies `/apisix/admin/*` and `/api/*` to the Go backend.

## Prerequisites

- **Docker / Docker Compose** — for APISIX + etcd.
- **Node 22 + pnpm 10** — frontend toolchain. `pnpm` is pinned via the `packageManager` field in `package.json`.
- **Go 1.22+** — Go's auto-toolchain will fetch 1.24 (declared in `api/go.mod`) on first build.

## 1. Start APISIX and etcd

```sh
docker compose -f e2e/server/docker-compose.yml up -d
```

This brings up:

- `server-apisix-1` — APISIX on `:9180` (Admin API), `:9080` (HTTP), `:9100` (TCP stream), `:9200` (UDP stream).
- `server-apisix2-1` — second APISIX on `:9181` (used by the seeded "Staging APISIX" instance and multi-instance E2E tests).
- `server-etcd-1` — etcd, exposed on host `:2379` so the Go backend running locally can reach it.

The admin key for APISIX is in [`e2e/server/apisix_conf.yml`](../../e2e/server/apisix_conf.yml) under `deployment.admin.admin_key`. You don't paste it into the browser anymore — you register it once when adding the instance through the UI, and it's stored server-side in the Go backend's etcd.

### Multi-instance testing

The compose stack already provides two APISIX instances (`:9180` and `:9181`) so you can exercise the multi-instance UI and tests without extra setup. Register both via `/ui/instances` once you're logged in.

## 2. Build and run the Go backend

```sh
mkdir -p bin
go build -C api -o ../bin/api ./cmd

PORT=8086 \
HOST=127.0.0.1 \
ETCD_ENDPOINTS=http://localhost:2379 \
JWT_SECRET="$(openssl rand -hex 32)" \
ADMIN_PASSWORD=admin \
./bin/api
```

Environment variables read by the backend (see `api/internal/config/config.go`):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | **The frontend proxy expects `8086`** — set it explicitly. |
| `HOST` | `0.0.0.0` | |
| `ETCD_ENDPOINTS` | `http://localhost:2379` | Comma-separated for HA. |
| `ETCD_USERNAME` / `ETCD_PASSWORD` | unset | Optional. |
| `JWT_SECRET` | _required, ≥ 32 bytes_ | The backend refuses to start when this is empty or set to the legacy default `your-secret-key-change-in-production`. Generate one with `openssl rand -hex 32`. |
| `ADMIN_PASSWORD` | `admin` | Used only on first boot to seed the bootstrap `admin` user. |

On first boot, the backend creates a default `admin` user (super_admin) with the password from `ADMIN_PASSWORD`. Change it from the UI immediately.

The etcd keyspace the backend owns:

```
/apisix-dashboard/users/<id>
/apisix-dashboard/teams/<id>
/apisix-dashboard/instances/<id>
/apisix-dashboard/user_instances/<userID>/<instanceID>
/apisix-dashboard/ownership/<instanceID>/<resourceType>/<resourceID>
/apisix-dashboard/labels/<key>
/apisix-dashboard/roles/<name>
/apisix-dashboard/config/admin_initialized
```

It does **not** touch APISIX's own `/apisix/` prefix.

## 3. Start the frontend

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:5173/ui>. The Vite dev server proxies:

- `/apisix/admin/*` → `http://127.0.0.1:8086/api/v1/apisix/admin/*`
- `/api/*` → `http://127.0.0.1:8086/api/*`

Log in with `admin / admin`. The browser stores JWTs in localStorage under `auth:access_token` / `auth:refresh_token`; the access token expires in 15 minutes and is refreshed automatically by the axios interceptor in `src/apis/client.ts`.

### Switching instance/team

The header has an instance selector and a team selector. The current selection is written to localStorage as `instance:current_id` and `team:current_id:<instanceID>`, and sent as `X-Instance-ID` / `X-Team-ID` on every request. Permissions (`src/hooks/usePermission.ts`) are computed **per (user, instance)** — the same user can have different roles on different instances.

## Common commands

```sh
pnpm dev          # vite dev server :5173
pnpm build        # tsc -b && vite build
pnpm lint         # eslint --max-warnings=0 (zero-warning policy)
pnpm lint:fix     # eslint --fix
pnpm e2e          # playwright test (requires the docker stack up)
```

Run a single E2E spec: `pnpm e2e e2e/tests/multi-instance.spec.ts` (add `--headed`, `--debug`, or `--ui` as needed).

### Go backend

```sh
go test -C api ./...                         # all backend tests
go test -C api ./internal/services -run Label  # one package
go build -C api -o ../bin/api ./cmd          # build
```

## VS Code Dev Containers

`.devcontainer/` provides a dev container that bundles APISIX + etcd alongside Node and pnpm. Open the project, accept "Reopen in Container", and run `pnpm dev`. The dev container does **not** currently include Go — if you're working on the backend, build/run it on the host.

## Troubleshooting

**Backend won't start, "failed to connect to etcd"** — etcd isn't reachable from where the backend is running. From the host, `curl http://localhost:2379/version` should return JSON. If port `2379` is in use by another stack, stop that container or change `ETCD_ENDPOINTS` for the backend.

**Frontend hits 401 in a loop** — the access token is missing/invalid and the refresh token is also rejected. The interceptor will redirect to `/ui/login`. Check that the Go backend is up on `:8086` and that `JWT_SECRET` hasn't changed since the token was issued (changing the secret invalidates all tokens).

**Dashboard shows "Access denied for this instance"** — the logged-in user has no `UserInstance` record for the currently-selected instance. As a super_admin, go to `/ui/users` and assign the user a role on that instance.

**`pnpm dev` says "vite: not found"** — you skipped `pnpm install`.

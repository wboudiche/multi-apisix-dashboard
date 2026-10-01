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
- **Go 1.22+** — Go's auto-toolchain fetches the version `api/go.mod` declares on first build. A Go set to `GOTOOLCHAIN=local` (some distribution packages) does not, and has to be that version itself.

## Docker in this repo

| Path | What it is | Used by |
|---|---|---|
| `Dockerfile` (+ `.dockerignore`) | The official image: Go backend + built UI, published to GHCR on `vX.Y.Z` tags by `.github/workflows/docker.yml`. | `deploy/`, anyone running the dashboard as a container |
| `deploy/` | A copyable compose that runs that image with etcd and two APISIX gateways. | People deploying or trying the dashboard |
| `e2e/server/` | The test stack: two stock APISIX gateways sharing one `apisix_conf.yml` (the second gets its etcd prefix from `APISIX_ETCD_PREFIX`) plus etcd. No image is built. | `pnpm e2e`, CI, the dev container |
| `.devcontainer/` | The VS Code dev container; it `include`s the e2e stack. | VS Code users |

Nothing in the e2e stack serves the dashboard: `:9180` and `:9181` are Admin APIs, the UI you test is the vite dev server on `:5173` (or the official image).

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
| `UI_DIR` | unset | Directory of the built frontend to serve under `/ui`. Unset in dev (vite serves it); the docker image sets `/app/ui`. |
| `ETCD_ENDPOINTS` | `http://localhost:2379` | Comma-separated for HA (each entry trimmed). |
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

To run the whole dashboard as one container instead, see the root `Dockerfile` and [`deploy/`](../../deploy/README.md).

Log in with `admin / admin`. The browser stores JWTs in localStorage under `auth:access_token` / `auth:refresh_token`; the access token expires in 15 minutes and is refreshed automatically by the axios interceptor in `src/apis/client.ts`.

### Switching instance/team

The header has an instance selector and a team selector. The current selection is written to localStorage as `instance:current_id` and `team:current_id:<instanceID>`, and sent as `X-Instance-ID` / `X-Team-ID` on every request. Permissions (`src/hooks/usePermission.ts`) are computed **per (user, instance)** — the same user can have different roles on different instances.

## Common commands

```sh
pnpm dev          # vite dev server :5173
pnpm build        # tsc -b && vite build
pnpm lint         # eslint --max-warnings=0 (zero-warning policy)
pnpm lint:fix     # eslint --fix
pnpm e2e          # playwright test (requires the docker stack, the Go backend
                  # on :8086 and the dev server on :5173 — the suite targets
                  # the dev server, not the bundle inside the APISIX image)
```

Run a single E2E spec: `pnpm e2e e2e/tests/multi-instance.spec.ts` (add `--headed`, `--debug`, or `--ui` as needed).

### Go backend

```sh
go test -C api ./...                         # all backend tests
go vet -C api ./... && go test -C api -race ./...  # what CI runs
go test -C api ./internal/services -run Label  # one package
go build -C api -o ../bin/api ./cmd          # build
```

## VS Code Dev Containers

`.devcontainer/` provides a dev container that bundles APISIX + etcd alongside Node and pnpm. Open the project, accept "Reopen in Container", and run `pnpm dev`. The dev container does **not** currently include Go — if you're working on the backend, build/run it on the host.

## Troubleshooting

**Backend won't start, "failed to connect to etcd"** — etcd isn't reachable from where the backend is running. From the host, `curl http://localhost:2379/version` should return JSON. If port `2379` is already in use, see the next entry: changing `ETCD_ENDPOINTS` alone won't help, because the etcd container will not have started at all.

**A container won't start: "port is already allocated"** — a busy host port doesn't cost you one service, it stops the whole container: something else on `:9090` takes the gateway's Admin API down with its Control API, and every instance registered against it then reads as Disconnected. Move the port instead:

```sh
E2E_CONTROL_PORT=19090 docker compose -f e2e/server/docker-compose.yml up -d
```

| variable | default | what it publishes |
|---|---|---|
| `E2E_GATEWAY_PORT` | 9080 | the gateway itself |
| `E2E_ADMIN_PORT` | 9180 | its Admin API |
| `E2E_CONTROL_PORT` | 9090 | its Control API (loopback only) |
| `E2E_ADMIN2_PORT` | 9181 | the second gateway's Admin API |
| `E2E_ETCD_PORT` | 2379 | etcd |

The suite builds its own addresses from these (`e2e/utils/stack.ts`), so setting the port is enough — pass the same variable to `pnpm e2e` and to `docker compose`. The `E2E_*_URL` variables still override, for a run whose stack is not on this host. The backend needs `ETCD_ENDPOINTS` pointed at the etcd port you chose.

The `deploy/` stack has the same three: `DASHBOARD_PORT` (8080), `GATEWAY_PORT` (9080), `GATEWAY2_PORT` (9081).

**Frontend hits 401 in a loop** — the access token is missing/invalid and the refresh token is also rejected. The interceptor will redirect to `/ui/login`. Check that the Go backend is up on `:8086` and that `JWT_SECRET` hasn't changed since the token was issued (changing the secret invalidates all tokens).

**Dashboard shows "Access denied for this instance"** — the logged-in user has no `UserInstance` record for the currently-selected instance. As a super_admin, go to `/ui/users` and assign the user a role on that instance.

**`pnpm dev` says "vite: not found"** — you skipped `pnpm install`.

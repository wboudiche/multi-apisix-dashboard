# Official Docker image for the dashboard — design

Date: 2026-09-15

## Goal

Ship one container image that runs the whole Multi-Tenant APISIX Dashboard
(Go backend + built React SPA) against an existing etcd, publish it to GHCR on
every release tag, and provide a demo compose stack that uses it with one etcd
and two APISIX gateways.

Today the only Dockerfile (`e2e/server/Dockerfile`) bakes the SPA into an
APISIX image for e2e bootstrap. The Go backend has never been containerised
and does not serve static files, so the bundle at `:9180/ui` cannot log in
(its `POST /api/v1/login` hits APISIX and gets a 404).

## Decisions taken

| Question | Decision |
|---|---|
| Image shape | One image: Go binary serves `/api/*`, `/health` and the SPA under `/ui` |
| SPA delivery | Directory on disk selected by `UI_DIR` (not `embed.FS`) |
| Registry / trigger | GHCR, on push of tag `v*`; build-only check on pull requests |
| Deploy example | `deploy/docker-compose.yml`: dashboard + etcd + two APISIX |
| Final base image | `alpine` (keeps a busybox `wget` healthcheck and a shell) |

## 1. Backend: serve the SPA

### Config

`ServerConfig` gains `UIDir string`, read from `UI_DIR`. Empty (the default)
disables static serving entirely, so `pnpm dev`, `go test ./...` and the e2e
stack are unchanged.

`ETCD_ENDPOINTS` is documented as comma-separated but `parseEnvList` returns
the raw string as a single endpoint. It now splits on `,`, trims each entry
and drops empties. The default stays `http://localhost:2379`.

### Handler

New file `api/internal/handlers/spa.go` exposing
`NewSPAHandler(dir string) gin.HandlerFunc`, registered with `router.NoRoute`
only when `UI_DIR` is set. Behaviour:

- Methods other than `GET` and `HEAD`: 404 JSON (current behaviour).
- `GET /` and `GET /ui`: 302 redirect to `/ui/`.
- `GET /ui/<path>`: if `<path>` resolves to a regular file inside `dir`, serve
  it. Otherwise serve `dir/index.html` (client-side router fallback).
- Any other path (for example a mistyped `/api/...`): 404 JSON, so API typos
  never receive HTML.
- Path traversal is blocked by cleaning the path and rejecting anything that
  escapes `dir`.
- Cache headers: `index.html` gets `Cache-Control: no-cache`; files under
  `/ui/assets/` (hashed by Vite) get
  `Cache-Control: public, max-age=31536000, immutable`; other files get no
  explicit cache header.

The Vite build already uses `base: '/ui'`, so `dist/` is served as-is.

### Tests

`api/internal/handlers/spa_test.go` builds a temp dir with `index.html` and
`assets/app.abc.js`, then asserts with `httptest`: root redirect, asset served
with immutable cache, unknown `/ui/routes/1` returns `index.html` with
`no-cache`, `/api/nope` returns 404 JSON, `POST /ui/` returns 404, and
`/ui/../../etc/passwd` does not escape.

`api/internal/config/config_test.go` covers `parseEnvList` with one value, a
comma list with spaces, and an empty variable.

## 2. Root `Dockerfile`

Three stages:

1. `node:22-alpine` — `corepack enable pnpm`, copy `package.json` and
   `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`, copy the source,
   `pnpm build` (produces `dist/`).
2. `golang:1.24-alpine` — copy `api/`, download modules, build
   `CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/api ./cmd`.
3. `alpine:3.20` — add `ca-certificates`, create user `app` (uid 10001),
   copy the binary to `/app/api` and `dist/` to `/app/ui`. Set
   `ENV UI_DIR=/app/ui PORT=8080 HOST=0.0.0.0`, `EXPOSE 8080`, `USER app`,
   `HEALTHCHECK` with busybox `wget -qO- http://127.0.0.1:8080/health`,
   `ENTRYPOINT ["/app/api"]`.

`JWT_SECRET` is deliberately not defaulted: the backend refuses to start
without a strong one, which is the correct behaviour for an official image.

`.dockerignore` grows to exclude `node_modules`, `dist`, `bin`, `.git`,
`test-results`, `playwright-report`, `e2e`, `docs`, `.github`, `.devcontainer`.
The e2e Dockerfile mentions needing git for a commit sha; nothing in
`vite.config.ts` reads git today, so `.git` is excluded and the build is
verified to pass without it.

Image size target: under 60 MB compressed.

## 3. Workflow `.github/workflows/docker.yml`

Triggers: `push` on tags `v*`, and `pull_request` on `main`.

Steps: checkout, `docker/setup-qemu-action`, `docker/setup-buildx-action`,
`docker/login-action` to `ghcr.io` with `GITHUB_TOKEN` (tag pushes only),
`docker/metadata-action` on `ghcr.io/${{ github.repository }}` producing
`type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}`
and `latest` on tag pushes, then `docker/build-push-action` with
`platforms: linux/amd64,linux/arm64` on tag pushes and `linux/amd64` with
`push: false` on pull requests. GHA cache (`type=gha`) in both cases.
Permissions: `contents: read`, `packages: write`.

The pull-request build is the guard that #139 lacked: a vite config that only
fails inside the docker build is caught before merge.

## 4. `deploy/` demo stack

Files:

```
deploy/
├── README.md
├── .env.example
├── docker-compose.yml
└── apisix/
    ├── apisix_conf.yml    (etcd prefix /apisix)
    └── apisix_conf_2.yml  (etcd prefix /apisix2)
```

Services on one bridge network `dashboard`:

| Service | Image | Host ports | Notes |
|---|---|---|---|
| `dashboard` | `ghcr.io/wboudiche/multi-apisix-dashboard:latest` + `build: ..` | `8080:8080` | `ETCD_ENDPOINTS=http://etcd:2379`, `JWT_SECRET=${JWT_SECRET:?...}`, `ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}`; `depends_on: etcd: condition: service_healthy` |
| `etcd` | `bitnamilegacy/etcd:3.5` | none | same env as the e2e stack, named volume `etcd_data`, healthcheck `etcdctl endpoint health` |
| `apisix` | `apache/apisix:3.16.0-debian` | `9080:9080` | mounts `apisix/apisix_conf.yml`; socket-purging entrypoint copied from the e2e stack |
| `apisix2` | `apache/apisix:3.16.0-debian` | `9081:9080` | mounts `apisix/apisix_conf_2.yml` |

Admin API ports (9180) are not published; only the dashboard reaches them over
the internal network, which is what makes the demo `allow_admin: 0.0.0.0/0`
acceptable. `restart: unless-stopped` everywhere.

`deploy/README.md` explains: copy `.env.example` to `.env`, set `JWT_SECRET`
(`openssl rand -hex 32`), `docker compose up -d`, open
`http://localhost:8080/ui`, log in, register `http://apisix:9180` and
`http://apisix2:9180` with the demo key from the conf files, and how
`docker compose up --build` builds the image from the working tree instead of
pulling it.

## 5. Documentation

- `README.md`: new "Run with Docker" section with a minimal `docker run`
  against an existing etcd and a pointer to `deploy/`.
- `docs/en/development.md`: mention `UI_DIR` in the env var table and note that
  `ETCD_ENDPOINTS` now really is comma-separated.
- `CLAUDE.md`: one line in the backend section about `UI_DIR` and the root
  Dockerfile, and correct the stale note claiming the e2e etcd is not exposed
  on the host.

## Out of scope

- Replacing the e2e Dockerfile / compose (they keep bootstrapping the tests).
- Auto-registering the demo APISIX instances at first start.
- Removing the dead `/apisix/admin` rewrite in `vite.config.ts`.
- A distroless variant.

## Verification

1. `go test -C api ./...` passes with the new handler and config tests.
2. `docker build -t dashboard:dev .` succeeds; image under 60 MB compressed.
3. `docker run` against the running e2e etcd: `GET /` redirects to `/ui/`,
   `GET /ui/` returns the SPA, `POST /api/v1/login` with `admin/admin` returns
   200, `GET /ui/routes` returns `index.html`, `GET /api/nope` returns 404 JSON.
4. `cd deploy && docker compose up -d --build`: all four containers healthy,
   login works, both instances register from the UI and list routes.
5. The workflow's pull-request job builds green on the PR that adds it.

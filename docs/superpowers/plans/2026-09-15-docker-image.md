# Official Docker Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single container image (Go backend + built SPA) published to GHCR on release tags, plus a `deploy/` compose stack with etcd and two APISIX gateways.

**Architecture:** The Go backend gains an optional static-file handler (`UI_DIR`) registered as Gin's `NoRoute`, serving `dist/` under `/ui` with an `index.html` fallback. A three-stage root `Dockerfile` builds the SPA with pnpm, the binary with Go, and ships both on Alpine. A GitHub Actions workflow builds multi-arch and pushes to GHCR on `v*` tags, and build-checks on pull requests. `deploy/docker-compose.yml` consumes the image.

**Tech Stack:** Go 1.24 + Gin, Node 22 + pnpm 10.10.0 + Vite, Docker buildx, GitHub Actions (`docker/*` actions), etcd 3.5 (bitnamilegacy), APISIX 3.16.0.

**Spec:** `docs/superpowers/specs/2026-09-15-docker-image-design.md`

## Global Constraints

- Every new `.go`, `.yml`, `Dockerfile` and `.md` source file under `api/`, `deploy/` and `.github/` carries the ASF license header used throughout the repo (the Go and YAML forms are reproduced in the tasks). Apache 2.0 §4(b) requires it.
- Commit messages follow Conventional Commits: `<type>(<scope>): <summary>` with a body explaining *why*. Scope `api` for backend/image work, `common` for docs touching several areas, `ci` type for workflows. **No `Co-Authored-By` trailer** (project rule).
- `UI_DIR` empty means "no static serving" so `pnpm dev`, `go test ./...` and the e2e stack keep working unchanged.
- Image name: `ghcr.io/wboudiche/multi-apisix-dashboard`. Container listens on `8080` (Go default) with `HOST=0.0.0.0`.
- `JWT_SECRET` is never defaulted anywhere (Dockerfile, compose): the backend must refuse to start without a strong one.
- APISIX pin stays `apache/apisix:3.16.0-debian`; etcd stays `bitnamilegacy/etcd:3.5`.
- Run all Go commands with `-C api` from the repo root (`go test -C api ./...`).

---

## File map

| Path | Responsibility |
|---|---|
| `api/internal/config/config.go` | add `ServerConfig.UIDir` (`UI_DIR`), make `parseEnvList` split on commas |
| `api/internal/config/config_test.go` | **new** — tests for `parseEnvList` |
| `api/internal/handlers/spa.go` | **new** — `NewSPAHandler(dir) gin.HandlerFunc`, the `/ui` static + fallback handler |
| `api/internal/handlers/spa_test.go` | **new** — httptest coverage of the handler |
| `api/cmd/main.go` | register the handler as `NoRoute` when `UI_DIR` is set |
| `Dockerfile` | **new** — three-stage image build |
| `.dockerignore` | exclude build outputs, git, tests, docs |
| `.github/workflows/docker.yml` | **new** — GHCR publish on `v*` tags, build check on PRs |
| `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/README.md`, `deploy/apisix/apisix_conf.yml`, `deploy/apisix/apisix_conf_2.yml` | **new** — demo stack using the image |
| `README.md`, `docs/en/development.md`, `CLAUDE.md` | document the image, `UI_DIR`, comma-separated `ETCD_ENDPOINTS`, fix the stale etcd note |

---

### Task 1: Comma-separated `ETCD_ENDPOINTS`

**Files:**
- Modify: `api/internal/config/config.go:83-88` (`parseEnvList`)
- Create: `api/internal/config/config_test.go`

**Interfaces:**
- Produces: `parseEnvList(key, defaultValue string) []string` keeps its signature; now returns one entry per comma-separated, trimmed, non-empty item, or `[]string{defaultValue}` when the variable is unset/blank.

- [ ] **Step 1: Write the failing test**

Create `api/internal/config/config_test.go`:

```go
// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package config

import (
	"reflect"
	"testing"
)

func TestParseEnvList(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "unset falls back to the default", value: "", want: []string{"http://localhost:2379"}},
		{name: "single value", value: "http://etcd:2379", want: []string{"http://etcd:2379"}},
		{
			name:  "comma list with spaces and a trailing comma",
			value: "http://a:2379, http://b:2379 ,,http://c:2379,",
			want:  []string{"http://a:2379", "http://b:2379", "http://c:2379"},
		},
		{name: "only separators falls back to the default", value: " , ", want: []string{"http://localhost:2379"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_ENDPOINTS", tc.value)
			got := parseEnvList("TEST_ENDPOINTS", "http://localhost:2379")
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseEnvList(%q) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test -C api ./internal/config -run TestParseEnvList -v`
Expected: FAIL on "comma list with spaces and a trailing comma" (the whole string comes back as one element) and on "only separators".

- [ ] **Step 3: Implement the split**

In `api/internal/config/config.go`, add `"strings"` to the imports and replace `parseEnvList`:

```go
// parseEnvList reads a comma-separated environment variable into a slice,
// trimming whitespace and dropping empty items. A variable that is unset or
// contains nothing but separators yields the single default value.
func parseEnvList(key, defaultValue string) []string {
	var out []string
	for _, item := range strings.Split(os.Getenv(key), ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	if len(out) == 0 {
		return []string{defaultValue}
	}
	return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test -C api ./internal/config -v`
Expected: PASS, four subtests.

- [ ] **Step 5: Commit**

```bash
git add api/internal/config/config.go api/internal/config/config_test.go
git commit -m "fix(api): split ETCD_ENDPOINTS on commas

The env var was documented as comma-separated for HA but parseEnvList
handed the whole string to the etcd client as one endpoint, so a list
silently pointed the backend at a host that does not exist. The
official image makes this the primary way to configure etcd, so it
has to work."
```

---

### Task 2: SPA handler served under `/ui`

**Files:**
- Create: `api/internal/handlers/spa.go`
- Create: `api/internal/handlers/spa_test.go`

**Interfaces:**
- Produces: `func NewSPAHandler(dir string) gin.HandlerFunc` in package `handlers`. Task 3 registers it with `router.NoRoute(...)`.
- Behaviour contract (from the spec): GET/HEAD only; `/` and `/ui` → 302 to `/ui/`; `/ui/<file>` served when it is a regular file inside `dir`; any other `/ui/...` → `index.html` with `Cache-Control: no-cache`; files under `/ui/assets/` get `Cache-Control: public, max-age=31536000, immutable`; everything outside `/ui` → `404 {"error":"not found"}`; path traversal cannot leave `dir`.

- [ ] **Step 1: Write the failing tests**

Create `api/internal/handlers/spa_test.go`:

```go
// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// newSPARouter builds a router that mirrors main.go: an API route exists,
// everything else falls through to the SPA handler.
func newSPARouter(t *testing.T) *gin.Engine {
	t.Helper()
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><title>dashboard</title>")
	mustWrite(t, filepath.Join(dir, "assets", "app.abc123.js"), "console.log('app')")
	mustWrite(t, filepath.Join(dir, "favicon.ico"), "icon")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/ping", func(c *gin.Context) { c.String(http.StatusOK, "pong") })
	r.NoRoute(NewSPAHandler(dir))
	return r
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func do(r *gin.Engine, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	r.ServeHTTP(w, req)
	return w
}

func TestSPAHandler_RootRedirectsToUI(t *testing.T) {
	r := newSPARouter(t)
	for _, p := range []string{"/", "/ui"} {
		w := do(r, http.MethodGet, p)
		if w.Code != http.StatusFound {
			t.Fatalf("GET %s: status %d, want 302", p, w.Code)
		}
		if loc := w.Header().Get("Location"); loc != "/ui/" {
			t.Fatalf("GET %s: Location %q, want /ui/", p, loc)
		}
	}
}

func TestSPAHandler_ServesIndexWithNoCache(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodGet, "/ui/")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "<title>dashboard</title>") {
		t.Fatalf("body %q is not index.html", w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("Cache-Control %q, want no-cache", cc)
	}
}

func TestSPAHandler_ClientRouteFallsBackToIndex(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodGet, "/ui/routes/1/edit")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "<title>dashboard</title>") {
		t.Fatalf("body %q is not index.html", w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("Cache-Control %q, want no-cache", cc)
	}
}

func TestSPAHandler_HashedAssetIsImmutable(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodGet, "/ui/assets/app.abc123.js")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	if w.Body.String() != "console.log('app')" {
		t.Fatalf("body %q, want the asset", w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control %q", cc)
	}
}

func TestSPAHandler_PlainFileHasNoCacheHeader(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodGet, "/ui/favicon.ico")
	if w.Code != http.StatusOK || w.Body.String() != "icon" {
		t.Fatalf("status %d body %q", w.Code, w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); cc != "" {
		t.Fatalf("Cache-Control %q, want none", cc)
	}
}

func TestSPAHandler_HeadIsAllowed(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodHead, "/ui/")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
}

func TestSPAHandler_OutsideUIIs404JSON(t *testing.T) {
	r := newSPARouter(t)
	for _, p := range []string{"/api/nope", "/api/v1/nope", "/health-check", "/uix"} {
		w := do(r, http.MethodGet, p)
		if w.Code != http.StatusNotFound {
			t.Fatalf("GET %s: status %d, want 404", p, w.Code)
		}
		if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Fatalf("GET %s: Content-Type %q, want JSON", p, ct)
		}
	}
}

func TestSPAHandler_NonGetIs404(t *testing.T) {
	r := newSPARouter(t)
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		w := do(r, m, "/ui/")
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s /ui/: status %d, want 404", m, w.Code)
		}
	}
}

func TestSPAHandler_ExistingAPIRouteStillWins(t *testing.T) {
	r := newSPARouter(t)
	w := do(r, http.MethodGet, "/api/v1/ping")
	if w.Code != http.StatusOK || w.Body.String() != "pong" {
		t.Fatalf("status %d body %q", w.Code, w.Body.String())
	}
}

func TestSPAHandler_TraversalStaysInsideDir(t *testing.T) {
	r := newSPARouter(t)
	// A cleaned path that escapes the UI dir must not read the host
	// filesystem; it resolves to something that does not exist under dir
	// and therefore gets the index fallback.
	for _, p := range []string{"/ui/../../etc/passwd", "/ui/..%2F..%2Fetc%2Fpasswd", "/ui/assets/../../../etc/passwd"} {
		w := do(r, http.MethodGet, p)
		if strings.Contains(w.Body.String(), "root:") {
			t.Fatalf("GET %s leaked a file outside the UI dir", p)
		}
		if w.Code != http.StatusOK && w.Code != http.StatusFound && w.Code != http.StatusNotFound {
			t.Fatalf("GET %s: unexpected status %d", p, w.Code)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test -C api ./internal/handlers -run TestSPAHandler -v`
Expected: build FAIL with `undefined: NewSPAHandler`.

- [ ] **Step 3: Implement the handler**

Create `api/internal/handlers/spa.go`:

```go
// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handlers

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// uiPrefix is the URL prefix the SPA is built for (vite `base`), see
// src/config/constant.ts BASE_PATH.
const uiPrefix = "/ui"

// NewSPAHandler serves the built frontend from dir under /ui. It is meant to
// be registered as the router's NoRoute handler so every real API route keeps
// precedence:
//
//   - GET / and GET /ui redirect to /ui/;
//   - GET /ui/<path> serves the matching regular file when it exists, with a
//     one-year immutable cache for the hashed files under /ui/assets/;
//   - any other GET /ui/... serves index.html with no-cache, so the client
//     router can own the path;
//   - everything else (wrong method, a mistyped /api path) is a JSON 404, so
//     API clients never receive HTML.
//
// The request path is cleaned as an absolute path before it is joined onto
// dir, so ".." segments cannot escape it.
func NewSPAHandler(dir string) gin.HandlerFunc {
	root, err := filepath.Abs(dir)
	if err != nil {
		root = dir
	}
	index := filepath.Join(root, "index.html")

	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		p := c.Request.URL.Path
		if p == "/" || p == uiPrefix {
			c.Redirect(http.StatusFound, uiPrefix+"/")
			return
		}
		if !strings.HasPrefix(p, uiPrefix+"/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		// "/ui/assets/x.js" -> "/assets/x.js"; Clean on an absolute path
		// resolves every ".." against "/" so the result can only descend
		// from root.
		rel := path.Clean("/" + strings.TrimPrefix(p, uiPrefix+"/"))
		full := filepath.Join(root, filepath.FromSlash(rel))

		if info, statErr := os.Stat(full); statErr == nil && info.Mode().IsRegular() {
			switch {
			case full == index:
				c.Header("Cache-Control", "no-cache")
			case strings.HasPrefix(rel, "/assets/"):
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
			c.File(full)
			return
		}

		c.Header("Cache-Control", "no-cache")
		c.File(index)
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test -C api ./internal/handlers -run TestSPAHandler -v`
Expected: PASS, all ten tests. If `TestSPAHandler_HeadIsAllowed` fails with an empty body assertion, note that `c.File` uses `http.ServeFile`, which already handles HEAD; the test only checks the status.

- [ ] **Step 5: Run the whole backend suite**

Run: `go test -C api ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/internal/handlers/spa.go api/internal/handlers/spa_test.go
git commit -m "feat(api): add a handler that serves the built SPA under /ui

The backend has only ever exposed /api and /health; the frontend was
served by vite in dev and by an APISIX image in e2e, so there was no
way to run the dashboard as one process. This handler serves dist/
with an index.html fallback for client-side routes and keeps every
non-/ui miss a JSON 404, so API clients never get HTML back."
```

---

### Task 3: `UI_DIR` config and wiring in `main.go`

**Files:**
- Modify: `api/internal/config/config.go:30-33` (`ServerConfig`) and `:54-57` (`Load`)
- Modify: `api/cmd/main.go:83` (setupRouter call), `:99` (setupRouter signature), after the `/health` route (register NoRoute)

**Interfaces:**
- Consumes: `handlers.NewSPAHandler(dir string) gin.HandlerFunc` from Task 2.
- Produces: `config.ServerConfig.UIDir string` populated from `UI_DIR` (empty by default); `setupRouter(..., uiDir string)` gains a trailing parameter.

- [ ] **Step 1: Add `UIDir` to the config**

In `api/internal/config/config.go`:

```go
type ServerConfig struct {
	Port string
	Host string
	// UIDir is the directory holding the built frontend (vite dist/). Empty
	// disables static serving, which is the dev and test default.
	UIDir string
}
```

and in `Load()`:

```go
		Server: ServerConfig{
			Port:  getEnv("PORT", "8080"),
			Host:  getEnv("HOST", "0.0.0.0"),
			UIDir: os.Getenv("UI_DIR"),
		},
```

- [ ] **Step 2: Thread it through `setupRouter`**

In `api/cmd/main.go`, change the call:

```go
	router := setupRouter(authService, authHandler, instanceHandler, teamHandler, overviewHandler, proxyHandler, upstreamHandler, routeTestHandler, labelHandler, wsdlHandler, settingsHandler, cfg.Server.UIDir)
```

Change the signature by appending `uiDir string` after `settingsHandler *handlers.SettingsHandler`:

```go
func setupRouter(authService *services.AuthService, authHandler *handlers.AuthHandler, instanceHandler *handlers.InstanceHandler, teamHandler *handlers.TeamHandler, overviewHandler *handlers.OverviewHandler, proxyHandler *handlers.ProxyHandler, upstreamHandler *handlers.UpstreamHandler, routeTestHandler *handlers.RouteTestHandler, labelHandler *handlers.LabelHandler, wsdlHandler *handlers.WsdlHandler, settingsHandler *handlers.SettingsHandler, uiDir string) *gin.Engine {
```

Right after the `/health` route block (the `router.GET("/health", ...)` call), add:

```go
	// Built frontend, only when the deployment ships one (the docker image
	// sets UI_DIR=/app/ui). Registered as NoRoute so every API route wins.
	if uiDir != "" {
		log.Printf("Serving UI from %s under %s", uiDir, "/ui")
		router.NoRoute(handlers.NewSPAHandler(uiDir))
	}
```

- [ ] **Step 3: Build and test**

Run: `go build -C api -o ../bin/api ./cmd && go test -C api ./...`
Expected: build OK, tests PASS.

- [ ] **Step 4: Smoke-test against the running local etcd**

The e2e stack exposes etcd on `:2379`. Run from the repo root (the `dist/` directory exists from an earlier `pnpm build`; if not, run `pnpm build` first):

```bash
PORT=18086 UI_DIR=./dist ETCD_ENDPOINTS=http://localhost:2379 JWT_SECRET="$(openssl rand -hex 32)" ./bin/api &
sleep 2
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:18086/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18086/ui/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18086/ui/routes
curl -s -w '\n' http://127.0.0.1:18086/api/nope
kill %1
```

Expected, in order: `302 http://127.0.0.1:18086/ui/`, `200`, `200`, `{"error":"not found"}`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/config/config.go api/cmd/main.go
git commit -m "feat(api): serve the built frontend when UI_DIR is set

Lets one process serve both the API and the SPA, which is what a
container image needs. The variable is empty by default so pnpm dev,
the Go tests and the e2e stack behave exactly as before."
```

---

### Task 4: Root `Dockerfile` and `.dockerignore`

**Files:**
- Create: `Dockerfile`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: `UI_DIR` from Task 3.
- Produces: an image whose entrypoint is `/app/api`, listens on `8080`, serves the UI from `/app/ui`, and has a `HEALTHCHECK` on `/health`. Task 5 builds it in CI; Task 6 consumes it from compose.

- [ ] **Step 1: Write `.dockerignore`**

Replace the content of `.dockerignore` with:

```
**/node_modules
dist
bin
.git
test-results
playwright-report
e2e
docs
.github
.devcontainer
deploy
```

- [ ] **Step 2: Write the `Dockerfile`**

Create `Dockerfile` at the repo root:

```dockerfile
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Official image: Go backend + built SPA in one container.
#
#   docker build -t ghcr.io/wboudiche/multi-apisix-dashboard:dev .
#   docker run -p 8080:8080 -e ETCD_ENDPOINTS=http://etcd:2379 \
#     -e JWT_SECRET="$(openssl rand -hex 32)" ghcr.io/wboudiche/multi-apisix-dashboard:dev
#
# JWT_SECRET is deliberately not defaulted: the backend refuses to start
# without a strong one.

# ---- 1. frontend --------------------------------------------------------
FROM node:22-alpine AS ui
WORKDIR /app
# packageManager in package.json pins pnpm@10.10.0; corepack fetches it.
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

# ---- 2. backend ---------------------------------------------------------
FROM golang:1.24-alpine AS api
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/api ./cmd

# ---- 3. runtime ---------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 -h /app app
WORKDIR /app
COPY --from=api /out/api /app/api
COPY --from=ui /app/dist /app/ui
ENV UI_DIR=/app/ui \
    PORT=8080 \
    HOST=0.0.0.0
EXPOSE 8080
USER app
# busybox wget is in the base image; the shell form lets $PORT expand.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/app/api"]
```

- [ ] **Step 3: Build the image locally**

Run: `docker build -t ghcr.io/wboudiche/multi-apisix-dashboard:dev .`
Expected: success. If `pnpm build` fails complaining about `git`, the e2e Dockerfile's claim was right after all: add `RUN apk add --no-cache git` before `pnpm build` in stage 1, remove `.git` from `.dockerignore`, and note it in the commit body. Otherwise keep `.git` excluded.

Check the size: `docker image ls ghcr.io/wboudiche/multi-apisix-dashboard:dev` — expect well under 100 MB on disk (the spec targets under 60 MB compressed).

- [ ] **Step 4: Run it against the e2e stack's etcd**

The e2e compose network is `server_apisix` and its etcd service is `etcd`:

```bash
docker run -d --rm --name dashboard-smoke --network server_apisix -p 18080:8080 \
  -e ETCD_ENDPOINTS=http://etcd:2379 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/wboudiche/multi-apisix-dashboard:dev
sleep 3
docker inspect --format '{{.State.Health.Status}}' dashboard-smoke
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:18080/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/ui/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/ui/assets/$(docker exec dashboard-smoke ls /app/ui/assets | grep -m1 '\.js$')
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' http://127.0.0.1:18080/api/v1/login
docker exec dashboard-smoke id -u
docker stop dashboard-smoke
```

Expected: health `starting` then `healthy` after ~15 s (re-run inspect if needed), `302 http://127.0.0.1:18080/ui/`, `200`, `200`, `200`, uid `10001`.

- [ ] **Step 5: Verify the missing-secret failure is loud**

```bash
docker run --rm ghcr.io/wboudiche/multi-apisix-dashboard:dev; echo "exit=$?"
```

Expected: the log line `JWT_SECRET is required and must not be the documented default` and a non-zero exit.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build(api): add the official dashboard image

One alpine image with the static Go binary and the built SPA, served
under /ui by the backend itself. The e2e Dockerfile stays as the test
bootstrap; this one is what a deployment pulls."
```

---

### Task 5: GHCR publish workflow

**Files:**
- Create: `.github/workflows/docker.yml`

**Interfaces:**
- Consumes: the root `Dockerfile` from Task 4.
- Produces: `ghcr.io/wboudiche/multi-apisix-dashboard:{version}`, `:{major}.{minor}` and `:latest` on every `v*` tag; a no-push amd64 build on pull requests.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/docker.yml`:

```yaml
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

name: Docker image

on:
  push:
    tags:
      - "v*"
  pull_request:
    branches:
      - main

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  packages: write

jobs:
  image:
    # A pull request only proves the Dockerfile still builds (the failure
    # mode behind #139 surfaced nowhere else); a tag builds both
    # architectures and publishes to GHCR.
    timeout-minutes: 30
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: docker/setup-qemu-action@v3
        if: github.event_name == 'push'

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        if: github.event_name == 'push'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=ref,event=pr
          flavor: |
            latest=${{ github.event_name == 'push' }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: ${{ github.event_name == 'push' && 'linux/amd64,linux/arm64' || 'linux/amd64' }}
          push: ${{ github.event_name == 'push' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Lint the YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docker.yml')); print('ok')"`
Expected: `ok`. (If `actionlint` is installed, `actionlint .github/workflows/docker.yml` should print nothing.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docker.yml
git commit -m "ci(api): publish the dashboard image to GHCR on release tags

Every v* tag now builds linux/amd64 and linux/arm64 and pushes
version, major.minor and latest tags with GITHUB_TOKEN, so a release
is one git tag away from a pullable image. Pull requests build amd64
without pushing, which is the only check that would have caught a
vite config that fails inside docker (#139)."
```

The real proof is the pull-request job going green once the branch is pushed; record that in the PR description.

---

### Task 6: `deploy/` demo stack

**Files:**
- Create: `deploy/docker-compose.yml`
- Create: `deploy/.env.example`
- Create: `deploy/apisix/apisix_conf.yml`
- Create: `deploy/apisix/apisix_conf_2.yml`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: the image from Task 4 (pulled from GHCR, or built with `--build` from the repo root context).
- Produces: a stack on network `dashboard` with services `dashboard` (host `8080`), `etcd`, `apisix` (host `9080`), `apisix2` (host `9081`). Admin URLs inside the network: `http://apisix:9180`, `http://apisix2:9180`.

- [ ] **Step 1: Write the APISIX configs**

Create `deploy/apisix/apisix_conf.yml`:

```yaml
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Demo gateway 1. The admin port (9180) is not published on the host: only
# the dashboard reaches it over the compose network, which is why the open
# allow_admin below is acceptable here and nowhere else.
apisix:
  node_listen: 9080
  enable_ipv6: false
deployment:
  admin:
    allow_admin:
      - 0.0.0.0/0
    admin_key:
      - name: admin
        key: edd1c9f034335f136f87ad84b625c8f1
        role: admin
  etcd:
    host:
      - http://etcd:2379
    prefix: /apisix
    timeout: 30
```

Create `deploy/apisix/apisix_conf_2.yml` with the same content except the leading comment says `# Demo gateway 2.` and the prefix is:

```yaml
    prefix: /apisix2
```

- [ ] **Step 2: Write the compose file**

Create `deploy/docker-compose.yml`:

```yaml
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Demo stack: the published dashboard image, one etcd shared by everything
# (prefixes /apisix-dashboard, /apisix, /apisix2) and two APISIX gateways.
#
#   cp .env.example .env && edit JWT_SECRET
#   docker compose up -d            # pulls ghcr.io/wboudiche/multi-apisix-dashboard
#   docker compose up -d --build    # builds the image from this checkout instead
#
# Only the dashboard (8080) and gateway traffic (9080, 9081) reach the host.
# The APISIX admin ports stay inside the network.

services:
  dashboard:
    image: ghcr.io/wboudiche/multi-apisix-dashboard:latest
    build:
      context: ..
    restart: unless-stopped
    environment:
      ETCD_ENDPOINTS: http://etcd:2379
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env (openssl rand -hex 32)}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-admin}
    ports:
      - '8080:8080'
    depends_on:
      etcd:
        condition: service_healthy
    networks:
      - dashboard

  etcd:
    image: bitnamilegacy/etcd:3.5
    restart: unless-stopped
    environment:
      ETCD_ENABLE_V2: 'true'
      ALLOW_NONE_AUTHENTICATION: 'yes'
      ETCD_ADVERTISE_CLIENT_URLS: 'http://etcd:2379'
      ETCD_LISTEN_CLIENT_URLS: 'http://0.0.0.0:2379'
    volumes:
      - etcd_data:/bitnami/etcd
    healthcheck:
      test: ['CMD', 'etcdctl', 'endpoint', 'health']
      interval: 5s
      timeout: 3s
      retries: 12
    networks:
      - dashboard

  apisix:
    image: apache/apisix:3.16.0-debian
    restart: unless-stopped
    volumes:
      - ./apisix/apisix_conf.yml:/usr/local/apisix/conf/config.yaml:ro
    # A unix socket left in logs/ survives a container restart and nginx
    # refuses to bind a path that already exists, which turns
    # restart: unless-stopped into a crash loop. Clear them first.
    entrypoint:
      - /bin/sh
      - -c
      - rm -f /usr/local/apisix/logs/*.sock; exec /docker-entrypoint.sh docker-start
    ports:
      - '9080:9080'
    depends_on:
      etcd:
        condition: service_healthy
    networks:
      - dashboard

  apisix2:
    image: apache/apisix:3.16.0-debian
    restart: unless-stopped
    volumes:
      - ./apisix/apisix_conf_2.yml:/usr/local/apisix/conf/config.yaml:ro
    entrypoint:
      - /bin/sh
      - -c
      - rm -f /usr/local/apisix/logs/*.sock; exec /docker-entrypoint.sh docker-start
    ports:
      - '9081:9080'
    depends_on:
      etcd:
        condition: service_healthy
    networks:
      - dashboard

networks:
  dashboard:
    driver: bridge

volumes:
  etcd_data:
```

- [ ] **Step 3: Write `.env.example`**

Create `deploy/.env.example`:

```
# Copy to .env next to docker-compose.yml. JWT_SECRET is required and must
# be at least 32 bytes: openssl rand -hex 32
JWT_SECRET=
# Seeds the bootstrap "admin" user on first start only. Change it from the UI.
ADMIN_PASSWORD=admin
```

- [ ] **Step 4: Write `deploy/README.md`**

````markdown
# Deploy: demo stack

Runs the published dashboard image with one etcd and two APISIX gateways.
Only the dashboard and the gateways' traffic ports reach the host; the
APISIX Admin API is reachable solely from the dashboard container.

| Service | Host port | Inside the network |
|---|---|---|
| dashboard | 8080 | — |
| apisix (gateway 1) | 9080 | Admin API `http://apisix:9180` |
| apisix2 (gateway 2) | 9081 | Admin API `http://apisix2:9180` |
| etcd | — | `http://etcd:2379` |

## Start

```sh
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d
```

Open <http://localhost:8080/ui> and log in with `admin` and the
`ADMIN_PASSWORD` from `.env` (default `admin`). Change it from the user menu.

## Register the gateways

Go to **Instances** and add both, using the internal Admin URLs above. The
demo admin key for each is `edd1c9f034335f136f87ad84b625c8f1` (see
`apisix/apisix_conf.yml`). Replace it before exposing anything.

## Build the image from this checkout

```sh
docker compose up -d --build
```

The `build` context is the repository root, so the `Dockerfile` there is
used instead of pulling from GHCR.

## Reset

```sh
docker compose down -v
```

Removes the etcd volume, including every user, team and registered instance.
````

- [ ] **Step 5: Bring the stack up and verify**

Ports 8080, 9080 and 9081 must be free on the host. The dev stack on this machine already binds 9080 (`server-apisix-1`), so stop it first, or run the check with an override:

```bash
cd deploy
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
sleep 20
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/ui/
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' http://127.0.0.1:8080/api/v1/login | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
echo "${TOKEN:0:12}..."
docker compose exec dashboard wget -qO- --header 'X-API-KEY: edd1c9f034335f136f87ad84b625c8f1' http://apisix:9180/apisix/admin/routes
docker compose exec dashboard wget -qO- --header 'X-API-KEY: edd1c9f034335f136f87ad84b625c8f1' http://apisix2:9180/apisix/admin/routes
```

Expected: all four containers `Up` (dashboard `healthy`), `200`, a token prefix, and two JSON bodies with `"total":0` (or similar) proving both Admin APIs are reachable from the dashboard container. Then log in in a browser, register both instances from `/ui/instances`, and open the routes page on each.

Tear down: `docker compose down -v && cd ..` and remove `deploy/.env` (it is git-ignored in the next step, but don't commit it).

- [ ] **Step 6: Ignore the local `.env`**

Append to the repo root `.gitignore`:

```
deploy/.env
```

- [ ] **Step 7: Commit**

```bash
git add deploy .gitignore
git commit -m "build(api): add a deploy compose with etcd and two APISIX gateways

Gives the image a runnable example: pull it, set JWT_SECRET, and get a
dashboard with two registrable gateways. The admin ports stay inside
the compose network so only the dashboard can reach them."
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (after the "Quick start" section, before "## Architecture")
- Modify: `docs/en/development.md` (env var table around line 55-62; the compose description around line 26-30)
- Modify: `CLAUDE.md:57` (stale etcd note) and the "### The Go backend" section

**Interfaces:**
- Consumes: everything above; no code.

- [ ] **Step 1: README "Run with Docker"**

Insert before `## Architecture` in `README.md`:

````markdown
## Run with Docker

The dashboard ships as one image, `ghcr.io/wboudiche/multi-apisix-dashboard`, published on every `v*` tag (`:latest`, `:<major>.<minor>`, `:<version>`). It needs an etcd to keep its own data (users, teams, instances, roles) and reaches each APISIX over its Admin API, which you register from the UI.

```sh
docker run -d -p 8080:8080 \
  -e ETCD_ENDPOINTS=http://etcd:2379 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD=change-me \
  ghcr.io/wboudiche/multi-apisix-dashboard:latest
```

Open <http://localhost:8080/ui>. `JWT_SECRET` (at least 32 bytes) is required; the container refuses to start without it. `ETCD_ENDPOINTS` accepts a comma-separated list. The Admin URL you register must be resolvable from the container (`http://apisix:9180` on a shared docker network, not `localhost`).

For a complete example with etcd and two APISIX gateways, see [`deploy/`](./deploy/README.md).
````

- [ ] **Step 2: development.md**

In the env var table in `docs/en/development.md`, change the `ETCD_ENDPOINTS` row's Notes to `Comma-separated for HA (each entry trimmed).` and add a row after `HOST`:

```markdown
| `UI_DIR` | unset | Directory of the built frontend to serve under `/ui`. Unset in dev (vite serves it); the docker image sets `/app/ui`. |
```

After the sentence `Open <http://127.0.0.1:5173/ui>. The Vite dev server proxies:` list, add a short paragraph:

```markdown
To run the whole dashboard as one container instead, see the root `Dockerfile` and [`deploy/`](../../deploy/README.md).
```

- [ ] **Step 3: CLAUDE.md**

Replace line 57 (`The dev stack uses the host's etcd via ...`) with:

```markdown
The e2e compose publishes its etcd on the host at `:2379` (container `server-etcd-1`), and that is the etcd the locally-run backend uses. The `deploy/` compose is a separate, self-contained stack that consumes the published image; its etcd is not published.
```

In the "### The Go backend (`api/`)" section, after the etcd keyspace block, add:

```markdown
**Static UI** — when `UI_DIR` is set the backend serves that directory under `/ui` (`handlers/spa.go`, registered as `NoRoute`); anything outside `/ui` stays a JSON 404. Unset in dev. The root `Dockerfile` builds the SPA and the binary into one image (`ghcr.io/wboudiche/multi-apisix-dashboard`, pushed by `.github/workflows/docker.yml` on `v*` tags); `deploy/docker-compose.yml` runs it with etcd and two APISIX.
```

- [ ] **Step 4: Check links and lint**

Run: `pnpm lint` (the markdown is not linted, but the command confirms nothing else broke) and open the three files to verify the inserted markdown renders (tables have matching columns, fences are closed).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/en/development.md CLAUDE.md
git commit -m "docs(common): document the docker image, UI_DIR and the deploy stack

Readers had no way to run the dashboard without cloning the toolchain;
the README now leads with docker run, the dev doc lists UI_DIR, and the
CLAUDE.md note claiming the e2e etcd was not host-exposed was wrong."
```

---

### Task 8: Push and open the pull request

**Files:** none.

- [ ] **Step 1: Full verification before pushing**

```bash
go test -C api ./...
pnpm lint
pnpm build
docker build -t ghcr.io/wboudiche/multi-apisix-dashboard:dev .
```

Expected: all green.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/docker-image
gh pr create --base main --title "feat(api): official docker image and deploy stack" --body-file - <<'EOF'
## Summary

- Go backend serves the built SPA under `/ui` when `UI_DIR` is set (JSON 404 outside `/ui`, index fallback for client routes).
- `ETCD_ENDPOINTS` really splits on commas now.
- Root `Dockerfile`: one alpine image with the static binary and `dist/`; non-root, healthcheck on `/health`, `JWT_SECRET` required.
- `.github/workflows/docker.yml`: multi-arch push to `ghcr.io/wboudiche/multi-apisix-dashboard` on `v*` tags, amd64 build check on PRs.
- `deploy/docker-compose.yml`: dashboard + etcd + two APISIX with admin ports kept inside the network.
- Docs: README "Run with Docker", `UI_DIR` in development.md, stale etcd note in CLAUDE.md fixed.

Spec: `docs/superpowers/specs/2026-09-15-docker-image-design.md`

## Test plan

- [ ] `go test -C api ./...`
- [ ] `docker build .` locally, container healthy against the e2e etcd, login 200
- [ ] `cd deploy && docker compose up -d --build`, both gateways registrable from the UI
- [ ] "Docker image" workflow green on this PR
EOF
```

- [ ] **Step 3: Watch the Docker image job**

Run: `gh pr checks --watch` has no `--json` in gh 2.45; use `gh run list --branch feat/docker-image --workflow docker.yml` and `gh run view <id> --log-failed` if it fails. Expected: the `image` job succeeds.

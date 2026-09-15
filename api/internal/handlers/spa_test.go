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

func TestResolveUIPath_NeverEscapesRoot(t *testing.T) {
	root := "/srv/ui"
	testCases := []struct {
		name    string
		urlPath string
		wantFull string // empty = boundary check only; populated = exact match
		wantRel string  // relative path (with leading slash)
	}{
		{
			name:    "normal asset path",
			urlPath: "/ui/assets/app.js",
			wantFull: filepath.Join(root, "assets", "app.js"),
			wantRel: "/assets/app.js",
		},
		{
			name:    "simple file in root",
			urlPath: "/ui/index.html",
			wantFull: filepath.Join(root, "index.html"),
			wantRel: "/index.html",
		},
		{
			name:    "traversal with ..",
			urlPath: "/ui/../../etc/passwd",
			// Boundary check only; should not escape root
		},
		{
			name:    "traversal in middle",
			urlPath: "/ui/assets/../../../etc/passwd",
			// Boundary check only
		},
		{
			name:    "traversal with encoded slashes",
			urlPath: "/ui/..%2F..%2Fetc%2Fpasswd",
			// Boundary check only
		},
		{
			name:    "simple traversal",
			urlPath: "/ui/./../x",
			// Boundary check only
		},
		{
			name:    "multiple levels of traversal",
			urlPath: "/ui/a/b/../../..",
			// Boundary check only
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			full, rel := resolveUIPath(root, tc.urlPath)

			// Exact-match checks for legitimate paths.
			if tc.wantFull != "" {
				if full != tc.wantFull {
					t.Fatalf("resolveUIPath(%q, %q) full = %q, want %q",
						root, tc.urlPath, full, tc.wantFull)
				}
				if rel != tc.wantRel {
					t.Fatalf("resolveUIPath(%q, %q) rel = %q, want %q",
						root, tc.urlPath, rel, tc.wantRel)
				}
			}

			// Boundary check: all paths (including malicious) must stay under root.
			// On Unix, root is /srv/ui and we want to verify the result either:
			// - equals root exactly, or
			// - starts with root + separator (i.e., /srv/ui/)
			if full != root && !strings.HasPrefix(full, root+string(filepath.Separator)) {
				t.Fatalf("resolveUIPath(%q, %q) = %q, but must be under %q",
					root, tc.urlPath, full, root)
			}
		})
	}
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
	// This end-to-end test verifies that no file outside the UI directory is
	// served. Both c.File(full) and c.File(index) call http.ServeFile, which
	// rejects any r.URL.Path containing ".." segments with 400 (Bad Request)
	// before reading the filesystem. Therefore this test alone cannot distinguish
	// a safe handler (with path.Clean) from a vulnerable one (without).
	// The unit test TestResolveUIPath_NeverEscapesRoot is what validates that
	// the handler's path resolution itself prevents traversal; this test is the
	// last-ditch check that nothing leaks regardless.
	for _, p := range []string{"/ui/../../etc/passwd", "/ui/..%2F..%2Fetc%2Fpasswd", "/ui/assets/../../../etc/passwd"} {
		w := do(r, http.MethodGet, p)
		if strings.Contains(w.Body.String(), "root:") {
			t.Fatalf("GET %s leaked a file outside the UI dir", p)
		}
		if w.Code >= http.StatusInternalServerError {
			t.Fatalf("GET %s: unexpected status %d", p, w.Code)
		}
	}
}

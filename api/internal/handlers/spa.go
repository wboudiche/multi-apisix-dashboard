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

// resolveUIPath takes a request path (known to start with /ui/) and returns the
// absolute filesystem path under root. The path is cleaned as an absolute path,
// ensuring ".." segments cannot escape the root directory.
// It also returns the cleaned relative path (with leading slash) for cache header decisions.
func resolveUIPath(root, urlPath string) (fullPath string, relPath string) {
	// "/ui/assets/x.js" -> "/assets/x.js"; Clean on an absolute path
	// resolves every ".." against "/" so the result can only descend
	// from root.
	rel := path.Clean("/" + strings.TrimPrefix(urlPath, uiPrefix+"/"))
	// rel now starts with "/"; strip it before joining so it remains relative to root
	relForJoin := strings.TrimPrefix(rel, "/")
	full := filepath.Join(root, filepath.FromSlash(relForJoin))
	return full, rel
}

// NewSPAHandler serves the built frontend from dir under /ui. It is meant to
// be registered as the router's NoRoute handler so every real API route keeps
// precedence:
//
//   - GET / and GET /ui redirect to /ui/;
//   - GET /ui/<path> serves the matching regular file when it exists, with a
//     one-year immutable cache for the hashed files under /ui/assets/;
//   - a missing file under /ui/assets/ is a JSON 404 (hashed build output
//     never doubles as a client route);
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

		full, rel := resolveUIPath(root, p)

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

		// Vite only ever emits hashed files under /assets/, so a miss there is
		// a stale chunk from a previous deploy, never a client route. Answer
		// 404 so the browser reports it instead of choking on index.html
		// served as a module.
		if strings.HasPrefix(rel, "/assets/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		c.Header("Cache-Control", "no-cache")
		c.File(index)
	}
}

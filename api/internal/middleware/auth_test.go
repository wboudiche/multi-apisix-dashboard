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

package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/config"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

const testSecret = "test-secret-that-is-at-least-32-bytes-long"

// The dashboard proxies to APISIX and relays its status verbatim
// (handlers/proxy.go), so a 401 reaching the browser can mean either "your
// session is over" or "this gateway's admin key is wrong". They call for
// opposite responses — sign in again, versus fix the instance — and the
// browser cannot tell them apart from the status alone.
//
// So the ones the dashboard raises about its own session carry a code, the way
// force_password_change.go already marks its 403. These pin that every exit
// from AuthMiddleware carries it: the frontend keys a sign-out on it, and an
// exit that forgets it would leave that path silently dead.

func newAuthRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	// etcd is only reached for user lookups; token validation reads jwtCfg
	// alone, so a nil client is enough here.
	authService := services.NewAuthService(nil, config.Config{
		JWT: config.JWTConfig{Secret: testSecret, AccessExpiry: time.Minute},
	})

	r := gin.New()
	r.Use(AuthMiddleware(authService))
	r.GET("/api/v1/anything", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func callWithAuth(t *testing.T, r *gin.Engine, header string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	if header != "" {
		req.Header.Set(AuthorizationHeader, header)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// mintToken signs a token the middleware will accept as well-formed, expiring
// at the given offset from now. A negative offset produces one that is already
// expired — the ordinary end of a session, and the case that matters most.
func mintToken(t *testing.T, expiresIn time.Duration) string {
	t.Helper()
	claims := &services.Claims{
		UserID:    "user-1",
		Username:  "someone",
		TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func TestAuthMiddlewareMarksItsOwn401s(t *testing.T) {
	r := newAuthRouter(t)

	cases := []struct {
		name   string
		header string
	}{
		{"no authorization header", ""},
		{"not a bearer token", "Basic dXNlcjpwYXNz"},
		{"unparseable token", "Bearer not.a.jwt"},
		{"expired token", "Bearer " + mintToken(t, -time.Hour)},
		{"signed with another secret", "Bearer " + func() string {
			claims := &services.Claims{TokenType: "access", RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			}}
			s, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("a-different-secret-of-sufficient-len"))
			return s
		}()},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := callWithAuth(t, r, tc.header)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d (%s)", w.Code, w.Body.String())
			}

			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %s", w.Body.String())
			}
			if body["code"] != SessionInvalidCode {
				t.Fatalf("expected code %q, got %v (body %s)",
					SessionInvalidCode, body["code"], w.Body.String())
			}
			// The reason stays: it is what the operator is shown, and the
			// three exits do not mean the same thing.
			if body["error"] == nil || body["error"] == "" {
				t.Fatalf("expected a reason alongside the code, got %s", w.Body.String())
			}
		})
	}
}

func TestAuthMiddlewareLetsAValidTokenThrough(t *testing.T) {
	// The counterweight: if the code were stamped on every response rather
	// than on the rejections, the frontend would sign people out at random.
	r := newAuthRouter(t)

	w := callWithAuth(t, r, "Bearer "+mintToken(t, time.Hour))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a valid token, got %d (%s)", w.Code, w.Body.String())
	}
	if body := w.Body.String(); body != `{"ok":true}` {
		t.Fatalf("unexpected body: %s", body)
	}
}

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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The route test takes a path and sends it through the instance's gateway. Who
// may call it at all is #307's answer; whose route it is was nobody's (#311).

type stubOwners struct {
	owners map[string]string
	err    error
}

func (s stubOwners) GetOwner(_ context.Context, instanceID, resourceType, resourceID string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.owners[instanceID+"/"+resourceType+"/"+resourceID], nil
}

// adminAPI answers a route detail read, and a gateway answers the test itself.
func adminAPIWithRoute(t *testing.T, routeID string, route map[string]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/apisix/admin/routes/"+routeID) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"value": route})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func gatewayThatAnswers(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var reached []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = append(reached, r.Method+" "+r.URL.RequestURI())
		fmt.Fprint(w, "ok")
	}))
	t.Cleanup(srv.Close)
	return srv, &reached
}

// callTestRoute runs the handler with what the middleware in front of it leaves
// on the context: the instance, the caller's role and their assignment.
func callTestRoute(t *testing.T, owners ownerReader, instance *models.Instance, role string, ui *models.UserInstance, body string) *httptest.ResponseRecorder {
	t.Helper()
	return callTestRouteForTeam(t, owners, instance, role, ui, body, "")
}

// callTestRouteForTeam is callTestRoute with the team the caller names in
// X-Team-ID, when they name one.
func callTestRouteForTeam(t *testing.T, owners ownerReader, instance *models.Instance, role string, ui *models.UserInstance, body, team string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/test-route", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if team != "" {
		c.Request.Header.Set("X-Team-ID", team)
	}
	c.Set(middleware.InstanceKey, instance)
	c.Set(middleware.RoleKey, role)
	if ui != nil {
		c.Set(middleware.UserInstanceKey, ui)
	}

	NewRouteTestHandler(owners).TestRoute(c)
	return w
}

const (
	testRouteID = "r-1"
	myTeam      = "team-mine"
	otherTeam   = "team-theirs"
)

func instanceFor(admin, gateway string) *models.Instance {
	return &models.Instance{
		ID:          "i-1",
		Name:        "local",
		AdminAPIURL: admin,
		AdminKey:    "k",
		GatewayURL:  gateway,
		IsActive:    true,
	}
}

func TestRouteTestRefusesAnotherTeamsRoute(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/theirs"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: otherTeam}}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"DELETE","path":"/theirs"}`)

	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want %d: body %s", w.Code, http.StatusForbidden, w.Body.String())
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

func TestRouteTestAllowsTheCallersOwnRoute(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/mine"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want %d: body %s", w.Code, http.StatusOK, w.Body.String())
	}
	if len(*reached) != 1 || !strings.HasPrefix((*reached)[0], "GET /mine") {
		t.Errorf("the gateway saw %v", *reached)
	}
}

// A route with no team is administrative territory, as it is everywhere else in
// the API: not a free-for-all for whoever may write routes.
func TestRouteTestRefusesAnUnownedRouteToANonAdmin(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/unowned"})
	gateway, reached := gatewayThatAnswers(t)

	w := callTestRoute(t, stubOwners{}, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/unowned"}`)

	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want %d", w.Code, http.StatusForbidden)
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

// An admin acts for whichever team they say, as they do through the proxy, so
// the ownership check is not theirs. The route still has to be the one named.
func TestRouteTestLetsAnAdminTestAnyTeamsRoute(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/theirs"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: otherTeam}}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleSuperAdmin, nil,
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/theirs"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want %d: body %s", w.Code, http.StatusOK, w.Body.String())
	}
	if len(*reached) != 1 {
		t.Errorf("the gateway saw %v", *reached)
	}
}

// Naming one route and sending the request at another path is what the endpoint
// was open to.
func TestRouteTestRefusesAPathTheRouteDoesNotMatch(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"DELETE","path":"/theirs"}`)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status %d, want %d: body %s", w.Code, http.StatusBadRequest, w.Body.String())
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

func TestRouteTestNeedsARouteThatExists(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, "another-route", map[string]any{"uri": "/mine"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/mine"}`)

	if w.Code != http.StatusNotFound {
		t.Errorf("status %d, want %d", w.Code, http.StatusNotFound)
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

// An owner that cannot be read is not a licence to send the request.
func TestRouteTestFailsClosedWhenOwnershipCannotBeRead(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{err: errors.New("etcd is away")}

	w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/mine"}`)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status %d, want %d", w.Code, http.StatusBadGateway)
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

// A "." or ".." segment: the gateway collapses it, so the path the route was
// checked against is not the path it serves. Confirmed to reach the gateway
// before this refused it.
func TestRouteTestRefusesADotSegment(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine/*"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	for _, path := range []string{"/mine/../victim", "/mine/./victim", "/mine//victim", "/mine/%2e%2e/victim"} {
		w := callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
			models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
			`{"route_id":"`+testRouteID+`","method":"DELETE","path":"`+path+`"}`)

		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want %d", path, w.Code, http.StatusBadRequest)
		}
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

// A method carrying a newline used to write a line of its own into the record
// of who tested what.
func TestRouteTestDoesNotLetTheCallerWriteTheLog(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine"})
	gateway, _ := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	var logged strings.Builder
	orig := log.Writer()
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(orig) })

	callTestRoute(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET\n2026/01/01 00:00:00 [route-test] user=admin FORGED","path":"/mine"}`)

	// One line, whatever the method carried.
	if lines := strings.Count(strings.TrimRight(logged.String(), "\n"), "\n"); lines != 0 {
		t.Errorf("the log took %d extra lines:\n%s", lines, logged.String())
	}
}

// The Admin API has answered a detail read flat as well as under "value", and
// a route that decodes to neither reads as one that matches nothing - which
// would refuse every test against such a gateway.
func TestRouteTestReadsAFlatAdminAnswer(t *testing.T) {
	flat := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/apisix/admin/routes/"+testRouteID) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"uri":"/mine","name":"mine"}`)
	}))
	t.Cleanup(flat.Close)
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	w := callTestRoute(t, owners, instanceFor(flat.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/mine"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want %d: body %s", w.Code, http.StatusOK, w.Body.String())
	}
	if len(*reached) != 1 {
		t.Errorf("the gateway saw %v", *reached)
	}
}

func TestRouteMatchesPath(t *testing.T) {
	for _, tt := range []struct {
		name  string
		route apisixRoute
		path  string
		want  bool
	}{
		{"exact", apisixRoute{URI: "/a"}, "/a", true},
		{"exact, another path", apisixRoute{URI: "/a"}, "/b", false},
		{"exact, a longer path", apisixRoute{URI: "/a"}, "/a/b", false},
		{"prefix", apisixRoute{URI: "/a/*"}, "/a/b/c", true},
		{"prefix, the parent path", apisixRoute{URI: "/a/*"}, "/a/", true},
		{"prefix, outside it", apisixRoute{URI: "/a/*"}, "/b/c", false},
		{"one of uris", apisixRoute{URIs: []string{"/a", "/b"}}, "/b", true},
		{"none of uris", apisixRoute{URIs: []string{"/a", "/b"}}, "/c", false},
		{"uri and uris together", apisixRoute{URI: "/a", URIs: []string{"/b"}}, "/b", true},
		// A route that names no path matches nothing here: it is not a licence
		// to send anything.
		{"no uri at all", apisixRoute{}, "/a", false},
		{"an empty entry", apisixRoute{URIs: []string{""}}, "", false},
		// APISIX's own uri forms, which a route is written in and the drawer
		// prefills verbatim.
		{"a parameter", apisixRoute{URI: "/user/:name"}, "/user/bob", true},
		{"a parameter, one segment only", apisixRoute{URI: "/user/:name"}, "/user/bob/x", false},
		{"a parameter, nothing in it", apisixRoute{URI: "/user/:name"}, "/user/", false},
		{"a parameter in the middle", apisixRoute{URI: "/user/:name/edit"}, "/user/bob/edit", true},
		{"a named catch-all", apisixRoute{URI: "/files/*path"}, "/files/a/b", true},
		{"a named catch-all, nothing under it", apisixRoute{URI: "/files/*path"}, "/files", false},
		{"a catch-all at the root", apisixRoute{URI: "/*"}, "/anything", true},
		// Storable, and not a licence to send anything: APISIX matches paths,
		// which begin with a slash.
		{"a bare star", apisixRoute{URI: "*"}, "/anything", false},
		{"a relative uri", apisixRoute{URI: "mine"}, "mine", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := routeMatchesPath(tt.route, tt.path); got != tt.want {
				t.Errorf("routeMatchesPath(%+v, %q) = %v, want %v", tt.route, tt.path, got, tt.want)
			}
		})
	}
}

// A developer who works for two teams may test a route of either, whichever
// team they have named: the team named narrows a list, not what they may reach
// (#301).
func TestRouteTestAllowsARouteOfAnyOfTheCallersTeams(t *testing.T) {
	both := &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam, otherTeam}}

	for _, named := range []string{"", myTeam, otherTeam} {
		adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/theirs"})
		gateway, reached := gatewayThatAnswers(t)
		owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: otherTeam}}

		w := callTestRouteForTeam(t, owners, instanceFor(adminAPI.URL, gateway.URL),
			models.RoleDeveloper, both,
			`{"route_id":"`+testRouteID+`","method":"GET","path":"/theirs"}`, named)

		if w.Code != http.StatusOK {
			t.Errorf("naming %q: status %d, want %d: body %s", named, w.Code, http.StatusOK, w.Body.String())
		}
		if len(*reached) != 1 {
			t.Errorf("naming %q: the gateway was sent %v, want one request", named, *reached)
		}
	}
}

// Naming a team that is not theirs is refused before anything is read or sent,
// even for a route of a team that is.
func TestRouteTestRefusesATeamTheCallerDoesNotHave(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/mine"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: myTeam}}

	w := callTestRouteForTeam(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam}},
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/mine"}`, otherTeam)

	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want %d: body %s", w.Code, http.StatusForbidden, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), teamNotAssignedCode) {
		t.Errorf("body %s, want the code %q", w.Body.String(), teamNotAssignedCode)
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v", *reached)
	}
}

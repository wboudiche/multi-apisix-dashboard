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
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// adminAPI serves fixed bodies by Admin API path; any other path is a 404.
// A body of "500" answers status 500.
func adminAPI(t *testing.T, bodies map[string]string) *models.Instance {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k" {
			t.Errorf("%s without the admin key", r.URL.Path)
		}
		body, ok := bodies[strings.TrimPrefix(r.URL.Path, "/apisix/admin")]
		switch {
		case !ok:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"Key not found"}`))
		case body == "500":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			_, _ = w.Write([]byte(body))
		}
	}))
	t.Cleanup(srv.Close)
	return &models.Instance{ID: "i1", AdminAPIURL: srv.URL, AdminKey: "k", IsActive: true}
}

func TestReadRoute(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name   string
		bodies map[string]string
		want   routeFacts
		err    bool
	}{
		{"wrapped", map[string]string{
			"/routes/r1": `{"key":"/apisix/routes/r1","value":{"id":"r1","host":"a.test","create_time":1700000000}}`,
		}, routeFacts{Hosts: []string{"a.test"}, CreateTime: 1700000000, Found: true}, false},
		{"flat", map[string]string{
			"/routes/r1": `{"id":"r1","hosts":["a.test","b.test"],"create_time":5}`,
		}, routeFacts{Hosts: []string{"a.test", "b.test"}, CreateTime: 5, Found: true}, false},
		{"service host", map[string]string{
			"/routes/r1":   `{"value":{"id":"r1","service_id":"s1","create_time":7}}`,
			"/services/s1": `{"value":{"id":"s1","host":"svc.test"}}`,
		}, routeFacts{Hosts: []string{"svc.test"}, CreateTime: 7, Found: true}, false},
		{"service hosts, numeric id", map[string]string{
			"/routes/r1":  `{"value":{"id":"r1","service_id":2,"create_time":7}}`,
			"/services/2": `{"value":{"id":"2","hosts":["x.test","y.test"]}}`,
		}, routeFacts{Hosts: []string{"x.test", "y.test"}, CreateTime: 7, Found: true}, false},
		{"service gone", map[string]string{
			"/routes/r1": `{"value":{"id":"r1","service_id":"s1","create_time":7}}`,
		}, routeFacts{Hosts: []string{}, CreateTime: 7, Found: true}, false},
		{"service read fails", map[string]string{
			"/routes/r1":   `{"value":{"id":"r1","service_id":"s1","create_time":7}}`,
			"/services/s1": "500",
		}, routeFacts{}, true},
		{"route 404", map[string]string{}, routeFacts{}, false},
		{"route 500", map[string]string{"/routes/r1": "500"}, routeFacts{}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := readRoute(ctx, adminAPI(t, tc.bodies), "r1")
			if (err != nil) != tc.err {
				t.Fatalf("err = %v, want error %v", err, tc.err)
			}
			if got.Found != tc.want.Found || got.CreateTime != tc.want.CreateTime ||
				strings.Join(got.Hosts, ",") != strings.Join(tc.want.Hosts, ",") {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestListInstanceRoutes(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name string
		body string
		ids  string
		err  bool
	}{
		{"array", `{"total":2,"list":[{"key":"/apisix/routes/r1","value":{"id":"r1"}},{"value":{"id":"r2"}}]}`, "r1,r2", false},
		// APISIX answers an empty collection with an object, not an array.
		{"empty object", `{"total":0,"list":{}}`, "", false},
		{"empty array", `{"total":0,"list":[]}`, "", false},
		{"entry without value", `{"list":[{"key":"x"},{"value":{"id":"r2"}}]}`, "r2", false},
		{"null list", `{"list":null}`, "", true},
		{"no list", `{"total":0}`, "", true},
		{"string list", `{"list":"x"}`, "", true},
		{"non-empty object list", `{"list":{"a":1}}`, "", true},
		{"status 500", "500", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := listInstanceRoutes(ctx, adminAPI(t, map[string]string{"/routes": tc.body}))
			if (err != nil) != tc.err {
				t.Fatalf("err = %v, want error %v", err, tc.err)
			}
			if tc.err {
				return
			}
			if got == nil {
				t.Fatal("nil slice for a readable list")
			}
			ids := []string{}
			for _, r := range got {
				ids = append(ids, r["id"].(string))
			}
			if strings.Join(ids, ",") != tc.ids {
				t.Fatalf("ids %v, want %s", ids, tc.ids)
			}
		})
	}
}

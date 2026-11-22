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
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestStripDashboardFields(t *testing.T) {
	tests := []struct {
		name string
		body string
		// want is compared after decoding, so key order does not matter.
		want map[string]any
	}{
		{
			name: "removes the injected team id",
			body: `{"uri":"/test","name":"test","__team_id":"team-1"}`,
			want: map[string]any{"uri": "/test", "name": "test"},
		},
		{
			name: "removes an empty team id",
			body: `{"uri":"/test","__team_id":""}`,
			want: map[string]any{"uri": "/test"},
		},
		{
			name: "removes any dashboard-prefixed key",
			body: `{"uri":"/test","__team_id":"t","__future":1}`,
			want: map[string]any{"uri": "/test"},
		},
		{
			name: "leaves an untouched body alone",
			body: `{"uri":"/test","name":"test"}`,
			want: map[string]any{"uri": "/test", "name": "test"},
		},
		{
			name: "does not touch lookalike keys",
			body: `{"uri":"/test","_team_id":"keep","team__id":"keep"}`,
			want: map[string]any{"uri": "/test", "_team_id": "keep", "team__id": "keep"},
		},
		{
			// The strip is deliberately shallow: it only has to undo the
			// proxy's own top-level injection. Pinned here so the limitation is
			// a decision rather than an accident — the frontend's equivalent
			// (rmDoubleUnderscoreKeys) does recurse.
			name: "leaves a nested dashboard-prefixed key alone",
			body: `{"uri":"/test","__team_id":"t","upstream":{"__team_id":"nested"}}`,
			want: map[string]any{
				"uri":      "/test",
				"upstream": map[string]any{"__team_id": "nested"},
			},
		},
		{
			name: "preserves nested structures",
			body: `{"uri":"/test","__team_id":"t","upstream":{"nodes":{"a:80":1}},"labels":{"env":"prod"}}`,
			want: map[string]any{
				"uri":      "/test",
				"upstream": map[string]any{"nodes": map[string]any{"a:80": float64(1)}},
				"labels":   map[string]any{"env": "prod"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripDashboardFields([]byte(tt.body))

			var decoded map[string]any
			if err := json.Unmarshal(got, &decoded); err != nil {
				t.Fatalf("result is not valid JSON: %v (got %q)", err, got)
			}

			wantJSON, _ := json.Marshal(tt.want)
			gotJSON, _ := json.Marshal(decoded)
			if string(gotJSON) != string(wantJSON) {
				t.Errorf("stripDashboardFields(%s)\n got: %s\nwant: %s", tt.body, gotJSON, wantJSON)
			}
		})
	}
}

// A body this function cannot read as a JSON object is forwarded byte-for-byte.
// The proxy is not the schema validator here — rewriting or rejecting a payload
// it does not understand would corrupt requests APISIX may well accept, and
// APISIX's own error is a better one than anything the proxy could invent.
func TestStripDashboardFieldsPassesThroughNonObjects(t *testing.T) {
	passthrough := []string{
		"",
		"null",
		"[1,2,3]",
		`"a string"`,
		"not json at all",
		`{"unterminated":`,
	}

	for _, body := range passthrough {
		t.Run(body, func(t *testing.T) {
			got := stripDashboardFields([]byte(body))
			if string(got) != body {
				t.Errorf("stripDashboardFields(%q) = %q, want it unchanged", body, got)
			}
		})
	}
}

// Numbers must survive the strip's decode/re-encode round trip exactly. Decoding
// into map[string]any without UseNumber turns them into float64, which silently
// rewrites large integers.
func TestStripDashboardFieldsPreservesNumberPrecision(t *testing.T) {
	body := `{"id":9007199254740993,"count":10,"ratio":1.5,"__team_id":"t"}`

	got := string(stripDashboardFields([]byte(body)))

	for _, want := range []string{`"id":9007199254740993`, `"count":10`, `"ratio":1.5`} {
		if !strings.Contains(got, want) {
			t.Errorf("stripDashboardFields(%s) = %s, want it to contain %s", body, got, want)
		}
	}
	if strings.Contains(got, "__team_id") {
		t.Errorf("stripDashboardFields(%s) = %s, want __team_id removed", body, got)
	}
}

func TestStripRouteTimestamps(t *testing.T) {
	cases := []struct {
		name, body, want string
	}{
		{"both removed", `{"uri":"/a","create_time":1,"update_time":2}`, `{"uri":"/a"}`},
		{"create only", `{"uri":"/a","create_time":5}`, `{"uri":"/a"}`},
		{"nested kept", `{"uri":"/a","plugins":{"x":{"create_time":3}}}`, `{"uri":"/a","plugins":{"x":{"create_time":3}}}`},
		{"none", `{"uri":"/a"}`, `{"uri":"/a"}`},
		{"big id exact", `{"id":9007199254740993,"create_time":1}`, `{"id":9007199254740993}`},
	}
	for _, tc := range cases {
		got, err := stripRouteTimestamps([]byte(tc.body))
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		var g, w any
		if json.Unmarshal(got, &g) != nil || json.Unmarshal([]byte(tc.want), &w) != nil || !reflect.DeepEqual(g, w) {
			t.Errorf("%s: got %s want %s", tc.name, got, tc.want)
		}
	}
	for _, body := range []string{``, `[1]`, `"x"`, `null`, `{bad`, `42`} {
		got, err := stripRouteTimestamps([]byte(body))
		if err != nil || string(got) != body {
			t.Errorf("%q: got %q err %v, want it untouched", body, got, err)
		}
	}
	// Unmodified bodies keep their exact bytes.
	in := `{ "uri" : "/a" }`
	if got, _ := stripRouteTimestamps([]byte(in)); string(got) != in {
		t.Errorf("rewrote a body with nothing to strip: %s", got)
	}
}

func TestStripsRouteTimestampsFor(t *testing.T) {
	cases := []struct {
		method, rtype, path string
		want                bool
	}{
		{"POST", "routes", "/routes", true},
		{"PUT", "routes", "/routes/r1", true},
		{"PATCH", "routes", "/routes/r1", true},
		{"PUT", "routes", "/routes", true},
		{"PATCH", "routes", "/routes/r1/uri", false},
		{"GET", "routes", "/routes/r1", false},
		{"DELETE", "routes", "/routes/r1", false},
		{"PUT", "services", "/services/s1", false},
		{"PUT", "stream_routes", "/stream_routes/s1", false},
	}
	for _, tc := range cases {
		if got := stripsRouteTimestampsFor(tc.method, tc.rtype, tc.path); got != tc.want {
			t.Errorf("%s %s: got %v want %v", tc.method, tc.path, got, tc.want)
		}
	}
}

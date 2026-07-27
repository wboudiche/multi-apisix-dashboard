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

// A body that is not a JSON object must be forwarded byte-for-byte: APISIX
// accepts non-object payloads on some endpoints, and rewriting them would
// corrupt the request.
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

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

// An instance that is not active cannot be proxied to at all — ProxyRequest
// answers 404 for one — so getting this wrong takes a gateway offline for
// every user of it. These pin the decoding, which is where the bug lived: as a
// plain bool, an absent is_active and an explicit false were the same value.

func TestUpdateInstanceRequestIsActiveDecoding(t *testing.T) {
	tests := []struct {
		name string
		body string
		// nil means "leave the stored value alone".
		want *bool
	}{
		{"absent leaves it alone", `{"name":"renamed"}`, nil},
		{"explicit null leaves it alone", `{"is_active":null}`, nil},
		{"explicit false disables", `{"is_active":false}`, boolPtr(false)},
		{"explicit true enables", `{"is_active":true}`, boolPtr(true)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req UpdateInstanceRequest
			if err := json.Unmarshal([]byte(tt.body), &req); err != nil {
				t.Fatalf("unmarshal %s: %v", tt.body, err)
			}
			assertBoolPtr(t, req.IsActive, tt.want)
		})
	}
}

// The rule the update handler applies: only an explicit value changes anything.
func TestUpdateInstanceIsActiveResolution(t *testing.T) {
	tests := []struct {
		name    string
		stored  bool
		request *bool
		want    bool
	}{
		{"absent keeps an active instance active", true, nil, true},
		{"absent keeps a disabled instance disabled", false, nil, false},
		{"explicit false disables an active instance", true, boolPtr(false), false},
		{"explicit true re-enables a disabled instance", false, boolPtr(true), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.stored
			if tt.request != nil {
				got = *tt.request
			}
			if got != tt.want {
				t.Errorf("stored=%v request=%v -> %v, want %v",
					tt.stored, tt.request, got, tt.want)
			}
		})
	}
}

// Creating is different from updating: there is no stored value to preserve,
// and an instance registered as inactive is unusable from the moment it exists.
func TestCreateInstanceIsActiveDefault(t *testing.T) {
	tests := []struct {
		name string
		body string
		want bool
	}{
		{"absent defaults to active", `{"name":"n","admin_api_url":"u","admin_key":"k"}`, true},
		{"explicit true is active", `{"is_active":true}`, true},
		{"explicit false is honoured", `{"is_active":false}`, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req CreateInstanceRequest
			if err := json.Unmarshal([]byte(tt.body), &req); err != nil {
				t.Fatalf("unmarshal %s: %v", tt.body, err)
			}
			got := req.IsActive == nil || *req.IsActive
			if got != tt.want {
				t.Errorf("body %s -> %v, want %v", tt.body, got, tt.want)
			}
		})
	}
}

func boolPtr(v bool) *bool { return &v }

func assertBoolPtr(t *testing.T, got, want *bool) {
	t.Helper()
	switch {
	case got == nil && want == nil:
	case got == nil || want == nil:
		t.Errorf("got %v, want %v", fmtBoolPtr(got), fmtBoolPtr(want))
	case *got != *want:
		t.Errorf("got %v, want %v", *got, *want)
	}
}

func fmtBoolPtr(v *bool) string {
	if v == nil {
		return "nil"
	}
	if *v {
		return "true"
	}
	return "false"
}

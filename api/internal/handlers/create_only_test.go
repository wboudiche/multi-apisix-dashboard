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
	"testing"
)

// APISIX's PUT is an upsert, so an "Add" form that PUTs a name the user already
// used replaces the existing record and reports success. The Add flows say they
// mean to create by sending If-None-Match: *, the standard way to ask that a
// request apply only when nothing is there.
func TestCreateOnlyRequested(t *testing.T) {
	tests := []struct {
		name        string
		method      string
		ifNoneMatch string
		want        bool
	}{
		{"add flow", http.MethodPut, "*", true},
		{"add flow with padding", http.MethodPut, "  *  ", true},
		// An edit sends no such header and must keep overwriting - that is what
		// editing is.
		{"edit flow", http.MethodPut, "", false},
		// A specific etag is a different precondition and not ours to enforce;
		// leave it to APISIX rather than guessing.
		{"specific etag", http.MethodPut, `"abc123"`, false},
		// Creating by POST already cannot collide: APISIX assigns the id.
		{"post", http.MethodPost, "*", false},
		{"patch", http.MethodPatch, "*", false},
		{"delete", http.MethodDelete, "*", false},
		{"get", http.MethodGet, "*", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := createOnlyRequested(tt.method, tt.ifNoneMatch); got != tt.want {
				t.Errorf("createOnlyRequested(%q, %q) = %v, want %v",
					tt.method, tt.ifNoneMatch, got, tt.want)
			}
		})
	}
}

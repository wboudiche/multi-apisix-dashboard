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

import "testing"

// A PUT addressed to a collection names its resource in the body — the
// username for a consumer, the id for everything else — and APISIX writes it
// there. The proxy read the id from the path only, so such a PUT went through
// none of the checks that need one: an Add refused for an id already taken,
// and a non-admin's write to another team's resource (#191).
func TestCollectionPutID(t *testing.T) {
	tests := []struct {
		name         string
		resourceType string
		body         string
		want         string
		wantErr      bool
	}{
		{"a consumer, by username", "consumers", `{"username":"jack","desc":"x"}`, "jack", false},
		{"a consumer, by username and not by id", "consumers", `{"id":"nope","username":"jack"}`, "jack", false},
		{"a route, by id", "routes", `{"id":"r1","uri":"/x"}`, "r1", false},
		{"a numeric id, digit for digit", "upstreams", `{"id":12345678901234567890}`, "12345678901234567890", false},
		{"no id", "routes", `{"uri":"/x"}`, "", false},
		{"an empty id", "routes", `{"id":""}`, "", false},
		{"a consumer with no username", "consumers", `{"desc":"x"}`, "", false},
		{"an id that is neither a string nor a number", "routes", `{"id":{"a":1}}`, "", false},
		{"not a JSON object", "routes", `["r1"]`, "", false},
		{"malformed", "routes", `{"id":`, "", false},
		{"an empty body", "routes", ``, "", false},
		// An id naming another path must not be checked as if it named this one.
		{"an id with a slash", "routes", `{"id":"../ssls/s1"}`, "", true},
		{"a username with a slash", "consumers", `{"username":"a/b"}`, "", true},
		{"dot-dot", "services", `{"id":".."}`, "", true},
		{"dot", "services", `{"id":"."}`, "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := collectionPutID(tt.resourceType, []byte(tt.body))
			if (err != nil) != tt.wantErr {
				t.Fatalf("collectionPutID(%q, %s) error = %v, want error %v", tt.resourceType, tt.body, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("collectionPutID(%q, %s) = %q, want %q", tt.resourceType, tt.body, got, tt.want)
			}
		})
	}
}

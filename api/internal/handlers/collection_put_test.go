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
//
// What the checks look at has to be the key APISIX will write, so anything
// that APISIX might key differently from how it reads here is refused rather
// than guessed at.
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
		{"a username with a dash and an underscore", "consumers", `{"username":"a-b_c"}`, "a-b_c", false},
		{"a route, by id", "routes", `{"id":"r1","uri":"/x"}`, "r1", false},
		{"an id with a dot, a dash and an underscore", "routes", `{"id":"r.1-a_b"}`, "r.1-a_b", false},
		{"a plain integer id", "upstreams", `{"id":42}`, "42", false},
		{"no id", "routes", `{"uri":"/x"}`, "", false},
		{"an empty id", "routes", `{"id":""}`, "", false},
		{"a consumer with no username", "consumers", `{"desc":"x"}`, "", false},
		{"an empty body", "routes", ``, "", false},

		// APISIX keys a number by its value: 2.0 is written to /2, 1e2 to
		// /100, and past 14 digits to an exponent form.
		{"a fractional form of an integer", "routes", `{"id":2.0}`, "", true},
		{"an exponent", "routes", `{"id":1e2}`, "", true},
		{"more digits than APISIX keeps", "upstreams", `{"id":12345678901234567890}`, "", true},
		{"zero", "routes", `{"id":0}`, "", true},
		{"a negative number", "routes", `{"id":-1}`, "", true},

		// Characters outside what APISIX accepts, and ids naming another path.
		{"an id with a space", "routes", `{"id":"a b"}`, "", true},
		{"an id with a question mark", "routes", `{"id":"a?b"}`, "", true},
		{"a username with a dot", "consumers", `{"username":"jack.o"}`, "", true},
		{"an id with a slash", "routes", `{"id":"../ssls/s1"}`, "", true},
		{"a username with a slash", "consumers", `{"username":"a/b"}`, "", true},
		{"dot-dot", "services", `{"id":".."}`, "", true},
		{"dot", "services", `{"id":"."}`, "", true},

		// A body this cannot read is refused, not waved through: a parser that
		// read it differently could find an id here that this did not.
		{"an id that is neither a string nor a number", "routes", `{"id":{"a":1}}`, "", true},
		{"a boolean id", "routes", `{"id":true}`, "", true},
		{"not a JSON object", "routes", `["r1"]`, "", true},
		{"malformed", "routes", `{"id":`, "", true},
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

// APISIX collapses an empty path segment, so /routes//r1 is written as
// /routes/r1; read segment by segment, it named no resource at all and went
// through none of the checks that need one (#191).
func TestInvalidProxyPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/routes", false},
		{"/routes/r1", false},
		{"/routes/", false},
		{"/consumers/jack/credentials/c1", false},
		{"/", false},
		{"/routes//r1", true},
		{"/consumers//jack/credentials", true},
		{"/routes/../ssls/s1", true},
		{"/routes/./r1", true},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := invalidProxyPath(tt.path); got != tt.want {
				t.Errorf("invalidProxyPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

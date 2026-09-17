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
	"net/url"
	"testing"
)

// The parameters a route test carries reach the gateway, escaped, beside
// whatever its path already asked for (#256).
func TestQueryFor(t *testing.T) {
	cases := []struct {
		name     string
		rawQuery string
		query    map[string]string
		want     string
	}{
		{"none", "", nil, ""},
		{"empty", "", map[string]string{}, ""},
		{"one", "", map[string]string{"answer": "42"}, "answer=42"},
		{"sorted by key", "", map[string]string{"b": "2", "a": "1"}, "a=1&b=2"},
		{"escaped", "", map[string]string{"q": "a b&c=d#e"}, "q=a+b%26c%3Dd%23e"},
		{"empty value kept", "", map[string]string{"flag": ""}, "flag="},
		{"empty key dropped", "", map[string]string{"": "x", "k": "v"}, "k=v"},
		{"kept from the path", "a=1", map[string]string{"b": "2"}, "a=1&b=2"},
		{"path alone", "a=1&b=2", nil, "a=1&b=2"},
		{"parameter replaces the path's", "answer=1", map[string]string{"answer": "42"}, "answer=42"},
	}
	for _, c := range cases {
		existing, err := url.ParseQuery(c.rawQuery)
		if err != nil {
			t.Fatalf("%s: unreadable path query %q: %v", c.name, c.rawQuery, err)
		}
		if got := queryFor(existing, c.query); got != c.want {
			t.Errorf("%s: queryFor(%q, %v) = %q, want %q", c.name, c.rawQuery, c.query, got, c.want)
		}
	}
}

// The wire shape the drawer sends: query as an object, which the request bound
// as a string and refused (#256).
func TestTestRouteRequestReadsQueryAsAnObject(t *testing.T) {
	var req TestRouteRequest

	err := json.Unmarshal(
		[]byte(`{"method":"GET","path":"/x","query":{"answer":"42"},"headers":{"X-E2E":"1"}}`),
		&req,
	)

	if err != nil {
		t.Fatalf("the drawer's own body did not read: %v", err)
	}
	if req.Query["answer"] != "42" {
		t.Errorf("query = %v, want answer=42", req.Query)
	}
}

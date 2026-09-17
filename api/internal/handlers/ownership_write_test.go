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
	"testing"
	"time"
)

type ctxKey struct{}

// A client that leaves once APISIX has the create must not cost the resource
// its owner (#214).
func TestOwnershipWriteContextOutlivesTheRequest(t *testing.T) {
	parent, cancelRequest := context.WithCancel(context.WithValue(context.Background(), ctxKey{}, "request"))
	ctx, cancel := ownershipWriteContext(parent)
	defer cancel()

	cancelRequest()

	if err := ctx.Err(); err != nil {
		t.Fatalf("the client leaving cancelled the ownership write: %v", err)
	}
	if got := ctx.Value(ctxKey{}); got != "request" {
		t.Fatalf("the request's values were lost: got %v", got)
	}
}

// Detached from the request, it is still bounded, so a stalled etcd cannot hold
// the handler indefinitely.
func TestOwnershipWriteContextIsBounded(t *testing.T) {
	ctx, cancel := ownershipWriteContext(context.Background())
	defer cancel()

	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("the ownership write has no deadline")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > ownershipWriteTimeout {
		t.Fatalf("deadline %v away, want within %v", remaining, ownershipWriteTimeout)
	}
}

// A delete removes the ownership record only for a path naming the resource
// itself. A consumer's credential is deleted under the consumer's path, which
// puts the consumer's name where an id would be (#248).
func TestNamesResourceItself(t *testing.T) {
	cases := map[string]bool{
		"/routes/r1":                      true,
		"/consumers/alice":                true,
		"/routes":                         false,
		"/consumers/alice/credentials/c1": false,
		"/secrets/vault/s1":               false,
	}
	for path, want := range cases {
		if got := namesResourceItself(path); got != want {
			t.Errorf("namesResourceItself(%q) = %v, want %v", path, got, want)
		}
	}
}

// A write beneath a resource is checked against the resource and never records
// ownership for it: a consumer's credential reads as the consumer (#250).
func TestBeneathResource(t *testing.T) {
	cases := map[string]bool{
		"/consumers":                      false,
		"/consumers/alice":                false,
		"/consumers/alice/credentials":    true,
		"/consumers/alice/credentials/c1": true,
	}
	for path, want := range cases {
		if got := beneathResource(path); got != want {
			t.Errorf("beneathResource(%q) = %v, want %v", path, got, want)
		}
	}
}

// A write deeper than <type>/<id> is refused unless the Admin API has a
// resource there; reads are not (#250).
func TestDeepWriteRefused(t *testing.T) {
	cases := []struct {
		method, path string
		refused      bool
	}{
		{"PUT", "/routes/r1", false},
		{"PUT", "/routes/r1/x", true},
		{"DELETE", "/routes/r1/x", true},
		{"POST", "/upstreams/u1/nodes", true},
		{"PUT", "/consumers/alice/credentials/c1", false},
		{"DELETE", "/consumers/alice/credentials/c1", false},
		{"PUT", "/consumers/alice/credentials/c1/x", true},
		{"PUT", "/consumers/alice/plugins", true},
		{"PUT", "/secrets/vault/s1", false},
		{"PUT", "/secrets/vault/s1/x", true},
		{"GET", "/schema/plugins/key-auth", false},
	}
	for _, c := range cases {
		if got := deepWriteRefused(c.method, c.path); got != c.refused {
			t.Errorf("deepWriteRefused(%s %q) = %v, want %v", c.method, c.path, got, c.refused)
		}
	}
}

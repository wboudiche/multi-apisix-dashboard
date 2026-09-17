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
		"/admin/routes/r1":                      true,
		"/routes/r1":                            true,
		"/admin/consumers/alice":                true,
		"/admin/routes":                         false,
		"/admin/consumers/alice/credentials/c1": false,
		"/consumers/alice/credentials/c1":       false,
		"/admin/plugin_metadata/key-auth/extra": false,
	}
	for path, want := range cases {
		if got := namesResourceItself(path); got != want {
			t.Errorf("namesResourceItself(%q) = %v, want %v", path, got, want)
		}
	}
}

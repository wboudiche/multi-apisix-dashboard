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

// A resource with no team is administrative territory: only an admin may see or
// change it until someone assigns it. A resource owned by another team is
// likewise off limits. Everything else a non-admin touches must be their own
// team's.
func TestNonAdminMayAccess(t *testing.T) {
	tests := []struct {
		name         string
		ownerTeamID  string
		callerTeamID string
		want         bool
	}{
		{"own team", "team-a", "team-a", true},
		{"another team", "team-b", "team-a", false},
		// The case this rule exists for: unowned is admin-only, even though the
		// caller does hold a team.
		{"unowned", "", "team-a", false},
		// A non-admin with no team of their own owns nothing and so may access
		// nothing — including unowned resources, which must not become a
		// shared free-for-all for teamless accounts.
		{"caller has no team, resource unowned", "", "", false},
		{"caller has no team, resource owned", "team-a", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := nonAdminMayAccess(tt.ownerTeamID, tt.callerTeamID); got != tt.want {
				t.Errorf("nonAdminMayAccess(owner=%q, caller=%q) = %v, want %v",
					tt.ownerTeamID, tt.callerTeamID, got, tt.want)
			}
		})
	}
}

// A write to a resource that carries no ownership record is ambiguous: it is
// either a create - a PUT to an id that does not exist yet, which is how
// consumers and consumer_groups are made, or a POST under a parent that does -
// or an attempt on a resource that exists without a team. Only the second is
// forbidden.
func TestUnownedWriteIsDeniedOnlyWhenTheResourceExists(t *testing.T) {
	tests := []struct {
		name       string
		exists     bool
		wantDenied bool
	}{
		{"creating a new resource is ordinary work", false, false},
		{"overwriting an existing unowned resource is not", true, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unownedWriteDenied(tt.exists); got != tt.wantDenied {
				t.Errorf("unownedWriteDenied(exists=%v) = %v, want %v",
					tt.exists, got, tt.wantDenied)
			}
		})
	}
}

// Which requests are checked against the owner of the resource they name.
//
// The reasoning is with the predicate; what is pinned here is the answer for
// every method the router can present, so that narrowing it again - which is
// how POST came to be missing - has to be done deliberately.
func TestOwnershipIsCheckedForEveryWritingMethodThatNamesAResource(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		resourceID string
		want       bool
	}{
		{"POST naming a resource", http.MethodPost, "svc-1", true},
		{"PUT naming a resource", http.MethodPut, "svc-1", true},
		// PATCH is not routed today (cmd/main.go registers GET, POST, PUT and
		// DELETE), and the proxy still handles it in three other places. If it
		// is ever routed, it arrives already answered here.
		{"PATCH naming a resource", http.MethodPatch, "svc-1", true},
		{"DELETE naming a resource", http.MethodDelete, "svc-1", true},

		// A collection write names nothing to check against. A POST to
		// /routes creates, and what it creates is owned by its writer.
		{"POST to a collection", http.MethodPost, "", false},
		{"PUT to a collection", http.MethodPut, "", false},

		// Reads are filtered elsewhere: the list path applies the team filter,
		// and the detail path answers 403 for a resource the caller may not
		// see - a different mechanism with a different answer.
		{"GET naming a resource", http.MethodGet, "svc-1", false},
		{"HEAD naming a resource", http.MethodHead, "svc-1", false},

		// Anything else counts as changing the resource, which is the whole
		// point of asking "not a read" rather than listing methods.
		// OPTIONS never arrives - the CORS middleware answers it before the
		// router - and deepWriteRefused reads it the same way.
		{"OPTIONS naming a resource", http.MethodOptions, "svc-1", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ownershipChecked(tt.method, tt.resourceID); got != tt.want {
				t.Errorf("ownershipChecked(%q, %q) = %v, want %v",
					tt.method, tt.resourceID, got, tt.want)
			}
		})
	}
}

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
// either a PUT that creates something new (consumers and consumer_groups are
// created exactly this way, with a caller-supplied id) or an attempt on a
// resource that exists without a team. Only the second is forbidden.
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

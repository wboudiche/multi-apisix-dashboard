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

// Detaching a resource from its team and forgetting to name one are different
// requests with different outcomes, and both arrive as an empty string once a
// JSON body has been decoded into a plain string field. The pointer is what
// keeps them apart.
func TestOwnershipActionFor(t *testing.T) {
	str := func(s string) *string { return &s }

	tests := []struct {
		name   string
		teamID *string
		want   ownershipAction
	}{
		{"absent team_id is malformed", nil, ownershipInvalid},
		{"empty team_id detaches", str(""), ownershipDetach},
		{"named team assigns", str("team-1"), ownershipAssign},
		// Whitespace is a team id as far as this decision goes; it is not the
		// documented way to detach, and treating it as one would turn a typo
		// into a resource silently vanishing from every developer's list.
		{"whitespace is not a detach", str(" "), ownershipAssign},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ownershipActionFor(tt.teamID); got != tt.want {
				t.Errorf("ownershipActionFor(%v) = %v, want %v", tt.teamID, got, tt.want)
			}
		})
	}
}

// The handler decodes into *string precisely so that these three bodies are
// distinguishable. This pins the decoding half of that contract, which a plain
// string field would collapse: both `{}` and `{"team_id":""}` would yield "".
func TestReassignBodyDecoding(t *testing.T) {
	tests := []struct {
		name string
		body string
		want ownershipAction
	}{
		{"no field at all", `{}`, ownershipInvalid},
		{"explicit null", `{"team_id":null}`, ownershipInvalid},
		{"explicit empty string", `{"team_id":""}`, ownershipDetach},
		{"a team", `{"team_id":"backend"}`, ownershipAssign},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var decoded struct {
				TeamID *string `json:"team_id"`
			}
			if err := json.Unmarshal([]byte(tt.body), &decoded); err != nil {
				t.Fatalf("unmarshal %s: %v", tt.body, err)
			}
			if got := ownershipActionFor(decoded.TeamID); got != tt.want {
				t.Errorf("body %s produced %v, want %v", tt.body, got, tt.want)
			}
		})
	}
}

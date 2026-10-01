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

// Deleting a team looked at what it owned and at nothing else, so every
// assignment that named it went on naming it after it was gone (#375).
func TestTeamDeleteRefusal(t *testing.T) {
	cases := []struct {
		name      string
		owned     int
		members   int
		wantCode  string
		wantCount int
	}{
		{"nothing stands in the way", 0, 0, "", 0},
		{"it owns resources", 3, 0, teamOwnsResourcesCode, 3},
		{"an assignment names it", 0, 2, teamHasMembersCode, 2},
		// The resources first: they are what the refusal has always named, and
		// the operator clears one thing at a time either way.
		{"both", 3, 2, teamOwnsResourcesCode, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := teamDeleteRefusal(tc.owned, tc.members)
			if tc.wantCode == "" {
				if got != nil {
					t.Fatalf("refused with %+v, want the delete allowed", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("allowed, want a refusal with %q", tc.wantCode)
			}
			if got.Code != tc.wantCode || got.Count != tc.wantCount {
				t.Errorf("got code %q count %d, want %q %d", got.Code, got.Count, tc.wantCode, tc.wantCount)
			}
			if got.Error == "" {
				t.Error("a refusal with no sentence: a client that reads only `error` shows nothing")
			}
		})
	}
}

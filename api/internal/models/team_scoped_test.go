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

package models

import (
	"sort"
	"testing"
)

// The types a team owns are the ones a viewer sees only for their own teams
// (#455). The absences matter as much: global rules and plugin metadata apply
// to all of the gateway's traffic, and secrets need an ownership id of their
// own before they can join (/secrets/<manager>/<id> has two segments).
func TestTeamScopedResourcesAreTheTeamOwnedTypes(t *testing.T) {
	want := []string{
		"consumer_groups", "consumers", "plugin_configs", "protos", "routes",
		"services", "ssls", "stream_routes", "upstreams",
	}
	var got []string
	for resourceType, owned := range TeamScopedResources {
		if owned {
			got = append(got, resourceType)
		}
	}
	sort.Strings(got)
	if len(got) != len(want) {
		t.Fatalf("team-owned types = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("team-owned types = %v, want %v", got, want)
		}
	}

	for _, shared := range []string{"secrets", "global_rules", "plugin_metadata", "plugins", "labels"} {
		if TeamScopedResources[shared] {
			t.Errorf("%s must stay instance-wide, not team-owned", shared)
		}
	}
}

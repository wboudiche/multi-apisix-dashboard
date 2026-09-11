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

import "testing"

// The dashboard shows a Plugin Metadata page, and RolePermissions never
// mentioned plugin_metadata for any role — so every role but super_admin was
// refused it. An instance_admin, who administers the instance, was told "ask
// an admin if you need access" (#172).
//
// The omission is easy to make again: the table is a list of strings, and a
// resource missing from it fails closed and silently. This pins the whole
// matrix for that resource rather than just the line that was wrong.
func TestPluginMetadataPermissions(t *testing.T) {
	cases := []struct {
		role     string
		canRead  bool
		canWrite bool
	}{
		{RoleSuperAdmin, true, true},
		{RoleInstanceAdmin, true, true},
		{RoleViewer, true, false},
		// Deliberately not the developer's: the resource is instance-wide
		// configuration rather than a team's own objects, and the sidebar
		// stops offering it to them in the same change.
		{RoleDeveloper, false, false},
	}

	for _, tc := range cases {
		t.Run(tc.role, func(t *testing.T) {
			if got := HasResourcePermission(tc.role, "plugin_metadata", "read"); got != tc.canRead {
				t.Errorf("read: got %v, want %v", got, tc.canRead)
			}
			if got := HasResourcePermission(tc.role, "plugin_metadata", "write"); got != tc.canWrite {
				t.Errorf("write: got %v, want %v", got, tc.canWrite)
			}
		})
	}
}

// The plugin catalogue every plugin form reads. instance_admin was the only
// role without it: a viewer could list the plugins, the admin of the instance
// could not, so the Plugin Metadata page answered them 403 before it ever got
// to the metadata itself.
func TestPluginCatalogueIsReadableByEveryRole(t *testing.T) {
	for _, role := range []string{RoleSuperAdmin, RoleInstanceAdmin, RoleDeveloper, RoleViewer} {
		if !HasResourcePermission(role, "plugins", "read") {
			t.Errorf("%s may not read the plugin catalogue", role)
		}
	}
}

// The counterweight: adding a resource must not widen anything else. A viewer
// stays read-only and a developer stays out of instance-wide configuration.
func TestRolesKeepTheirBoundaries(t *testing.T) {
	for _, resource := range []string{"ssls", "global_rules", "secrets", "plugin_configs", "protos", "plugin_metadata"} {
		if HasResourcePermission(RoleViewer, resource, "write") {
			t.Errorf("viewer may write %s", resource)
		}
		if HasResourcePermission(RoleDeveloper, resource, "read") {
			t.Errorf("developer may read %s", resource)
		}
	}
}

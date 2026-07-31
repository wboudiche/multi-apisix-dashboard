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
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// A role recorded here that nothing honours is worse than a rejection: the
// assignment looks made, while HasResourcePermission denies every resource for
// an unrecognised role, so the user silently ends up able to do nothing.
func TestIsAssignableInstanceRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{models.RoleInstanceAdmin, true},
		{models.RoleDeveloper, true},
		{models.RoleViewer, true},
		// Global, read from the JWT and never narrowed by an instance
		// assignment — recording it per instance describes nothing real.
		{models.RoleSuperAdmin, false},
		{"", false},
		{"wizard", false},
		{"Developer", false},
		{" developer", false},
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			if got := isAssignableInstanceRole(tt.role); got != tt.want {
				t.Errorf("isAssignableInstanceRole(%q) = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}

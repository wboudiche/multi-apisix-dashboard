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
	"errors"
	"strings"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

func TestFilterAllowedInstances(t *testing.T) {
	all := []*models.Instance{
		{ID: "prod", Name: "Production"},
		{ID: "staging", Name: "Staging"},
		{ID: "dev", Name: "Dev"},
	}

	tests := []struct {
		name    string
		allowed map[string]bool
		want    []string
	}{
		{
			name:    "only the assigned instances come back",
			allowed: map[string]bool{"staging": true},
			want:    []string{"staging"},
		},
		{
			name:    "several assignments",
			allowed: map[string]bool{"prod": true, "dev": true},
			want:    []string{"prod", "dev"},
		},
		{
			// A user with no assignment must not learn that any gateway exists.
			name:    "no assignments yields nothing",
			allowed: map[string]bool{},
			want:    []string{},
		},
		{
			// An assignment naming an instance that no longer exists must not
			// resurrect it or panic.
			name:    "assignment to a deleted instance is ignored",
			allowed: map[string]bool{"gone": true},
			want:    []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := filterAllowedInstances(all, tt.allowed)

			ids := make([]string, 0, len(got))
			for _, instance := range got {
				ids = append(ids, instance.ID)
			}
			if strings.Join(ids, ",") != strings.Join(tt.want, ",") {
				t.Errorf("filterAllowedInstances() = %v, want %v", ids, tt.want)
			}
		})
	}
}

// The probe error embeds the Admin API host and port, which is exactly what a
// non-super_admin must not be able to read off this endpoint.
func TestHealthErrorDetail(t *testing.T) {
	probe := errors.New(
		`connection failed: Get "http://10.0.3.14:9180/apisix/admin/services": dial tcp: i/o timeout`)

	t.Run("super_admin sees the full reason", func(t *testing.T) {
		got := healthErrorDetail(probe, true)
		if got != probe.Error() {
			t.Errorf("healthErrorDetail(err, true) = %q, want the full error", got)
		}
	})

	t.Run("everyone else gets no address", func(t *testing.T) {
		got := healthErrorDetail(probe, false)

		for _, leak := range []string{"10.0.3.14", "9180", "http://", "/apisix/admin"} {
			if strings.Contains(got, leak) {
				t.Errorf("healthErrorDetail(err, false) = %q, want it to not contain %q", got, leak)
			}
		}
		if got == "" {
			t.Error("healthErrorDetail(err, false) = \"\", want a non-empty reason")
		}
	})

	t.Run("no error means no detail either way", func(t *testing.T) {
		if got := healthErrorDetail(nil, true); got != "" {
			t.Errorf("healthErrorDetail(nil, true) = %q, want %q", got, "")
		}
		if got := healthErrorDetail(nil, false); got != "" {
			t.Errorf("healthErrorDetail(nil, false) = %q, want %q", got, "")
		}
	})
}

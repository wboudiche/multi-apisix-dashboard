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

package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The overview counts what each gateway holds. A count it could not make must
// come back as unknown rather than as none: reported as zero, a gateway
// answering something this dashboard cannot read is shown connected and empty,
// which is what a healthy gateway with nothing on it looks like (#286).
//
// InstanceService.countAdminResource already draws that line for the delete
// path, in the same package.
func TestFetchResourceCountUnknownIsNotZero(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   int
	}{
		{
			name:   "a gateway that answers a total is counted",
			status: http.StatusOK,
			body:   `{"total":3,"list":[]}`,
			want:   3,
		},
		{
			name:   "a gateway that holds nothing counts zero",
			status: http.StatusOK,
			body:   `{"total":0,"list":{}}`,
			want:   0,
		},
		{
			// A port pointed at the wrong service, a proxy answering for
			// itself, an APISIX behind a portal: all answer 200, and none of
			// them is a gateway with no routes.
			name:   "something that is not the Admin API is unknown, not empty",
			status: http.StatusOK,
			body:   `{"ok":true,"message":"not an apisix admin api"}`,
			want:   -1,
		},
		{
			name:   "a body that is not JSON at all is unknown",
			status: http.StatusOK,
			body:   `<!DOCTYPE html><title>Gateway</title>`,
			want:   -1,
		},
		{
			name:   "a refusal is unknown",
			status: http.StatusUnauthorized,
			body:   `{"error_msg":"admin key required"}`,
			want:   -1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer gateway.Close()

			service := NewOverviewService(nil, nil)
			got := service.fetchResourceCount(
				context.Background(),
				&models.Instance{AdminAPIURL: gateway.URL},
				"/apisix/admin/routes",
			)
			if got != tc.want {
				t.Errorf("fetchResourceCount = %d, want %d", got, tc.want)
			}
		})
	}

	t.Run("a gateway that does not answer is unknown", func(t *testing.T) {
		gateway := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
		address := gateway.URL
		gateway.Close()

		service := NewOverviewService(nil, nil)
		got := service.fetchResourceCount(
			context.Background(),
			&models.Instance{AdminAPIURL: address},
			"/apisix/admin/routes",
		)
		if got != -1 {
			t.Errorf("fetchResourceCount = %d for a closed gateway, want -1", got)
		}
	})
}

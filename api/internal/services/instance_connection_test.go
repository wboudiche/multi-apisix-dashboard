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
	"strings"
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// The connection test is what an operator presses to find out whether the
// address they typed is the right one. Answering "connected" for anything that
// returns 2xx confirms the mistake it exists to catch (#288): the dashboard's
// own URL, a proxy answering for itself and a login portal all do.
func TestConnectionRequiresAnAdminAPIAnswer(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		contentType string
		body        string
		wantErr     bool
		wantMessage string
	}{
		{
			name:        "an Admin API answer connects",
			status:      http.StatusOK,
			contentType: "application/json",
			body:        `{"total":2,"list":[]}`,
		},
		{
			// A gateway with no services at all: a real answer, and the one a
			// fresh APISIX gives.
			name:        "a gateway holding nothing connects",
			status:      http.StatusOK,
			contentType: "application/json",
			body:        `{"total":0,"list":{}}`,
		},
		{
			// What the dashboard's own address answers: a single-page app
			// serves its index for any path it does not know.
			name:        "a page that is not the Admin API does not connect",
			status:      http.StatusOK,
			contentType: "text/html",
			body:        `<!doctype html><html lang="en"><head></head></html>`,
			wantErr:     true,
			wantMessage: "not as an APISIX Admin API",
		},
		{
			name:        "JSON that is not the Admin API does not connect",
			status:      http.StatusOK,
			contentType: "application/json",
			body:        `{"ok":true,"message":"hello"}`,
			wantErr:     true,
			wantMessage: "not as an APISIX Admin API",
		},
		{
			// Unchanged, and still the clearer message of the two: the gateway
			// said no, rather than said something else.
			name:        "a refusal still reports its status",
			status:      http.StatusUnauthorized,
			contentType: "application/json",
			body:        `{"error_msg":"admin key required"}`,
			wantErr:     true,
			wantMessage: "401",
		},
	}

	// A gateway answering more than the probe will read is one it cannot
	// check, which is not the same as one that failed the check - and saying
	// so is the difference between "look at your address" and "look at your
	// gateway".
	t.Run("an answer too long to read is said to be too long", func(t *testing.T) {
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"total":1,"list":[`))
			filler := strings.Repeat(`{"key":"/apisix/services/x"},`, 40000)
			_, _ = w.Write([]byte(filler))
		}))
		defer gateway.Close()

		err := NewInstanceService(nil).TestConnection(
			context.Background(),
			&models.Instance{AdminAPIURL: gateway.URL},
		)
		if err == nil {
			t.Fatalf("TestConnection accepted an answer it could not read whole")
		}
		if !strings.Contains(err.Error(), "too large to check") {
			t.Errorf("error %q does not say the answer was too large", err)
		}
	})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/apisix/admin/services" {
					t.Errorf("probed %q, want /apisix/admin/services", r.URL.Path)
				}
				// Paged, so that the answer is small whatever the gateway
				// holds: an unpaged probe downloaded every service, and a long
				// one came back truncated and read as malformed.
				if r.URL.Query().Get("page_size") == "" {
					t.Errorf("probed without a page size: %q", r.URL.RawQuery)
				}
				w.Header().Set("Content-Type", tc.contentType)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer gateway.Close()

			err := NewInstanceService(nil).TestConnection(
				context.Background(),
				&models.Instance{AdminAPIURL: gateway.URL},
			)

			if tc.wantErr && err == nil {
				t.Fatalf("TestConnection accepted a gateway answering %q", tc.body)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("TestConnection refused an Admin API answer: %v", err)
			}
			if tc.wantErr && !strings.Contains(err.Error(), tc.wantMessage) {
				t.Errorf("error %q does not say %q", err, tc.wantMessage)
			}
		})
	}
}

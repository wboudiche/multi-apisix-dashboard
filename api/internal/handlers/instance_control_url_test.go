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

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// An instance can say where its gateway serves the Control API, which is how
// upstream health will be read (#281). It is optional: APISIX binds it to
// loopback by default, so most gateways do not expose one, and that is not an
// error.
func TestInstanceControlAPIURL(t *testing.T) {
	t.Run("an update leaves an address it was not given alone", func(t *testing.T) {
		instance := &models.Instance{ControlAPIURL: "http://gw:9090"}
		var req UpdateInstanceRequest
		if err := json.Unmarshal([]byte(`{"name":"renamed"}`), &req); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}

		applyControlAPIURL(instance, req.ControlAPIURL)

		if instance.ControlAPIURL != "http://gw:9090" {
			t.Errorf("control_api_url = %q, want it untouched by an update that "+
				"did not mention it", instance.ControlAPIURL)
		}
	})

	// The reason for a pointer. A gateway can stop exposing its control API -
	// a port closed, an address moved - and the record has to be able to say
	// so. With a plain string an empty value is indistinguishable from an
	// omitted one, which is why gateway_url next to it cannot be cleared at
	// all.
	t.Run("an empty address clears the one held", func(t *testing.T) {
		instance := &models.Instance{ControlAPIURL: "http://gw:9090"}
		var req UpdateInstanceRequest
		if err := json.Unmarshal([]byte(`{"control_api_url":""}`), &req); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}

		applyControlAPIURL(instance, req.ControlAPIURL)

		if instance.ControlAPIURL != "" {
			t.Errorf("control_api_url = %q, want it cleared", instance.ControlAPIURL)
		}
	})

	t.Run("a new address replaces the one held", func(t *testing.T) {
		instance := &models.Instance{ControlAPIURL: "http://gw:9090"}
		var req UpdateInstanceRequest
		if err := json.Unmarshal([]byte(`{"control_api_url":"http://other:9090"}`), &req); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}

		applyControlAPIURL(instance, req.ControlAPIURL)

		if instance.ControlAPIURL != "http://other:9090" {
			t.Errorf("control_api_url = %q, want the new address", instance.ControlAPIURL)
		}
	})
}

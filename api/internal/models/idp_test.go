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

func TestIdentityProviderLinkedTo(t *testing.T) {
	idp := IdentityProvider{InstanceIDs: []string{"inst-a", "inst-b"}}
	if !idp.LinkedTo("inst-a") {
		t.Error("LinkedTo(inst-a) = false, want true for a linked instance")
	}
	if idp.LinkedTo("inst-c") {
		t.Error("LinkedTo(inst-c) = true, want false for an unlinked instance")
	}
	empty := IdentityProvider{}
	if empty.LinkedTo("inst-a") {
		t.Error("LinkedTo on an empty list = true, want false")
	}
}

func TestIdPClientKey(t *testing.T) {
	if got, want := IdPClientKey("kc1", "u-1"), "/idp_clients/kc1/u-1"; got != want {
		t.Errorf("IdPClientKey = %q, want %q", got, want)
	}
}

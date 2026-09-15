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

package config

import (
	"reflect"
	"testing"
)

func TestParseEnvList(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "unset falls back to the default", value: "", want: []string{"http://localhost:2379"}},
		{name: "single value", value: "http://etcd:2379", want: []string{"http://etcd:2379"}},
		{
			name:  "comma list with spaces and a trailing comma",
			value: "http://a:2379, http://b:2379 ,,http://c:2379,",
			want:  []string{"http://a:2379", "http://b:2379", "http://c:2379"},
		},
		{name: "only separators falls back to the default", value: " , ", want: []string{"http://localhost:2379"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_ENDPOINTS", tc.value)
			got := parseEnvList("TEST_ENDPOINTS", "http://localhost:2379")
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseEnvList(%q) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}

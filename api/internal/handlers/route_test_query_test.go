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
)

// The parameters a route test carries reach the gateway, escaped, in the order
// a query string is read back in (#256).
func TestEncodeQuery(t *testing.T) {
	cases := []struct {
		name  string
		query map[string]string
		want  string
	}{
		{"none", nil, ""},
		{"empty", map[string]string{}, ""},
		{"one", map[string]string{"answer": "42"}, "answer=42"},
		{"sorted by key", map[string]string{"b": "2", "a": "1"}, "a=1&b=2"},
		{"escaped", map[string]string{"q": "a b&c=d#e"}, "q=a+b%26c%3Dd%23e"},
		{"empty value kept", map[string]string{"flag": ""}, "flag="},
		{"empty key dropped", map[string]string{"": "x", "k": "v"}, "k=v"},
	}
	for _, c := range cases {
		if got := encodeQuery(c.query); got != c.want {
			t.Errorf("%s: encodeQuery(%v) = %q, want %q", c.name, c.query, got, c.want)
		}
	}
}

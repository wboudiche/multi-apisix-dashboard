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
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

func codes(vs []Violation) map[string]bool {
	m := map[string]bool{}
	for _, v := range vs {
		m[v.Code] = true
	}
	return m
}

func TestValidatePassword(t *testing.T) {
	p := models.DefaultPasswordPolicy() // min 12, all classes required

	cases := []struct {
		name string
		pw   string
		want []string // expected violation codes
	}{
		{"valid", "Abcdef123!xyz", nil},
		{"too short", "Ab1!", []string{"min_length"}},
		{"no upper", "abcdef123!xyz", []string{"missing_uppercase"}},
		{"no lower", "ABCDEF123!XYZ", []string{"missing_lowercase"}},
		{"no digit", "Abcdefgh!xyzQ", []string{"missing_digit"}},
		{"no symbol", "Abcdef123xyzQ", []string{"missing_symbol"}},
		{"empty hits many", "", []string{"min_length", "missing_uppercase", "missing_lowercase", "missing_digit", "missing_symbol"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := codes(ValidatePassword(p, tc.pw, nil))
			for _, w := range tc.want {
				if !got[w] {
					t.Errorf("pw %q: expected violation %q, got %v", tc.pw, w, got)
				}
			}
			if len(tc.want) == 0 && len(got) != 0 {
				t.Errorf("pw %q: expected no violations, got %v", tc.pw, got)
			}
		})
	}
}

func TestValidatePasswordMaxLength(t *testing.T) {
	p := models.DefaultPasswordPolicy()
	p.MaxLength = 16
	long := "Abcdef123!xyzABCDEFG" // 20 chars
	if !codes(ValidatePassword(p, long, nil))["max_length"] {
		t.Errorf("expected max_length violation for over-long password")
	}
}

func TestValidatePasswordDisabledClasses(t *testing.T) {
	p := models.PasswordPolicy{MinLength: 4, MaxLength: 72} // no class requirements
	if vs := ValidatePassword(p, "abcd", nil); len(vs) != 0 {
		t.Errorf("expected no violations when classes disabled, got %v", vs)
	}
}

func TestSavePolicyRejectsInsane(t *testing.T) {
	s := &PolicyService{} // etcd not needed; validation happens before any write
	bad := []models.PasswordPolicy{
		{MinLength: 4, MaxLength: 72},   // below floor 8
		{MinLength: 12, MaxLength: 100}, // above bcrypt cap 72
		{MinLength: 40, MaxLength: 20},  // max < min
		{MinLength: 12, MaxLength: 72, HistoryDepth: -1},
	}
	for i, p := range bad {
		if err := s.validateConfig(p); err == nil {
			t.Errorf("case %d: expected error for insane policy %+v", i, p)
		}
	}
	if err := s.validateConfig(models.DefaultPasswordPolicy()); err != nil {
		t.Errorf("default policy should be valid, got %v", err)
	}
}

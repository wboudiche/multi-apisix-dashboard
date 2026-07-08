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
	"unicode"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// Violation is a single failed password rule. Code is a stable identifier the
// frontend localises; Params carries values for interpolation (e.g. the min).
type Violation struct {
	Code   string         `json:"code"`
	Params map[string]any `json:"params,omitempty"`
}

// ValidatePassword checks pw against the complexity rules in policy and returns
// every violation (not just the first). history is reserved for reuse checks in
// a later phase and is currently ignored.
func ValidatePassword(policy models.PasswordPolicy, pw string, history []string) []Violation {
	var vs []Violation

	if policy.MinLength > 0 && len([]rune(pw)) < policy.MinLength {
		vs = append(vs, Violation{Code: "min_length", Params: map[string]any{"min": policy.MinLength}})
	}
	if policy.MaxLength > 0 && len([]rune(pw)) > policy.MaxLength {
		vs = append(vs, Violation{Code: "max_length", Params: map[string]any{"max": policy.MaxLength}})
	}

	var hasUpper, hasLower, hasDigit, hasSymbol bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSymbol = true
		}
	}
	if policy.RequireUppercase && !hasUpper {
		vs = append(vs, Violation{Code: "missing_uppercase"})
	}
	if policy.RequireLowercase && !hasLower {
		vs = append(vs, Violation{Code: "missing_lowercase"})
	}
	if policy.RequireDigit && !hasDigit {
		vs = append(vs, Violation{Code: "missing_digit"})
	}
	if policy.RequireSymbol && !hasSymbol {
		vs = append(vs, Violation{Code: "missing_symbol"})
	}
	return vs
}

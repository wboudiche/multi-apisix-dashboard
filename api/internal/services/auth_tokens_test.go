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
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/config"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

func tokenService() *AuthService {
	return &AuthService{jwtCfg: config.JWTConfig{
		Secret:        "a-secret-of-at-least-thirty-two-bytes-long",
		AccessExpiry:  15 * time.Minute,
		RefreshExpiry: 7 * 24 * time.Hour,
	}}
}

// Two sessions opened in the same second - a login and the refresh right
// behind it, or two logins - are two tokens, not one issued twice: each
// carries an identifier of its own.
func TestTokensIssuedInTheSameSecondDiffer(t *testing.T) {
	s := tokenService()
	user := &models.User{ID: "u1", Username: "someone", Role: "viewer"}

	first, err := s.GenerateTokens(user)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.GenerateTokens(user)
	if err != nil {
		t.Fatal(err)
	}
	if first.AccessToken == second.AccessToken {
		t.Error("two access tokens issued for the same user are the same token")
	}
	if first.RefreshToken == second.RefreshToken {
		t.Error("two refresh tokens issued for the same user are the same token")
	}
}

func TestEveryTokenCarriesItsOwnIdentifier(t *testing.T) {
	s := tokenService()
	pair, err := s.GenerateTokens(&models.User{ID: "u1", Username: "someone", Role: "viewer"})
	if err != nil {
		t.Fatal(err)
	}
	access, err := s.ValidateToken(pair.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := s.ValidateToken(pair.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if access.ID == "" || refresh.ID == "" {
		t.Fatalf("jti missing: access %q, refresh %q", access.ID, refresh.ID)
	}
	if access.ID == refresh.ID {
		t.Error("the access and the refresh token share an identifier")
	}
}

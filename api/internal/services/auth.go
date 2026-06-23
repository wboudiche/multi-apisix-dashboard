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
	"encoding/json"
	"errors"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/config"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserNotFound       = errors.New("user not found")
	ErrUserExists         = errors.New("user already exists")
	ErrInvalidToken       = errors.New("invalid token")
	ErrTokenExpired       = errors.New("token expired")
)

// Token types distinguish a short-lived access token from a long-lived refresh
// token. Both are HS256-signed with the same secret, so without this claim a
// 7-day refresh token would be accepted anywhere an access token is — a
// privilege/lifetime escalation. The type is enforced at the point of use.
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

type AuthService struct {
	etcd       *EtcdClient
	jwtCfg     config.JWTConfig
	bcryptCost int
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type Claims struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

func NewAuthService(etcd *EtcdClient, cfg config.Config) *AuthService {
	return &AuthService{
		etcd:       etcd,
		jwtCfg:     cfg.JWT,
		bcryptCost: cfg.Security.BcryptCost,
	}
}

func (s *AuthService) HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), s.bcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func (s *AuthService) CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (s *AuthService) GenerateTokens(user *models.User) (*TokenPair, error) {
	now := time.Now()

	// Access token
	accessClaims := Claims{
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		TokenType: TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.jwtCfg.AccessExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString([]byte(s.jwtCfg.Secret))
	if err != nil {
		return nil, err
	}

	// Refresh token
	refreshClaims := Claims{
		UserID:    user.ID,
		Username:  user.Username,
		Role:      user.Role,
		TokenType: TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(s.jwtCfg.RefreshExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString([]byte(s.jwtCfg.Secret))
	if err != nil {
		return nil, err
	}

	return &TokenPair{
		AccessToken:  accessTokenString,
		RefreshToken: refreshTokenString,
		ExpiresIn:    int64(s.jwtCfg.AccessExpiry.Seconds()),
	}, nil
}

func (s *AuthService) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.jwtCfg.Secret), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// ValidateAccessToken validates a token and additionally requires it to be an
// access token, rejecting refresh tokens presented as bearer credentials.
func (s *AuthService) ValidateAccessToken(tokenString string) (*Claims, error) {
	claims, err := s.ValidateToken(tokenString)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != TokenTypeAccess {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

func (s *AuthService) RefreshTokens(refreshToken string) (*TokenPair, error) {
	claims, err := s.ValidateToken(refreshToken)
	if err != nil {
		return nil, err
	}
	// Only a refresh token may be exchanged for a new token pair; an access
	// token presented here is rejected.
	if claims.TokenType != TokenTypeRefresh {
		return nil, ErrInvalidToken
	}

	// Get user from etcd to ensure they still exist
	user, err := s.GetUser(context.Background(), claims.UserID)
	if err != nil {
		return nil, err
	}

	return s.GenerateTokens(user)
}

func (s *AuthService) GetUser(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	err := s.etcd.GetJSON(ctx, models.KeyPrefixUsers+userID, &user)
	if err != nil {
		return nil, err
	}
	if user.ID == "" {
		return nil, ErrUserNotFound
	}
	return &user, nil
}

func (s *AuthService) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	users, err := s.etcd.List(ctx, models.KeyPrefixUsers)
	if err != nil {
		return nil, err
	}

	for key, data := range users {
		var user models.User
		if err := json.Unmarshal(data, &user); err != nil {
			continue
		}
		if user.Username == username {
			return &user, nil
		}
		_ = key // suppress unused warning
	}

	return nil, ErrUserNotFound
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*TokenPair, error) {
	user, err := s.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	if !s.CheckPassword(password, user.PasswordHash) {
		return nil, ErrInvalidCredentials
	}

	return s.GenerateTokens(user)
}

func (s *AuthService) CreateUser(ctx context.Context, user *models.User) error {
	// Check if user exists
	existing, _ := s.GetUserByUsername(ctx, user.Username)
	if existing != nil {
		return ErrUserExists
	}

	return s.etcd.PutJSON(ctx, models.KeyPrefixUsers+user.ID, user)
}

func (s *AuthService) ListUsers(ctx context.Context) ([]*models.User, error) {
	usersData, err := s.etcd.List(ctx, models.KeyPrefixUsers)
	if err != nil {
		return nil, err
	}

	users := make([]*models.User, 0, len(usersData))
	for _, data := range usersData {
		var user models.User
		if err := json.Unmarshal(data, &user); err != nil {
			continue
		}
		users = append(users, &user)
	}

	return users, nil
}

func (s *AuthService) UpdateUser(ctx context.Context, user *models.User) error {
	return s.etcd.PutJSON(ctx, models.KeyPrefixUsers+user.ID, user)
}

func (s *AuthService) DeleteUser(ctx context.Context, userID string) error {
	return s.etcd.Delete(ctx, models.KeyPrefixUsers+userID)
}

func (s *AuthService) GetUserInstance(ctx context.Context, userID, instanceID string) (*models.UserInstance, error) {
	var ui models.UserInstance
	err := s.etcd.GetJSON(ctx, models.KeyPrefixUserInstances+userID+"/"+instanceID, &ui)
	if err != nil {
		return nil, err
	}
	if ui.UserID == "" {
		return nil, nil // Not found
	}
	return &ui, nil
}

func (s *AuthService) GetUserInstanceRole(ctx context.Context, userID, instanceID string) (string, error) {
	var ui models.UserInstance
	err := s.etcd.GetJSON(ctx, models.KeyPrefixUserInstances+userID+"/"+instanceID, &ui)
	if err != nil {
		return "", err
	}
	if ui.Role == "" {
		return "", nil // No role assigned
	}
	return ui.Role, nil
}

func (s *AuthService) SetUserInstanceRole(ctx context.Context, ui *models.UserInstance) error {
	return s.etcd.PutJSON(ctx, models.KeyPrefixUserInstances+ui.UserID+"/"+ui.InstanceID, ui)
}

func (s *AuthService) DeleteUserInstanceRole(ctx context.Context, userID, instanceID string) error {
	return s.etcd.Delete(ctx, models.KeyPrefixUserInstances+userID+"/"+instanceID)
}

func (s *AuthService) GetUserInstances(ctx context.Context, userID string) ([]*models.UserInstance, error) {
	uis, err := s.etcd.List(ctx, models.KeyPrefixUserInstances+userID+"/")
	if err != nil {
		return nil, err
	}

	result := make([]*models.UserInstance, 0, len(uis))
	for _, data := range uis {
		var ui models.UserInstance
		if err := json.Unmarshal(data, &ui); err != nil {
			continue
		}
		result = append(result, &ui)
	}

	return result, nil
}

// ListUsersByTeam returns all UserInstance records that belong to a given team
func (s *AuthService) ListUsersByTeam(ctx context.Context, teamID string) ([]*models.UserInstance, error) {
	resp, err := s.etcd.List(ctx, models.KeyPrefixUserInstances)
	if err != nil {
		return nil, err
	}
	var results []*models.UserInstance
	for _, data := range resp {
		var ui models.UserInstance
		if err := json.Unmarshal(data, &ui); err != nil {
			continue
		}
		if ui.TeamID == teamID {
			results = append(results, &ui)
		}
	}
	return results, nil
}

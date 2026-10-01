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
	"fmt"
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

func (s *AuthService) Login(ctx context.Context, username, password string) (*TokenPair, *models.User, error) {
	user, err := s.GetUserByUsername(ctx, username)
	if err != nil {
		return nil, nil, ErrInvalidCredentials
	}

	if !s.CheckPassword(password, user.PasswordHash) {
		return nil, nil, ErrInvalidCredentials
	}

	tokens, err := s.GenerateTokens(user)
	if err != nil {
		return nil, nil, err
	}
	return tokens, user, nil
}

func (s *AuthService) CreateUser(ctx context.Context, user *models.User) error {
	// Check if user exists
	// An id is the key this writes, and a record without one would be written at
	// the collection key itself - where the prefix scan that lists users finds
	// it, and where no delete can reach it.
	if user.ID == "" {
		return fmt.Errorf("user not created: no id")
	}
	existing, err := s.GetUserByUsername(ctx, user.Username)
	if err != nil && !errors.Is(err, ErrUserNotFound) {
		// A name that could not be checked is not a name that is free. Read
		// past, this wrote a second account under a name that already had one,
		// and which of the two answers a login is then the order of a map.
		return fmt.Errorf("user %s not created: the name could not be checked: %w", user.Username, err)
	}
	if existing != nil {
		return ErrUserExists
	}

	stampCreated(user, time.Now())
	// Written only if the id is free, in one operation: the check-then-write it
	// replaces let two creates carrying the same supplied id - an import, a
	// restore - both find it free, and the second date the first as new (#321).
	written, err := s.etcd.PutJSONIfAbsent(ctx, models.KeyPrefixUsers+user.ID, user)
	if err != nil {
		return err
	}
	if !written {
		return ErrUserExists
	}
	return nil
}

// stampCreated dates a record being written for the first time.
//
// It stamps here rather than in the caller because both callers - the Add User
// endpoint and the bootstrap admin - reach etcd through this service and
// neither set the dates, so every account was stored carrying Go's zero time.
// The Users page read it back as a real date and showed 01/01/1 (#300).
func stampCreated(user *models.User, now time.Time) {
	user.CreatedAt = models.NullTime(now)
	user.UpdatedAt = models.NullTime(now)
}

// stampUpdated moves UpdatedAt and leaves CreatedAt where it is.
//
// Every write after the first one - profile, global role, password change,
// password reset - loads the stored record first, so the creation date it
// carries is the real one. Accounts stored before this stamped anything keep a
// zero CreatedAt: their real date is gone, and inventing one here would hand
// the page a date nobody set, presented as if someone had.
func stampUpdated(user *models.User, now time.Time) {
	user.UpdatedAt = models.NullTime(now)
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
	// Every caller today loads the stored record first, so the creation date
	// arrives intact and there is nothing to read back. One built from a
	// request body would carry none - and rather than write that zero over a
	// real date for good, the record is read back for it, and a read that
	// fails stops the write instead of dating the account with nothing.
	if user.CreatedAt.IsZero() {
		// One read, on a record that has no date to hand back or a caller that
		// did not hand one: the price of not writing a zero over a real date.
		existing, err := s.GetUser(ctx, user.ID)
		if err != nil {
			return fmt.Errorf("user %s not updated: its stored record could not be read: %w", user.ID, err)
		}
		user.CreatedAt = existing.CreatedAt
	}
	stampUpdated(user, time.Now())
	return s.etcd.PutJSON(ctx, models.KeyPrefixUsers+user.ID, user)
}

// DeleteUser removes the user and every instance assignment it holds.
//
// Each assignment carries a role and a team, and left behind they kept a
// deleted user on every team it had been assigned to (#206). They go first:
// should the record then fail to go, the user is still listed and deleting it
// again finishes the job, where the other order would leave assignments that
// nothing lists and nothing can reach.
func (s *AuthService) DeleteUser(ctx context.Context, userID string) error {
	// The trailing slash keeps the prefix to this user's keys: not those of
	// every user whose id merely starts with this one, and, for an empty id,
	// none at all rather than every assignment there is.
	if err := s.etcd.DeletePrefix(ctx, models.KeyPrefixUserInstances+userID+"/"); err != nil {
		return fmt.Errorf("user %s not deleted: its instance assignments could not be removed: %w", userID, err)
	}
	if err := s.etcd.Delete(ctx, models.KeyPrefixUsers+userID); err != nil {
		return fmt.Errorf("user %s: its instance assignments are removed, but the user could not be: %w", userID, err)
	}
	return nil
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
	return assignmentsOfTeam(resp, teamID), nil
}

// assignmentsOfTeam picks, out of the stored assignments, those that hold
// teamID - as their only team or as one of several (#301). A record that does
// not decode is nobody's member.
func assignmentsOfTeam(records map[string][]byte, teamID string) []*models.UserInstance {
	var results []*models.UserInstance
	for _, data := range records {
		var ui models.UserInstance
		if err := json.Unmarshal(data, &ui); err != nil {
			continue
		}
		if ui.HasTeam(teamID) {
			results = append(results, &ui)
		}
	}
	return results
}

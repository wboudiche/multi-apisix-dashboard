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
	"net/http"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AuthHandler struct {
	authService   *services.AuthService
	teamService   *services.TeamService
	policyService *services.PolicyService
}

func NewAuthHandler(authService *services.AuthService, teamService *services.TeamService, policyService *services.PolicyService) *AuthHandler {
	return &AuthHandler{authService: authService, teamService: teamService, policyService: policyService}
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type CreateUserRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	// MustChangePassword is a pointer so "omitted" is distinguishable from
	// an explicit false: admin-created accounts default to a forced change.
	MustChangePassword *bool `json:"must_change_password"`
}

// resolveMustChangePassword applies the create-user default: a temporary
// password handed out by an admin must be changed unless explicitly opted
// out.
func resolveMustChangePassword(v *bool) bool {
	return v == nil || *v
}

type UpdateUserRequest struct {
	Email string `json:"email"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// Login handles user login
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tokens, user, err := h.authService.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token":         tokens.AccessToken,
		"refresh_token":        tokens.RefreshToken,
		"expires_in":           tokens.ExpiresIn,
		"must_change_password": user.MustChangePassword,
	})
}

// Refresh handles token refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tokens, err := h.authService.RefreshTokens(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid refresh token"})
		return
	}

	c.JSON(http.StatusOK, tokens)
}

// Logout handles user logout (client-side token discard)
func (h *AuthHandler) Logout(c *gin.Context) {
	// With JWT, logout is handled client-side
	// This endpoint can be used for logging or invalidation if needed
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// GetCurrentUser returns the current user's info
func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.authService.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	user.PasswordHash = ""

	// Prefer the role stored on the user record; fall back to the JWT claim
	// so that users created before role persistence was wired up still work.
	effectiveRole := user.Role
	if effectiveRole == "" {
		effectiveRole = middleware.GetRole(c)
	}

	resp := gin.H{
		"id":                   user.ID,
		"username":             user.Username,
		"email":                user.Email,
		"role":                 effectiveRole,
		"must_change_password": user.MustChangePassword,
	}

	instanceID := c.GetHeader("X-Instance-ID")
	if instanceID != "" {
		ui, err := h.authService.GetUserInstance(c.Request.Context(), userID, instanceID)
		if err == nil && ui != nil && ui.TeamID != "" {
			resp["team_id"] = ui.TeamID
			team, err := h.teamService.GetTeam(c.Request.Context(), ui.TeamID)
			if err == nil && team != nil {
				resp["team_name"] = team.Name
			}
		}
	}

	c.JSON(http.StatusOK, resp)
}

// CreateUser creates a new user (super_admin only)
func (h *AuthHandler) CreateUser(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// The global Role field is reserved for super_admin (or empty for users
	// whose effective role is entirely derived from per-instance assignments).
	// Anything else gets baked into the JWT and bypasses per-instance RBAC.
	if req.Role != "" && req.Role != models.RoleSuperAdmin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role: global role can only be super_admin or empty"})
		return
	}

	if violations, err := h.policyService.Validate(c.Request.Context(), req.Password, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load password policy"})
		return
	} else if len(violations) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Password does not meet policy", "violations": violations})
		return
	}

	// Hash password
	hash, err := h.authService.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := &models.User{
		ID:                 uuid.New().String(),
		Username:           req.Username,
		PasswordHash:       hash,
		Email:              req.Email,
		Role:               req.Role,
		MustChangePassword: resolveMustChangePassword(req.MustChangePassword),
	}

	if err := h.authService.CreateUser(c.Request.Context(), user); err != nil {
		if err == services.ErrUserExists {
			c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusCreated, user)
}

// ListUsers lists all users (super_admin only)
func (h *AuthHandler) ListUsers(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	users, err := h.authService.ListUsers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Remove password hashes
	for _, u := range users {
		u.PasswordHash = ""
	}

	c.JSON(http.StatusOK, users)
}

// UpdateUser updates a user
func (h *AuthHandler) UpdateUser(c *gin.Context) {
	userID := c.Param("id")
	currentUserID := middleware.GetUserID(c)
	role := middleware.GetRole(c)

	// Users can only update themselves unless they're super_admin
	if userID != currentUserID && role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var req UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.authService.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	user.Email = req.Email

	if err := h.authService.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusOK, user)
}

// DeleteUser deletes a user (super_admin only)
func (h *AuthHandler) DeleteUser(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	userID := c.Param("id")

	if err := h.authService.DeleteUser(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User deleted"})
}

// ChangePassword allows users to change their password
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.authService.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Verify old password
	if !h.authService.CheckPassword(req.OldPassword, user.PasswordHash) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid old password"})
		return
	}

	if violations, err := h.policyService.Validate(c.Request.Context(), req.NewPassword, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load password policy"})
		return
	} else if len(violations) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Password does not meet policy", "violations": violations})
		return
	}

	// Hash new password
	hash, err := h.authService.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user.PasswordHash = hash
	user.MustChangePassword = false
	if err := h.authService.UpdateUser(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
}

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

import (
	"encoding/json"
	"strings"
	"time"
)

// Instance represents an APISIX instance configuration
type Instance struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	AdminAPIURL string `json:"admin_api_url"` // e.g., http://localhost:9180
	AdminKey    string `json:"admin_key"`
	GatewayURL  string `json:"gateway_url"` // e.g., http://localhost:9080
	// Where this gateway serves APISIX's Control API, e.g.
	// http://localhost:9090. Optional, and empty for most gateways: APISIX
	// binds it to loopback inside the process by default, so exposing it is a
	// deliberate act. Health is read from it (#281), and a gateway without one
	// is a gateway whose health this dashboard cannot know - which is a
	// different thing from a gateway that is unwell.
	ControlAPIURL string   `json:"control_api_url"`
	IsActive      bool     `json:"is_active"`
	CreatedAt     NullTime `json:"created_at"`
	UpdatedAt     NullTime `json:"updated_at"`
}

// NullTime is a timestamp a record may not have.
//
// The zero time is no date: it is what a record written before the dates existed
// holds (#300), and what one written without a date holds now. It serializes as
// null, so that no consumer can read it as a date - as "0001-01-01T00:00:00Z"
// was read, leaving the trap for a sort, an export or a script to learn for
// itself (#321).
//
// The rule lives on the type rather than at each read, so that neither a read
// path that forgets a helper nor a write that hands over a zero can put the year
// 1 back. A year of 1 or less counts as no date however it is written, which is
// where src/utils/record-date.ts draws the same line: an offset can make a zero
// time read as year 1 in one place and year 0 in another.
type NullTime time.Time

// IsZero reports that there is no date here.
func (t NullTime) IsZero() bool {
	when := time.Time(t)
	return when.IsZero() || when.UTC().Year() <= 1
}

// Time is the date, which is only meaningful when IsZero is false.
func (t NullTime) Time() time.Time { return time.Time(t) }

func (t NullTime) MarshalJSON() ([]byte, error) {
	if t.IsZero() {
		return []byte("null"), nil
	}
	return json.Marshal(time.Time(t))
}

func (t *NullTime) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*t = NullTime{}
		return nil
	}
	var parsed time.Time
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	*t = NullTime(parsed)
	return nil
}

// User represents a dashboard user
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
	Email        string `json:"email"`
	Role         string `json:"role"` // super_admin only
	// MustChangePassword forces the user through a password change before
	// they can use the rest of the API; set on admin-created accounts,
	// cleared by ChangePassword. Records written before this field existed
	// unmarshal to false, so existing users are never forced.
	MustChangePassword bool     `json:"must_change_password"`
	CreatedAt          NullTime `json:"created_at"`
	UpdatedAt          NullTime `json:"updated_at"`
}

// Team represents a group of users
type Team struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Scope defines resource-level restrictions
type Scope struct {
	Tags         []string `json:"tags,omitempty"`
	PathPrefixes []string `json:"path_prefixes,omitempty"`
}

// UserInstance represents the role assignment between user and instance
type UserInstance struct {
	UserID     string
	InstanceID string
	// TeamIDs are the teams the user works for on this instance. For a
	// developer or a viewer they are the access boundary: what one of them
	// owns is what the user may see and change. An assignment held a single
	// team until #301, which left instance_admin as the only way to let
	// somebody work for two.
	TeamIDs []string
	Role    string // instance_admin, developer, viewer
	Scope   *Scope
}

// userInstanceJSON is the record as it is stored and sent.
//
// team_id is the shape from before the list. It is read, because every record
// written before #301 holds it and nothing rewrites them; and it is still
// written, as the first team of the list, for the dashboard that reads one
// team and for a binary rolled back to before the list - both then see a team
// the user does have.
type userInstanceJSON struct {
	UserID     string   `json:"user_id"`
	InstanceID string   `json:"instance_id"`
	TeamIDs    []string `json:"team_ids"`
	TeamID     string   `json:"team_id"`
	Role       string   `json:"role"`
	Scope      *Scope   `json:"scope,omitempty"`
}

// UnmarshalJSON reads the list, or the single team of a record that predates
// it. Where both are present the list is the one that counts.
func (ui *UserInstance) UnmarshalJSON(data []byte) error {
	var raw userInstanceJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	teams := raw.TeamIDs
	if len(teams) == 0 && raw.TeamID != "" {
		teams = []string{raw.TeamID}
	}
	*ui = UserInstance{
		UserID:     raw.UserID,
		InstanceID: raw.InstanceID,
		TeamIDs:    NormalizeTeamIDs(teams),
		Role:       raw.Role,
		Scope:      raw.Scope,
	}
	return nil
}

// MarshalJSON writes the list and, under the old name, its first team.
func (ui UserInstance) MarshalJSON() ([]byte, error) {
	teams := NormalizeTeamIDs(ui.TeamIDs)
	first := ""
	if len(teams) > 0 {
		first = teams[0]
	}
	return json.Marshal(userInstanceJSON{
		UserID:     ui.UserID,
		InstanceID: ui.InstanceID,
		TeamIDs:    teams,
		TeamID:     first,
		Role:       ui.Role,
		Scope:      ui.Scope,
	})
}

// HasTeam reports whether the user works for teamID on this instance. The
// empty id is no team, and nobody has it.
func (ui UserInstance) HasTeam(teamID string) bool {
	if teamID == "" {
		return false
	}
	for _, id := range ui.TeamIDs {
		if id == teamID {
			return true
		}
	}
	return false
}

// NormalizeTeamIDs returns the teams in the order given, without blanks or
// repeats. Never nil: the list is sent as [] rather than null.
func NormalizeTeamIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// TeamScopedResources are the APISIX resource types whose objects are owned by
// a team (tracked in the ownership store). Reads of these must be filtered to
// the caller's team for non-admins. Catalog endpoints like plugins/labels are
// not team-owned and are intentionally excluded so they are never filtered.
var TeamScopedResources = map[string]bool{
	"routes":          true,
	"services":        true,
	"upstreams":       true,
	"consumers":       true,
	"consumer_groups": true,
	"stream_routes":   true,
}

// Ownership tracks which team owns a specific resource on an instance
type Ownership struct {
	InstanceID   string `json:"instance_id"`
	ResourceType string `json:"resource_type"` // routes, services, upstreams
	ResourceID   string `json:"resource_id"`
	TeamID       string `json:"team_id"`
}

// Role represents a role with permissions
type Role struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
}

// Role constants
const (
	RoleSuperAdmin    = "super_admin"
	RoleInstanceAdmin = "instance_admin"
	RoleDeveloper     = "developer"
	RoleViewer        = "viewer"
)

// Permission constants. Resource names match the APISIX admin-API path segments
// (plural where APISIX is plural) so a path like /admin/ssls/<id> can be checked
// against the "ssls:*" entry directly.
var RolePermissions = map[string][]string{
	RoleSuperAdmin:    {"*"},
	RoleInstanceAdmin: {"routes:*", "services:*", "upstreams:*", "consumers:*", "ssls:*", "plugin_configs:*", "protos:*", "global_rules:*", "consumer_groups:*", "secrets:*", "stream_routes:*", "plugin_metadata:*", "plugins:read", "labels:write", "labels:read"},
	RoleDeveloper:     {"routes:*", "services:*", "upstreams:*", "consumers:*", "consumer_groups:*", "stream_routes:*", "labels:read", "plugins:read"},
	RoleViewer:        {"routes:read", "services:read", "upstreams:read", "consumers:read", "ssls:read", "plugin_configs:read", "protos:read", "global_rules:read", "consumer_groups:read", "secrets:read", "stream_routes:read", "plugin_metadata:read", "labels:read", "plugins:read"},
}

// HasResourcePermission reports whether role is permitted to perform action
// against resourceType. action is "read" or "write". resourceType matches the
// APISIX path segment (e.g. "routes", "ssls", "global_rules"). Unknown roles
// deny.
func HasResourcePermission(role, resourceType, action string) bool {
	if role == RoleSuperAdmin {
		return true
	}
	perms, ok := RolePermissions[role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == "*" {
			return true
		}
		res, rest, ok := strings.Cut(p, ":")
		if !ok || res != resourceType {
			continue
		}
		if rest == "*" || rest == action {
			return true
		}
	}
	return false
}

// Config keys stored in etcd
const (
	ConfigKeyAdminInitialized = "config/admin_initialized"
	ConfigKeyDefaultPassword  = "config/default_password"
	ConfigKeyPasswordPolicy   = "config/password_policy"
)

// KeyPrefix constants
const (
	KeyPrefixConfig        = "/config/"
	KeyPrefixInstances     = "/instances/"
	KeyPrefixUsers         = "/users/"
	KeyPrefixUserInstances = "/user_instances/"
	KeyPrefixRoles         = "/roles/"
	KeyPrefixTeams         = "/teams/"
	KeyPrefixOwnership     = "/ownership/"
	KeyPrefixLabels        = "/labels/"
)

// Label represents a managed label key with allowed values
type Label struct {
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name"`
	Color       string   `json:"color"`
	Values      []string `json:"values"`
	CreatedBy   string   `json:"created_by"`
	CreatedAt   int64    `json:"created_at"`
	UpdatedAt   int64    `json:"updated_at"`
}

// Why a gateway is not Connected, as a code rather than a sentence: the
// frontend puts it in the reader's language, which an English sentence written
// here could not be (#340).
const (
	// HealthCodeUnreachable: the probe of the Admin API failed.
	HealthCodeUnreachable = "unreachable"
	// HealthCodeNotRead: the refresh ran out of time before this gateway's turn,
	// so nothing is known about it (#330).
	HealthCodeNotRead = "not_read"
	// HealthCodeUnreadable: none of the Admin API reads could be used, which
	// covers a gateway that answered with something the dashboard cannot read
	// as well as one that did not answer (#286).
	HealthCodeUnreadable = "unreadable"
)

// InstanceHealth represents the connectivity status of an instance
type InstanceHealth struct {
	InstanceID string    `json:"instance_id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"` // Connected, Disconnected, Unknown
	LastCheck  time.Time `json:"last_check"`
	// Code is set whenever Status is not Connected: one of the HealthCode*
	// constants.
	Code string `json:"code,omitempty"`
	// Error is the probe's own error, for a super_admin only: it quotes the
	// Admin API address (#309). Everyone else reads Code.
	Error string `json:"error,omitempty"`
}

// InstanceDependencies describes everything that still references an instance.
// It is reported to the caller before an instance is deleted so the deletion's
// blast radius is explicit rather than silent.
//
// The gateway counts (Routes..StreamRoutes) come from the instance's Admin API
// and carry a number only when Reachable is true. "Reachable" here means every
// probe answered AND its response could be read as a count: a reply the
// dashboard cannot make sense of is reported as unknown, never as zero, because
// a zero tells the operator that deleting is harmless.
//
// The etcd-backed counts (UserAssignments, OwnershipRecords) are always exact.
type InstanceDependencies struct {
	Routes       int `json:"routes"`
	Services     int `json:"services"`
	Upstreams    int `json:"upstreams"`
	Consumers    int `json:"consumers"`
	StreamRoutes int `json:"stream_routes"`

	// UserAssignments counts /user_instances/<userID>/<instanceID> records that
	// would be orphaned by the deletion.
	UserAssignments int `json:"user_assignments"`
	// OwnershipRecords counts /ownership/<instanceID>/... records that would be
	// orphaned by the deletion.
	OwnershipRecords int `json:"ownership_records"`

	// Reachable reports whether every gateway count could be established. When
	// false the counts above are unknown, not zero.
	Reachable bool `json:"reachable"`
	// Error explains why the gateway could not be counted, when Reachable is
	// false. "connection refused" and "status 401" call for entirely different
	// actions from the operator, so the reason is carried rather than collapsed
	// into the bool.
	Error string `json:"error,omitempty"`
}

// TotalGatewayResources returns how many resources still live on the gateway
// itself. Meaningful only when Reachable is true — when it is false this is 0
// because the counts are unknown, so never read it as "nothing is attached".
// Use RequiresConfirmation for that question; it handles the unknown case.
func (d InstanceDependencies) TotalGatewayResources() int {
	return d.Routes + d.Services + d.Upstreams + d.Consumers + d.StreamRoutes
}

// RequiresConfirmation reports whether deleting the instance would discard
// dashboard records or strand live gateway resources, and therefore must not
// proceed without an explicit force.
// An unreachable instance always requires confirmation: its gateway resource
// counts are unknown, so "nothing attached" cannot be established.
func (d InstanceDependencies) RequiresConfirmation() bool {
	if !d.Reachable {
		return true
	}
	return d.TotalGatewayResources() > 0 || d.UserAssignments > 0 || d.OwnershipRecords > 0
}

// ResourceStats contains counts for APISIX resources
type ResourceStats struct {
	Routes    int `json:"routes"`
	Services  int `json:"services"`
	Upstreams int `json:"upstreams"`
}

// OverviewData aggregates data for the dashboard landing page
type OverviewData struct {
	TotalInstances  int `json:"total_instances"`
	ActiveInstances int `json:"active_instances"`
	// UncountedInstances is how many gateways have at least one count missing
	// from GlobalStats, so at least one of those totals understates what the
	// estate holds (#286). A gateway whose routes were read but whose services
	// were not is counted here and still contributes its routes: the totals
	// are a sum over what could be counted, and a sum that quietly leaves
	// something out reads as a smaller estate rather than as an incomplete
	// answer.
	UncountedInstances int              `json:"uncounted_instances"`
	GlobalStats        ResourceStats    `json:"global_stats"`
	CurrentInstance    *InstanceHealth  `json:"current_instance,omitempty"`
	InstanceStats      ResourceStats    `json:"instance_stats,omitempty"`
	AllInstances       []InstanceHealth `json:"all_instances"`
}

// PasswordPolicy is the admin-editable password policy, stored in etcd at
// ConfigKeyPasswordPolicy. Phase 1 enforces only the complexity fields; the
// history/expiry/lockout fields are stored but inert until later phases.
type PasswordPolicy struct {
	MinLength            int  `json:"min_length"`
	MaxLength            int  `json:"max_length"`
	RequireUppercase     bool `json:"require_uppercase"`
	RequireLowercase     bool `json:"require_lowercase"`
	RequireDigit         bool `json:"require_digit"`
	RequireSymbol        bool `json:"require_symbol"`
	HistoryDepth         int  `json:"history_depth"`
	ExpiryDays           int  `json:"expiry_days"`
	LockoutThreshold     int  `json:"lockout_threshold"`
	LockoutWindowMinutes int  `json:"lockout_window_minutes"`
}

// DefaultPasswordPolicy returns the built-in policy used when none is stored.
func DefaultPasswordPolicy() PasswordPolicy {
	return PasswordPolicy{
		MinLength:            12,
		MaxLength:            72,
		RequireUppercase:     true,
		RequireLowercase:     true,
		RequireDigit:         true,
		RequireSymbol:        true,
		HistoryDepth:         5,
		ExpiryDays:           90,
		LockoutThreshold:     5,
		LockoutWindowMinutes: 15,
	}
}

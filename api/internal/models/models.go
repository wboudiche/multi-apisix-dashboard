package models

import "time"

// Instance represents an APISIX instance configuration
type Instance struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	AdminAPIURL string    `json:"admin_api_url"` // e.g., http://localhost:9180
	AdminKey    string    `json:"admin_key"`
	GatewayURL  string    `json:"gateway_url"` // e.g., http://localhost:9080
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// User represents a dashboard user
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"password_hash"`
	Email        string    `json:"email"`
	Role         string    `json:"role"` // super_admin only
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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
	UserID     string `json:"user_id"`
	InstanceID string `json:"instance_id"`
	TeamID     string `json:"team_id"` // The Team context for this instance
	Role       string `json:"role"`    // instance_admin, developer, viewer
	Scope      *Scope `json:"scope,omitempty"`
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

// Permission constants
var RolePermissions = map[string][]string{
	RoleSuperAdmin:    {"*"},
	RoleInstanceAdmin: {"routes:*", "services:*", "upstreams:*", "consumers:*", "ssl:*", "plugin_configs:*", "protos:*", "global_rules:*", "consumer_groups:*", "secrets:*", "labels:write", "labels:read"},
	RoleDeveloper:     {"routes:*", "services:*", "upstreams:*", "consumers:*", "consumer_groups:*", "labels:read"},
	RoleViewer:        {"routes:read", "services:read", "upstreams:read", "consumers:read", "ssl:read", "plugin_configs:read", "protos:read", "global_rules:read", "consumer_groups:read", "secrets:read", "labels:read"},
}

// Config keys stored in etcd
const (
	ConfigKeyAdminInitialized = "config/admin_initialized"
	ConfigKeyDefaultPassword  = "config/default_password"
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

// InstanceHealth represents the connectivity status of an instance
type InstanceHealth struct {
	InstanceID string    `json:"instance_id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"` // Connected, Disconnected
	LastCheck  time.Time `json:"last_check"`
	Error      string    `json:"error,omitempty"`
}

// ResourceStats contains counts for APISIX resources
type ResourceStats struct {
	Routes    int `json:"routes"`
	Services  int `json:"services"`
	Upstreams int `json:"upstreams"`
}

// OverviewData aggregates data for the dashboard landing page
type OverviewData struct {
	TotalInstances  int              `json:"total_instances"`
	ActiveInstances int              `json:"active_instances"`
	GlobalStats     ResourceStats    `json:"global_stats"`
	CurrentInstance *InstanceHealth  `json:"current_instance,omitempty"`
	InstanceStats   ResourceStats    `json:"instance_stats,omitempty"`
	AllInstances    []InstanceHealth `json:"all_instances"`
}

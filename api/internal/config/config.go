package config

import (
	"os"
	"time"
)

type Config struct {
	Server   ServerConfig
	Etcd     EtcdConfig
	JWT      JWTConfig
	Security SecurityConfig
}

type ServerConfig struct {
	Port string
	Host string
}

type EtcdConfig struct {
	Endpoints []string
	Username  string
	Password  string
	Prefix    string // /apisix-dashboard prefix
}

type JWTConfig struct {
	Secret        string
	AccessExpiry  time.Duration
	RefreshExpiry time.Duration
}

type SecurityConfig struct {
	AdminPassword string
	BcryptCost    int
}

func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port: getEnv("PORT", "8080"),
			Host: getEnv("HOST", "0.0.0.0"),
		},
		Etcd: EtcdConfig{
			Endpoints: parseEnvList("ETCD_ENDPOINTS", "http://localhost:2379"),
			Username:  os.Getenv("ETCD_USERNAME"),
			Password:  os.Getenv("ETCD_PASSWORD"),
			Prefix:    "/apisix-dashboard",
		},
		JWT: JWTConfig{
			Secret:        getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
			AccessExpiry:  15 * time.Minute,
			RefreshExpiry: 7 * 24 * time.Hour,
		},
		Security: SecurityConfig{
			AdminPassword: getEnv("ADMIN_PASSWORD", "admin"),
			BcryptCost:    10,
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func parseEnvList(key, defaultValue string) []string {
	if value := os.Getenv(key); value != "" {
		return []string{value}
	}
	return []string{defaultValue}
}

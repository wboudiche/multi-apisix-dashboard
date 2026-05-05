package middleware

import (
	"log"
	"net/http"
	"strings"

	"github.com/apache/apisix-dashboard/api/internal/services"

	"github.com/gin-gonic/gin"
)

const (
	AuthorizationHeader = "Authorization"
	BearerPrefix        = "Bearer "
	UserIDKey           = "userID"
	UsernameKey         = "username"
	RoleKey             = "role"
	InstanceIDKey       = "instanceID"
)

func AuthMiddleware(authService *services.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader(AuthorizationHeader)
		if authHeader == "" {
			log.Printf("[DEBUG] No auth header, path: %s", c.Request.URL.Path)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		if !strings.HasPrefix(authHeader, BearerPrefix) {
			log.Printf("[DEBUG] Invalid auth format: %s, path: %s", authHeader, c.Request.URL.Path)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(authHeader, BearerPrefix)
		log.Printf("[DEBUG] Validating token: %s..., path: %s", token[:min(20, len(token))], c.Request.URL.Path)

		claims, err := authService.ValidateToken(token)
		if err != nil {
			log.Printf("[DEBUG] Token validation failed: %v, path: %s", err, c.Request.URL.Path)
			if err == services.ErrTokenExpired {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token expired"})
			} else {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			}
			c.Abort()
			return
		}

		// Set user info in context
		cleanUserID := strings.Trim(claims.UserID, "\"")
		c.Set(UserIDKey, cleanUserID)
		c.Set(UsernameKey, claims.Username)
		c.Set(RoleKey, claims.Role)

		log.Printf("[DEBUG] Token valid for user: %s (ID: %s), path: %s", claims.Username, cleanUserID, c.Request.URL.Path)
		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	if v, exists := c.Get(UserIDKey); exists {
		return v.(string)
	}
	return ""
}

func GetUsername(c *gin.Context) string {
	if v, exists := c.Get(UsernameKey); exists {
		return v.(string)
	}
	return ""
}

func GetRole(c *gin.Context) string {
	if v, exists := c.Get(RoleKey); exists {
		return v.(string)
	}
	return ""
}

func GetInstanceID(c *gin.Context) string {
	if v, exists := c.Get(InstanceIDKey); exists {
		return v.(string)
	}
	// Also check query param and header
	if id := c.Query("instance_id"); id != "" {
		return id
	}
	if id := c.GetHeader("X-Instance-ID"); id != "" {
		return id
	}
	return ""
}

package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/apache/apisix-dashboard/api/internal/config"
	"github.com/apache/apisix-dashboard/api/internal/handlers"
	"github.com/apache/apisix-dashboard/api/internal/middleware"
	"github.com/apache/apisix-dashboard/api/internal/models"
	"github.com/apache/apisix-dashboard/api/internal/services"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func main() {
	// Load config
	cfg := config.Load()

	// Initialize etcd client
	etcdClient, err := services.NewEtcdClient(cfg.Etcd)
	if err != nil {
		log.Fatalf("Failed to connect to etcd: %v", err)
	}

	// Initialize services
	authService := services.NewAuthService(etcdClient, *cfg)
	instanceService := services.NewInstanceService(etcdClient)
	teamService := services.NewTeamService(etcdClient)
	ownershipService := services.NewOwnershipService(etcdClient)
	labelService := services.NewLabelService(etcdClient)
	overviewService := services.NewOverviewService(instanceService, ownershipService)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(authService, teamService)
	instanceHandler := handlers.NewInstanceHandler(instanceService, authService, teamService)
	teamHandler := handlers.NewTeamHandler(teamService, ownershipService, authService)
	overviewHandler := handlers.NewOverviewHandler(overviewService)
	proxyHandler := handlers.NewProxyHandler(instanceService, ownershipService)
	upstreamHandler := handlers.NewUpstreamHandler()
	routeTestHandler := handlers.NewRouteTestHandler(instanceService)
	labelHandler := handlers.NewLabelHandler(labelService, authService)

	// Check for default admin creation
	if etcdClient != nil {
		if err := createDefaultData(etcdClient, authService, teamService, cfg.Security.AdminPassword); err != nil {
			log.Printf("Warning: Failed to create default data: %v", err)
		}
	}

	// Setup router
	router := setupRouter(authService, authHandler, instanceHandler, teamHandler, overviewHandler, proxyHandler, upstreamHandler, routeTestHandler, labelHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = cfg.Server.Port
	}

	addr := ":" + port
	log.Printf("Server starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func setupRouter(authService *services.AuthService, authHandler *handlers.AuthHandler, instanceHandler *handlers.InstanceHandler, teamHandler *handlers.TeamHandler, overviewHandler *handlers.OverviewHandler, proxyHandler *handlers.ProxyHandler, upstreamHandler *handlers.UpstreamHandler, routeTestHandler *handlers.RouteTestHandler, labelHandler *handlers.LabelHandler) *gin.Engine {
	router := gin.Default()

	// CORS
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-Instance-ID")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Role management (pre-init)
	roleHandler := handlers.NewRoleHandler()

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "premium_dashboard_ready"})
	})

	// API v1 routes
	v1 := router.Group("/api/v1")
	{
		// Public routes
		v1.POST("/login", authHandler.Login)
		v1.POST("/refresh", authHandler.Refresh)

		// Protected routes
		protected := v1.Group("/")
		protected.Use(middleware.AuthMiddleware(authService))
		{
			protected.POST("/logout", authHandler.Logout)
			protected.GET("/user", authHandler.GetCurrentUser)
			protected.POST("/user/password", authHandler.ChangePassword)

			// Dashboard Overview
			protected.GET("/overview", overviewHandler.GetOverview)

			// Upstream connectivity test
			protected.POST("/test-upstream", upstreamHandler.TestConnection)

			// Route testing via gateway
			protected.POST("/test-route", routeTestHandler.TestRoute)

			// Label taxonomy
			protected.GET("/labels", labelHandler.ListLabels)
			protected.POST("/labels", labelHandler.CreateLabel)
			protected.PUT("/labels/:key", labelHandler.UpdateLabel)
			protected.DELETE("/labels/:key", labelHandler.DeleteLabel)

			// Admin routes (super_admin only)
			admin := protected.Group("")
			{
				// User management
				admin.POST("/users", authHandler.CreateUser)
				admin.GET("/users", authHandler.ListUsers)
				admin.PUT("/users/:id", authHandler.UpdateUser)
				admin.DELETE("/users/:id", authHandler.DeleteUser)

				// User-Instance role management
				admin.POST("/user-access/:user_id/instances/:instance_id/role", instanceHandler.SetUserInstanceRole)
				admin.DELETE("/user-access/:user_id/instances/:instance_id/role", instanceHandler.DeleteUserInstanceRole)
				admin.GET("/user-access/:user_id/instances", instanceHandler.GetUserInstances)

				// Instance management
				admin.POST("/instances", instanceHandler.CreateInstance)
				admin.GET("/instances", instanceHandler.ListInstances)
				admin.GET("/instances/health", instanceHandler.ListInstancesHealth)
				admin.GET("/instances/:id", instanceHandler.GetInstance)
				admin.PUT("/instances/:id", instanceHandler.UpdateInstance)
				admin.DELETE("/instances/:id", instanceHandler.DeleteInstance)
				admin.GET("/instances/:id/test", instanceHandler.TestConnection)

				// Team management
				admin.POST("/teams", teamHandler.CreateTeam)
				admin.GET("/teams", teamHandler.ListTeams)
				admin.GET("/teams/:id", teamHandler.GetTeam)
				admin.DELETE("/teams/:id", teamHandler.DeleteTeam)
				admin.GET("/teams/:id/members", teamHandler.GetTeamMembers)

				// Role management
				admin.GET("/roles", roleHandler.ListRoles)
			}

			// APISIX Proxy routes - forward requests to the selected instance
			proxy := protected.Group("/apisix")
			proxy.Use(middleware.RBACMiddleware(authService))
			{
				proxy.GET("/admin/*path", proxyHandler.ProxyRequest)
				proxy.POST("/admin/*path", proxyHandler.ProxyRequest)
				proxy.PUT("/admin/*path", proxyHandler.ProxyRequest)
				proxy.DELETE("/admin/*path", proxyHandler.ProxyRequest)

				// Convenience routes for common resources
				proxy.GET("/routes", proxyHandler.ListRoutes)
				proxy.GET("/services", proxyHandler.ListServices)
				proxy.GET("/upstreams", proxyHandler.ListUpstreams)

				// Ownership reassignment (admin only)
				proxy.PUT("/ownership/:resource_type/:resource_id", proxyHandler.ReassignOwnership)
			}
		}
	}

	return router
}

func createDefaultData(etcdClient *services.EtcdClient, authService *services.AuthService, teamService *services.TeamService, defaultPassword string) error {
	ctx := context.Background()

	// Check if data already exists
	users, _ := authService.ListUsers(ctx)
	if len(users) > 0 {
		return nil
	}

	// 1. Create default "Platform Team"
	platformTeam := &models.Team{
		ID:          uuid.New().String(),
		Name:        "Platform Team",
		Description: "Global administrators and platform engineers",
	}
	if err := teamService.CreateTeam(ctx, platformTeam); err != nil {
		return err
	}
	log.Printf("Default team created: %s", platformTeam.Name)

	// 2. Hash password
	hash, err := authService.HashPassword(defaultPassword)
	if err != nil {
		return err
	}

	// 3. Create default admin
	admin := &models.User{
		ID:           uuid.New().String(),
		Username:     "admin",
		PasswordHash: hash,
		Email:        "admin@localhost",
		Role:         models.RoleSuperAdmin,
	}

	if err := authService.CreateUser(ctx, admin); err != nil {
		return err
	}

	log.Println("Default admin user created")
	return nil
}

package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/apache/apisix-dashboard/api/internal/services"
	"github.com/gin-gonic/gin"
)

func LabelValidationMiddleware(labelService *services.LabelService) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Param("path")
		method := c.Request.Method

		isRouteWrite := false
		if (path == "/routes" || strings.HasPrefix(path, "/routes/")) && (method == http.MethodPut || method == http.MethodPost) {
			isRouteWrite = true
		}

		if !isRouteWrite {
			c.Next()
			return
		}

		instanceID := GetInstanceID(c)
		if instanceID == "" {
			c.Next()
			return
		}

		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Next()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		var body map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &body); err != nil {
			c.Next()
			return
		}

		labelsRaw, ok := body["labels"]
		if !ok || labelsRaw == nil {
			c.Next()
			return
		}

		labelsMap, ok := labelsRaw.(map[string]interface{})
		if !ok {
			c.Next()
			return
		}

		labels := make(map[string]string)
		for k, v := range labelsMap {
			if sv, ok := v.(string); ok {
				labels[k] = sv
			}
		}

		if len(labels) == 0 {
			c.Next()
			return
		}

		if err := labelService.ValidateRouteLabels(c.Request.Context(), instanceID, labels); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		c.Next()
	}
}

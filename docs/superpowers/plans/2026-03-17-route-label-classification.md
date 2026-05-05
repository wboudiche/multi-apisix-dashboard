# Route Label Classification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed label taxonomy for classifying routes with tag filtering and grouped table views.

**Architecture:** Backend adds a Label CRUD service + pre-proxy validation middleware. Frontend adds a label admin page, structured filter dropdowns on the routes page, 2-level grouping, and color-coded clickable badges. Labels stored in etcd at `/labels/{instance_id}/{key_name}`, routes use APISIX native `labels` field.

**Tech Stack:** Go/Gin/etcd (backend), React/Mantine 8/TanStack Router+Query/Jotai/i18next (frontend)

**Spec:** `docs/superpowers/specs/2026-03-17-route-label-classification-design.md`

---

## Chunk 1: Backend — Data Model, Service, Handler, Middleware

### Task 1: Add Label model and etcd prefix

**Files:**
- Modify: `api/internal/models/models.go`

- [ ] **Step 1: Add Label struct and KeyPrefix constant**

Add to `models.go` after existing structs and constants:

```go
// After existing KeyPrefix constants
KeyPrefixLabels = "/labels/"

// After existing structs
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
```

Also add to `RolePermissions`:
```go
// Add to RoleInstanceAdmin permissions list:
"labels:write", "labels:read"
// Add to RoleDeveloper permissions list:
"labels:read"
// Add to RoleViewer permissions list:
"labels:read"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && go build ./cmd/main.go`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add api/internal/models/models.go
git commit -m "feat(labels): add Label model and etcd key prefix"
```

---

### Task 2: Create Label service

**Files:**
- Create: `api/internal/services/label.go`

- [ ] **Step 1: Create label service with CRUD operations**

```go
package services

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/apache/apisix-dashboard/api/internal/models"
)

var (
	ErrLabelNotFound     = fmt.Errorf("label not found")
	ErrLabelExists       = fmt.Errorf("label key already exists")
	ErrInvalidLabelKey   = fmt.Errorf("label key must be lowercase alphanumeric with underscores, max 32 chars")
	ErrInvalidLabelValue = fmt.Errorf("label values must be max 64 chars, no colons, unique within key")
)

var labelKeyRegex = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

type LabelService struct {
	etcd *EtcdClient
}

func NewLabelService(etcd *EtcdClient) *LabelService {
	return &LabelService{etcd: etcd}
}

func (s *LabelService) labelKey(instanceID, key string) string {
	return models.KeyPrefixLabels + instanceID + "/" + key
}

func (s *LabelService) labelPrefix(instanceID string) string {
	return models.KeyPrefixLabels + instanceID + "/"
}

// SlugFromDisplayName generates a key slug from a display name
func SlugFromDisplayName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else if r == ' ' || r == '-' {
			b.WriteRune('_')
		}
	}
	s := b.String()
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}

func (s *LabelService) validateLabel(label *models.Label) error {
	if !labelKeyRegex.MatchString(label.Key) {
		return ErrInvalidLabelKey
	}
	if len(label.DisplayName) == 0 || len(label.DisplayName) > 64 {
		return fmt.Errorf("display name must be 1-64 characters")
	}
	seen := make(map[string]bool)
	for _, v := range label.Values {
		if len(v) == 0 || len(v) > 64 {
			return ErrInvalidLabelValue
		}
		if strings.Contains(v, ":") {
			return ErrInvalidLabelValue
		}
		lower := strings.ToLower(v)
		if seen[lower] {
			return fmt.Errorf("duplicate label value: %s", v)
		}
		seen[lower] = true
	}
	return nil
}

func (s *LabelService) CreateLabel(ctx context.Context, instanceID string, label *models.Label) error {
	if err := s.validateLabel(label); err != nil {
		return err
	}

	existing, _ := s.GetLabel(ctx, instanceID, label.Key)
	if existing != nil {
		return ErrLabelExists
	}

	now := time.Now().Unix()
	label.CreatedAt = now
	label.UpdatedAt = now

	return s.etcd.PutJSON(ctx, s.labelKey(instanceID, label.Key), label)
}

func (s *LabelService) GetLabel(ctx context.Context, instanceID, key string) (*models.Label, error) {
	var label models.Label
	err := s.etcd.GetJSON(ctx, s.labelKey(instanceID, key), &label)
	if err != nil {
		return nil, err
	}
	if label.Key == "" {
		return nil, nil
	}
	return &label, nil
}

func (s *LabelService) ListLabels(ctx context.Context, instanceID string) ([]*models.Label, error) {
	data, err := s.etcd.List(ctx, s.labelPrefix(instanceID))
	if err != nil {
		return nil, err
	}

	labels := make([]*models.Label, 0, len(data))
	for _, d := range data {
		var label models.Label
		if err := json.Unmarshal(d, &label); err != nil {
			continue
		}
		labels = append(labels, &label)
	}

	// Sort by key for consistent ordering (etcd map iteration is non-deterministic)
	sort.Slice(labels, func(i, j int) bool {
		return labels[i].Key < labels[j].Key
	})

	return labels, nil
}

func (s *LabelService) UpdateLabel(ctx context.Context, instanceID string, label *models.Label) error {
	if err := s.validateLabel(label); err != nil {
		return err
	}

	existing, _ := s.GetLabel(ctx, instanceID, label.Key)
	if existing == nil {
		return ErrLabelNotFound
	}

	label.CreatedAt = existing.CreatedAt
	label.CreatedBy = existing.CreatedBy
	label.UpdatedAt = time.Now().Unix()

	return s.etcd.PutJSON(ctx, s.labelKey(instanceID, label.Key), label)
}

func (s *LabelService) DeleteLabel(ctx context.Context, instanceID, key string) error {
	existing, _ := s.GetLabel(ctx, instanceID, key)
	if existing == nil {
		return ErrLabelNotFound
	}
	return s.etcd.Delete(ctx, s.labelKey(instanceID, key))
}

// ValidateRouteLabels checks that all label key-value pairs on a route exist in the taxonomy
func (s *LabelService) ValidateRouteLabels(ctx context.Context, instanceID string, labels map[string]string) error {
	if len(labels) == 0 {
		return nil
	}

	taxonomy, err := s.ListLabels(ctx, instanceID)
	if err != nil {
		return fmt.Errorf("failed to load label taxonomy: %w", err)
	}

	taxMap := make(map[string]*models.Label)
	for _, l := range taxonomy {
		taxMap[l.Key] = l
	}

	for k, v := range labels {
		def, ok := taxMap[k]
		if !ok {
			return fmt.Errorf("invalid label: key '%s' is not defined in the label taxonomy", k)
		}
		found := false
		for _, allowed := range def.Values {
			if strings.EqualFold(allowed, v) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("invalid label value: '%s' is not an allowed value for key '%s'. Allowed: %s", v, k, strings.Join(def.Values, ", "))
		}
	}
	return nil
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && go build ./cmd/main.go`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add api/internal/services/label.go
git commit -m "feat(labels): add label service with CRUD and validation"
```

---

### Task 3: Create Label handler

**Files:**
- Create: `api/internal/handlers/label.go`

- [ ] **Step 1: Create label handler with CRUD endpoints**

```go
package handlers

import (
	"net/http"

	"github.com/apache/apisix-dashboard/api/internal/middleware"
	"github.com/apache/apisix-dashboard/api/internal/models"
	"github.com/apache/apisix-dashboard/api/internal/services"
	"github.com/gin-gonic/gin"
)

type LabelHandler struct {
	labelService *services.LabelService
	authService  *services.AuthService
}

func NewLabelHandler(labelService *services.LabelService, authService *services.AuthService) *LabelHandler {
	return &LabelHandler{labelService: labelService, authService: authService}
}

type CreateLabelRequest struct {
	Key         string   `json:"key"`
	DisplayName string   `json:"display_name" binding:"required"`
	Color       string   `json:"color" binding:"required"`
	Values      []string `json:"values"`
}

type UpdateLabelRequest struct {
	DisplayName string   `json:"display_name"`
	Color       string   `json:"color"`
	Values      []string `json:"values"`
}

func (h *LabelHandler) ListLabels(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	labels, err := h.labelService.ListLabels(c.Request.Context(), instanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"list": labels, "total": len(labels)})
}

// isLabelAdmin checks if the user has admin rights for labels on the given instance.
// super_admin (global role from JWT) always passes. For other users, resolve the
// instance-level role via authService since RBACMiddleware does not run on label routes.
func (h *LabelHandler) isLabelAdmin(c *gin.Context, instanceID string) bool {
	if middleware.GetRole(c) == models.RoleSuperAdmin {
		return true
	}
	userID := middleware.GetUserID(c)
	ui, err := h.authService.GetUserInstance(c.Request.Context(), userID, instanceID)
	if err != nil || ui == nil {
		return false
	}
	return ui.Role == models.RoleInstanceAdmin
}

func (h *LabelHandler) CreateLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	var req CreateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Auto-generate key from display name if not provided
	key := req.Key
	if key == "" {
		key = services.SlugFromDisplayName(req.DisplayName)
	}

	label := &models.Label{
		Key:         key,
		DisplayName: req.DisplayName,
		Color:       req.Color,
		Values:      req.Values,
		CreatedBy:   middleware.GetUserID(c),
	}

	if err := h.labelService.CreateLabel(c.Request.Context(), instanceID, label); err != nil {
		if err == services.ErrLabelExists {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if err == services.ErrInvalidLabelKey || err == services.ErrInvalidLabelValue {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"value": label})
}

func (h *LabelHandler) UpdateLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	key := c.Param("key")

	existing, err := h.labelService.GetLabel(c.Request.Context(), instanceID, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Label not found"})
		return
	}

	var req UpdateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.DisplayName != "" {
		existing.DisplayName = req.DisplayName
	}
	if req.Color != "" {
		existing.Color = req.Color
	}
	if req.Values != nil {
		existing.Values = req.Values
	}

	if err := h.labelService.UpdateLabel(c.Request.Context(), instanceID, existing); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"value": existing})
}

func (h *LabelHandler) DeleteLabel(c *gin.Context) {
	instanceID := middleware.GetInstanceID(c)
	if instanceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Instance ID required"})
		return
	}

	if !h.isLabelAdmin(c, instanceID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can manage labels"})
		return
	}

	key := c.Param("key")

	if err := h.labelService.DeleteLabel(c.Request.Context(), instanceID, key); err != nil {
		if err == services.ErrLabelNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && go build ./cmd/main.go`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add api/internal/handlers/label.go
git commit -m "feat(labels): add label CRUD handler"
```

---

### Task 4: Create label validation middleware

**Files:**
- Create: `api/internal/middleware/label_validation.go`

- [ ] **Step 1: Create pre-proxy label validation middleware**

```go
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
		// Only validate route create/update requests
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

		// Read body
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.Next()
			return
		}
		// Restore body for downstream handlers
		c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		// Parse to check for labels
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

		// Convert to map[string]string
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

		// Validate against taxonomy
		if err := labelService.ValidateRouteLabels(c.Request.Context(), instanceID, labels); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		c.Next()
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd api && go build ./cmd/main.go`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add api/internal/middleware/label_validation.go
git commit -m "feat(labels): add pre-proxy label validation middleware"
```

---

### Task 5: Wire everything in main.go

**Files:**
- Modify: `api/cmd/main.go`

- [ ] **Step 1: Add label service and handler initialization**

In the dependency injection section of `main()`, after `overviewService`:
```go
labelService := services.NewLabelService(etcdClient)
```

After `routeTestHandler`:
```go
labelHandler := handlers.NewLabelHandler(labelService, authService)
```

- [ ] **Step 2: Update setupRouter signature and add label routes**

Add `labelHandler *handlers.LabelHandler` and `labelService *services.LabelService` to `setupRouter` params.

Inside `setupRouter`, in the `protected` group, add label routes:
```go
// Label taxonomy management
labels := protected.Group("/labels")
{
	labels.GET("", labelHandler.ListLabels)
	labels.POST("", labelHandler.CreateLabel)
	labels.PUT("/:key", labelHandler.UpdateLabel)
	labels.DELETE("/:key", labelHandler.DeleteLabel)
}
```

- [ ] **Step 3: Add label validation middleware to proxy group**

In the proxy group setup, after `proxy.Use(middleware.RBACMiddleware(authService))`:
```go
proxy.Use(middleware.LabelValidationMiddleware(labelService))
```

- [ ] **Step 4: Update setupRouter call in main()**

Pass the new dependencies:
```go
router := setupRouter(authService, authHandler, instanceHandler, teamHandler, overviewHandler, proxyHandler, upstreamHandler, routeTestHandler, labelHandler, labelService)
```

- [ ] **Step 5: Verify it compiles and runs**

Run: `cd api && go build -o manager-api ./cmd/main.go`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add api/cmd/main.go
git commit -m "feat(labels): wire label service, handler, and middleware in main"
```

---

## Chunk 2: Frontend — API Client, Types, i18n Foundation

### Task 6: Add label API client and types

**Files:**
- Create: `src/apis/labels.ts`
- Modify: `src/apis/hooks.ts`

- [ ] **Step 1: Create label API client**

Note: The codebase has two API client patterns. APISIX resource APIs (routes, services, etc.) use bare functions with an `AxiosInstance` parameter — this integrates with the `genListQueryOptions`/`genUseList` hook factories in `hooks.ts`. Dashboard-managed resources (teams) use an object-based `apiClient` pattern. **Labels use the bare function pattern** because they integrate with TanStack Query hooks the same way APISIX resources do.

Create `src/apis/labels.ts`:
```typescript
/*
 * Licensed to the Apache Software Foundation (ASF)...
 */
import type { AxiosInstance } from 'axios';

export interface Label {
  key: string;
  display_name: string;
  color: string;
  values: string[];
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface LabelListResponse {
  list: Label[];
  total: number;
}

export interface CreateLabelRequest {
  key?: string;
  display_name: string;
  color: string;
  values: string[];
}

export interface UpdateLabelRequest {
  display_name?: string;
  color?: string;
  values?: string[];
}

export const getLabelListReq = (req: AxiosInstance) =>
  req.get<LabelListResponse>('/api/v1/labels').then((r) => r.data);

export const createLabelReq = (req: AxiosInstance, data: CreateLabelRequest) =>
  req.post<{ value: Label }>('/api/v1/labels', data).then((r) => r.data);

export const updateLabelReq = (req: AxiosInstance, key: string, data: UpdateLabelRequest) =>
  req.put<{ value: Label }>(`/api/v1/labels/${key}`, data).then((r) => r.data);

export const deleteLabelReq = (req: AxiosInstance, key: string) =>
  req.delete(`/api/v1/labels/${key}`);
```

- [ ] **Step 2: Add label query hook to hooks.ts**

Add to `src/apis/hooks.ts`:
```typescript
import { getLabelListReq } from './labels';

// Label taxonomy query options
export const getLabelListQueryOptions = (instanceId: string) =>
  queryOptions({
    queryKey: ['labels', instanceId],
    queryFn: () => getLabelListReq(req),
    enabled: !!instanceId,
  });
```

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/apis/labels.ts src/apis/hooks.ts
git commit -m "feat(labels): add label API client and query hooks"
```

---

### Task 7: Add i18n keys for labels

**Files:**
- Modify: `src/locales/en/common.json`
- Modify: `src/locales/es/common.json`
- Modify: `src/locales/de/common.json`
- Modify: `src/locales/zh/common.json`

- [ ] **Step 1: Add label i18n keys to English locale**

Add to `src/locales/en/common.json`:

In the `sources` object:
```json
"labels": "Labels"
```

Add a new top-level `labels` object:
```json
"labels": {
  "page": {
    "title": "Label Management",
    "addKey": "Add Label Key",
    "empty": "No label keys defined yet"
  },
  "form": {
    "displayName": "Display Name",
    "key": "Key",
    "color": "Color",
    "values": "Values",
    "valuesPlaceholder": "Type a value and press enter",
    "keyReadOnly": "Key cannot be changed after creation"
  },
  "delete": {
    "title": "Delete Label Key",
    "confirm": "Are you sure you want to delete the label key \"{{name}}\"?",
    "routeCount": "{{count}} routes currently use this label.",
    "warning": "Routes will keep their existing labels but they will appear as orphaned."
  },
  "filter": {
    "groupBy": "Group by",
    "groupByNone": "None",
    "groupBySecondary": "Then by",
    "expandAll": "Expand all",
    "collapseAll": "Collapse all",
    "ungrouped": "Ungrouped",
    "clearAll": "Clear all",
    "addValue": "+ Add value",
    "noLabels": "No labels configured",
    "noLabelsLink": "Configure labels",
    "largeDataset": "Large dataset — filtering may be slow",
    "tooLargeDataset": "Too many routes for client-side grouping. Use single-label filter."
  },
  "badge": {
    "orphanedTooltip": "This label is no longer managed",
    "showMore": "+{{count}}"
  },
  "quickAdd": {
    "placeholder": "New value...",
    "success": "Value added successfully",
    "error": "Failed to add value"
  }
}
```

- [ ] **Step 2: Add placeholder keys to other locales (es, de, zh)**

Copy the same structure to `es/common.json`, `de/common.json`, and `zh/common.json` with English values as placeholders (to be translated later).

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/locales/*/common.json
git commit -m "feat(labels): add i18n keys for label management"
```

---

## Chunk 3: Frontend — Label Admin Settings Page

### Task 8: Create label admin page

**Files:**
- Create: `src/routes/labels/index.tsx`
- Modify: `src/config/navRoutes.ts`

- [ ] **Step 1: Create the labels page component**

Create `src/routes/labels/index.tsx` following the Teams page pattern:

Key features:
- `createFileRoute('/labels/')` with component
- Table with columns: Display Name, Key, Color (swatch), Values (badges), Actions
- Add/Edit modal with: DisplayName input, Key slug input (auto-generated on create, read-only on edit), ColorSwatch picker (12 Mantine preset colors), TagsInput for values
- Delete confirmation modal with route count
- RBAC: page only accessible to super_admin and instance_admin
- Fetch labels via `getLabelListReq`
- Mutations via `createLabelReq`, `updateLabelReq`, `deleteLabelReq`
- Invalidate `['labels']` query cache on mutations

Color palette constants (12 Mantine colors at shade 6):
```typescript
const LABEL_COLORS = [
  { name: 'red', value: '#fa5252' },
  { name: 'pink', value: '#e64980' },
  { name: 'grape', value: '#be4bdb' },
  { name: 'violet', value: '#7950f2' },
  { name: 'indigo', value: '#4c6ef5' },
  { name: 'blue', value: '#228be6' },
  { name: 'cyan', value: '#15aabf' },
  { name: 'teal', value: '#12b886' },
  { name: 'green', value: '#40c057' },
  { name: 'lime', value: '#82c91e' },
  { name: 'yellow', value: '#fab005' },
  { name: 'orange', value: '#fd7e14' },
];
```

- [ ] **Step 2: Run the route tree generator**

Run: `pnpm dev` (briefly, to trigger TanStack Router codegen) or check if there's a codegen script.
Verify `src/routeTree.gen.ts` includes the new `/labels/` route.

- [ ] **Step 3: Add labels to navRoutes (after route file exists and codegen ran)**

In `src/config/navRoutes.ts`, add a new entry in the admin section (after teams):
```typescript
{
  to: '/labels',
  label: 'labels',
  icon: 'label',
}
```

Note: `icon` uses Material Symbols names (the existing convention in `navRoutes.ts`), not Mantine component names. Also add `"labels": "Labels"` to the `sources` object in `src/locales/en/common.json` if not already done in Task 7 (the `NavRoute.label` type requires a matching key in `Resources['en']['common']['sources']`).

- [ ] **Step 4: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/routes/labels/ src/config/navRoutes.ts src/routeTree.gen.ts
git commit -m "feat(labels): add label management admin page"
```

---

## Chunk 4: Frontend — Routes Page Label Filter Bar

### Task 9: Add label filter dropdowns to routes page

**Files:**
- Create: `src/components/page-slice/RouteLabelFilter.tsx`
- Modify: `src/routes/routes/index.tsx`

- [ ] **Step 1: Create RouteLabelFilter component**

Create `src/components/page-slice/RouteLabelFilter.tsx`:

Features:
- Fetches label taxonomy via `getLabelListQueryOptions`
- Renders one `MultiSelect` per label key, with the key's color as left border
- Active filters shown as dismissable `Badge` chips below dropdowns
- "Clear all" link when 2+ active filters
- Filter logic: OR within key, AND across keys
- Quick-add: admins see "+ Add value" footer in each dropdown
- Empty state: "No labels configured" with link to `/labels` for admins
- Props: `onFilterChange: (filters: Record<string, string[]>) => void`, `activeFilters: Record<string, string[]>`

- [ ] **Step 2: Integrate into routes page**

In `src/routes/routes/index.tsx`:
- Import and render `RouteLabelFilter` between existing filters and table
- Add `labelFilters` state: `Record<string, string[]>`
- When label filters are active, switch to client-side fetching (all routes)
- Apply label filter logic: for each route, check if its `labels` field matches (OR within key, AND across keys)
- Pass filtered data to the existing `RouteList` component

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/page-slice/RouteLabelFilter.tsx src/routes/routes/index.tsx
git commit -m "feat(labels): add label filter dropdowns to routes page"
```

---

### Task 10: Add active filter chips

**Files:**
- Create: `src/components/page-slice/ActiveLabelChips.tsx`
- Modify: `src/components/page-slice/RouteLabelFilter.tsx`

- [ ] **Step 1: Create ActiveLabelChips component**

Create `src/components/page-slice/ActiveLabelChips.tsx`:
- Receives `activeFilters: Record<string, string[]>` and `taxonomy: Label[]`
- Renders horizontal `Group` of `Badge` components
- Each chip: `key:value` text, key's color as background tint, `x` close button
- "Clear all" `Anchor` when 2+ filters
- `onRemove: (key: string, value: string) => void`
- `onClearAll: () => void`

- [ ] **Step 2: Integrate into RouteLabelFilter**

Render `ActiveLabelChips` below the dropdowns in `RouteLabelFilter`.

- [ ] **Step 3: Verify lint passes and visual check**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/page-slice/ActiveLabelChips.tsx src/components/page-slice/RouteLabelFilter.tsx
git commit -m "feat(labels): add active filter chips with dismiss and clear all"
```

---

## Chunk 5: Frontend — Grouped Table View

### Task 11: Add group-by selector and grouped rendering

**Files:**
- Create: `src/components/page-slice/RouteGroupBy.tsx`
- Create: `src/components/page-slice/GroupedRouteTable.tsx`
- Modify: `src/routes/routes/index.tsx`

- [ ] **Step 1: Create RouteGroupBy selector component**

Create `src/components/page-slice/RouteGroupBy.tsx`:
- Two cascading `Select` dropdowns: primary and secondary group key
- Options populated from label taxonomy (display names)
- "None" as first option
- Secondary dropdown only visible when primary is selected
- Props: `groupBy: [string | null, string | null]`, `onChange: (groupBy: [string | null, string | null]) => void`, `taxonomy: Label[]`

- [ ] **Step 2: Create GroupedRouteTable component**

Create `src/components/page-slice/GroupedRouteTable.tsx`:

Features:
- Takes flat route list + groupBy keys + taxonomy
- Groups routes into nested structure:
  - Level 1: group by primary key's label values
  - Level 2: within each L1 group, group by secondary key's values
  - "Ungrouped" section for routes missing the group-by key
- Renders collapsible group headers:
  - Full-width row with key's color as 4px left border
  - Shows: `DisplayName: value (N routes)`
  - Click to toggle expand/collapse
- "Expand all" / "Collapse all" button
- Client-side pagination on flat route count (group headers don't consume slots)
- Delegates individual row rendering to existing route table row component

- [ ] **Step 3: Integrate into routes page**

In `src/routes/routes/index.tsx`:
- Add `groupBy` state persisted in URL params (`?groupBy=env,team`)
- Render `RouteGroupBy` in the toolbar next to column visibility
- When groupBy is active, render `GroupedRouteTable` instead of flat `RouteList`
- Ensure client-side fetch mode is used when groupBy is active

- [ ] **Step 4: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/page-slice/RouteGroupBy.tsx src/components/page-slice/GroupedRouteTable.tsx src/routes/routes/index.tsx
git commit -m "feat(labels): add 2-level route grouping with collapsible headers"
```

---

## Chunk 6: Frontend — Label Badges and Form Integration

### Task 12: Upgrade label badges in routes table

**Files:**
- Modify: `src/routes/routes/index.tsx` (label column rendering)

- [ ] **Step 1: Update label column rendering**

In the labels column of the routes table:
- Fetch taxonomy to resolve colors: use `getLabelListQueryOptions`
- Render each label as a `Badge` with:
  - Background: key's color at light tint (Mantine `color.0`)
  - Text: value only (darker shade `color.8`)
  - Tooltip on hover: `key: value`
  - `onClick`: add as active filter
- Orphaned labels (key not in taxonomy): gray badge, dashed border, warning tooltip
- Overflow: show first 2, then `+N` badge that expands inline on click

- [ ] **Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/routes/index.tsx
git commit -m "feat(labels): color-coded clickable label badges with orphan handling"
```

---

### Task 13: Update FormItemLabels for structured route labels

**Files:**
- Modify: `src/components/form/Labels.tsx`
- Modify: `src/components/form-slice/FormPartBasic.tsx`

- [ ] **Step 1: Add resourceType prop to FormPartBasic**

In `FormPartBasicProps`, add:
```typescript
resourceType?: 'route' | 'service' | 'upstream' | 'consumer' | 'other';
```

Pass it through to `FormItemLabels`.

- [ ] **Step 2: Update FormItemLabels with conditional rendering**

In `src/components/form/Labels.tsx`:
- Add `resourceType` prop
- When `resourceType === 'route'`:
  - Fetch label taxonomy
  - Render one `Select` dropdown per label key (single value per key)
  - Admin users see "+ Add value" footer in each dropdown (quick-add)
  - Orphaned labels (from existing route data) shown as grayed-out chips with remove button
- When `resourceType !== 'route'` (or undefined):
  - Keep existing free-text `TagsInput` behavior unchanged

- [ ] **Step 3: Update route add/edit pages to pass resourceType**

In `src/routes/routes/add.tsx` and `src/routes/routes/detail.$id.tsx`, pass `resourceType="route"` to `FormPartBasic`.

- [ ] **Step 4: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/form/Labels.tsx src/components/form-slice/FormPartBasic.tsx src/routes/routes/add.tsx src/routes/routes/detail.$id.tsx
git commit -m "feat(labels): structured label selection in route forms with quick-add"
```

---

## Chunk 7: Scalability Thresholds and Final Integration

### Task 14: Add scalability warnings and data fetching hybrid

**Files:**
- Modify: `src/routes/routes/index.tsx`

- [ ] **Step 1: Implement hybrid fetch strategy**

In the routes page:
- When no label filters and no groupBy active: use existing server-side paginated query (unchanged)
- When label filters OR groupBy active: fetch all routes with `page_size=0`
- Add route count check after full fetch:
  - \> 1000 routes: show warning `Alert` banner (i18n `labels.filter.largeDataset`)
  - \> 5000 routes: disable grouping, show message (i18n `labels.filter.tooLargeDataset`)

- [ ] **Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/routes/index.tsx
git commit -m "feat(labels): add hybrid fetch strategy with scalability warnings"
```

---

### Task 15: URL search params persistence

**Files:**
- Modify: `src/types/schema/pageSearch.ts`
- Modify: `src/routes/routes/index.tsx`

- [ ] **Step 1: Extend pageSearchSchema for label filters**

The existing schema uses `.passthrough()` so dynamic `label_*` params will pass through. Add explicit handling in the routes page to parse `label_{key}` params from the URL and `groupBy` param.

In the routes page component:
- On mount, parse `label_*` params from search and populate `labelFilters` state
- Parse `groupBy` param (comma-separated) into `groupBy` state
- On filter change, update URL search params
- On groupBy change, update URL search params

- [ ] **Step 2: Verify URL persistence works**

Manual test: apply filters, refresh page, verify filters are restored from URL.

- [ ] **Step 3: Commit**

```bash
git add src/types/schema/pageSearch.ts src/routes/routes/index.tsx
git commit -m "feat(labels): persist label filters and groupBy in URL search params"
```

---

### Task 16: Final build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full frontend build**

Run: `pnpm build`
Expected: TypeScript check passes, Vite build succeeds

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: Zero warnings

- [ ] **Step 3: Run backend build**

Run: `cd api && go build -o manager-api ./cmd/main.go`
Expected: No errors

- [ ] **Step 4: Final commit if any remaining changes**

```bash
git add -A
git commit -m "feat(labels): final build verification and cleanup"
```

# Password Policy — Phase 1 (Complexity + Policy Store + Settings UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce configurable password *complexity* rules wherever a password is set, store the policy in etcd, and let a super_admin edit it from a Settings page with a live requirement checklist.

**Architecture:** A new `PolicyService` (in the existing flat `package services`) owns the policy config (etcd key `config/password_policy`, cached) and a pure `ValidatePassword` function. `CreateUser` and `ChangePassword` call it before hashing. A `SettingsHandler` exposes `GET/PUT /settings/password-policy`. The React SPA adds a `policyApi` client, a `/settings` route (super_admin), and a reusable `PasswordRequirements` checklist wired into the create-user form.

**Tech Stack:** Go 1.22 (Gin, etcd clientv3, bcrypt), React 19 + TypeScript (Mantine, TanStack Router/Query, jotai), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-08-password-policy-design.md` (§4.1-4.2, §5, §6.1, §7, §8; Phase 1 in §11).

## Global Constraints

- Go module path: `github.com/wboudiche/multi-apisix-dashboard/api`. Build/test with `-C api`.
- ASF license header required on every new `.go`, `.ts`, `.tsx` file (copy verbatim from any sibling file, e.g. `api/internal/services/label.go` or `src/apis/teams.ts`).
- Frontend: no hardcoded user-visible strings — every string goes through `t('...')` with keys defined in `src/locales/en/common.json` (source of truth) and mirrored to `de/es/tr/zh`. `pnpm lint` runs with `--max-warnings=0`.
- Backend super_admin is enforced **inline in each handler** (`middleware.GetRole(c) != models.RoleSuperAdmin`), not by middleware — follow that pattern.
- etcd access is via `*services.EtcdClient` (`GetJSON(ctx, key, &dest)` leaves `dest` untouched and returns `nil` when the key is absent; `PutJSON(ctx, key, val)`).
- Use two axios clients correctly: `apiClient` (from `@/apis/client`) for `/api/v1/*`. Never `req`.
- Phase 1 does **not** add fields to `models.User` (history/expiry/lockout are Phases 2-4). The full `PasswordPolicy` struct (all fields) is defined now, but only complexity fields are validated/enforced this phase; the rest are stored-but-inert.
- bcrypt truncates at 72 bytes → `MaxLength` is capped at 72.

---

### Task 1: `PasswordPolicy` model + defaults

**Files:**
- Modify: `api/internal/models/models.go` (add const near line 131 `ConfigKeyDefaultPassword`; add struct + `DefaultPasswordPolicy()`)

**Interfaces:**
- Produces: `models.PasswordPolicy` struct; `models.DefaultPasswordPolicy() PasswordPolicy`; `models.ConfigKeyPasswordPolicy = "config/password_policy"`.

- [ ] **Step 1: Add the config key constant**

In `api/internal/models/models.go`, in the const block that contains `ConfigKeyDefaultPassword`, add:

```go
	ConfigKeyPasswordPolicy   = "config/password_policy"
```

- [ ] **Step 2: Add the struct and defaults**

Append to `api/internal/models/models.go`:

```go
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
```

- [ ] **Step 3: Verify it compiles**

Run: `go build -C api ./...`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add api/internal/models/models.go
git commit -m "feat(auth): add PasswordPolicy model and defaults"
```

---

### Task 2: Pure complexity validator

**Files:**
- Create: `api/internal/services/policy.go`
- Test: `api/internal/services/policy_test.go`

**Interfaces:**
- Consumes: `models.PasswordPolicy`.
- Produces: `services.Violation{ Code string; Params map[string]any }`; `services.ValidatePassword(policy models.PasswordPolicy, pw string, history []string) []Violation`. (`history` is accepted now and used in Phase 2 for reuse detection; Phase 1 ignores it.)

- [ ] **Step 1: Write the failing test**

Create `api/internal/services/policy_test.go` (with the ASF header block copied from `label.go`, then):

```go
package services

import (
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

func codes(vs []Violation) map[string]bool {
	m := map[string]bool{}
	for _, v := range vs {
		m[v.Code] = true
	}
	return m
}

func TestValidatePassword(t *testing.T) {
	p := models.DefaultPasswordPolicy() // min 12, all classes required

	cases := []struct {
		name    string
		pw      string
		want    []string // expected violation codes
	}{
		{"valid", "Abcdef123!xyz", nil},
		{"too short", "Ab1!", []string{"min_length"}},
		{"no upper", "abcdef123!xyz", []string{"missing_uppercase"}},
		{"no lower", "ABCDEF123!XYZ", []string{"missing_lowercase"}},
		{"no digit", "Abcdefgh!xyzQ", []string{"missing_digit"}},
		{"no symbol", "Abcdef123xyzQ", []string{"missing_symbol"}},
		{"empty hits many", "", []string{"min_length", "missing_uppercase", "missing_lowercase", "missing_digit", "missing_symbol"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := codes(ValidatePassword(p, tc.pw, nil))
			for _, w := range tc.want {
				if !got[w] {
					t.Errorf("pw %q: expected violation %q, got %v", tc.pw, w, got)
				}
			}
			if len(tc.want) == 0 && len(got) != 0 {
				t.Errorf("pw %q: expected no violations, got %v", tc.pw, got)
			}
		})
	}
}

func TestValidatePasswordMaxLength(t *testing.T) {
	p := models.DefaultPasswordPolicy()
	p.MaxLength = 16
	long := "Abcdef123!xyzABCDEFG" // 20 chars
	if !codes(ValidatePassword(p, long, nil))["max_length"] {
		t.Errorf("expected max_length violation for over-long password")
	}
}

func TestValidatePasswordDisabledClasses(t *testing.T) {
	p := models.PasswordPolicy{MinLength: 4, MaxLength: 72} // no class requirements
	if vs := ValidatePassword(p, "abcd", nil); len(vs) != 0 {
		t.Errorf("expected no violations when classes disabled, got %v", vs)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test -C api ./internal/services/ -run TestValidatePassword`
Expected: FAIL — `undefined: ValidatePassword` / `undefined: Violation`.

- [ ] **Step 3: Write minimal implementation**

Create `api/internal/services/policy.go` (ASF header block copied from `label.go`, then):

```go
package services

import (
	"unicode"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// Violation is a single failed password rule. Code is a stable identifier the
// frontend localises; Params carries values for interpolation (e.g. the min).
type Violation struct {
	Code   string         `json:"code"`
	Params map[string]any `json:"params,omitempty"`
}

// ValidatePassword checks pw against the complexity rules in policy and returns
// every violation (not just the first). history is reserved for reuse checks in
// a later phase and is currently ignored.
func ValidatePassword(policy models.PasswordPolicy, pw string, history []string) []Violation {
	var vs []Violation

	if policy.MinLength > 0 && len([]rune(pw)) < policy.MinLength {
		vs = append(vs, Violation{Code: "min_length", Params: map[string]any{"min": policy.MinLength}})
	}
	if policy.MaxLength > 0 && len([]rune(pw)) > policy.MaxLength {
		vs = append(vs, Violation{Code: "max_length", Params: map[string]any{"max": policy.MaxLength}})
	}

	var hasUpper, hasLower, hasDigit, hasSymbol bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSymbol = true
		}
	}
	if policy.RequireUppercase && !hasUpper {
		vs = append(vs, Violation{Code: "missing_uppercase"})
	}
	if policy.RequireLowercase && !hasLower {
		vs = append(vs, Violation{Code: "missing_lowercase"})
	}
	if policy.RequireDigit && !hasDigit {
		vs = append(vs, Violation{Code: "missing_digit"})
	}
	if policy.RequireSymbol && !hasSymbol {
		vs = append(vs, Violation{Code: "missing_symbol"})
	}
	return vs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test -C api ./internal/services/ -run TestValidatePassword`
Expected: PASS (all subtests ok).

- [ ] **Step 5: Commit**

```bash
git add api/internal/services/policy.go api/internal/services/policy_test.go
git commit -m "feat(auth): add password complexity validator"
```

---

### Task 3: PolicyService — load/save policy in etcd

**Files:**
- Modify: `api/internal/services/policy.go`
- Test: `api/internal/services/policy_test.go`

**Interfaces:**
- Consumes: `*services.EtcdClient`, `models.ConfigKeyPasswordPolicy`, `models.DefaultPasswordPolicy()`.
- Produces: `services.NewPolicyService(etcd *EtcdClient) *PolicyService`; methods `LoadPolicy(ctx) (models.PasswordPolicy, error)`, `SavePolicy(ctx, models.PasswordPolicy) error`, `Validate(ctx, pw string, history []string) ([]Violation, error)`. `ErrInvalidPolicy` error var. `SavePolicy` rejects `MinLength < 8`, `MaxLength > 72`, `MaxLength < MinLength`, or any negative field.

- [ ] **Step 1: Write the failing test**

Append to `api/internal/services/policy_test.go`:

```go
func TestSavePolicyRejectsInsane(t *testing.T) {
	s := &PolicyService{} // etcd not needed; validation happens before any write
	bad := []models.PasswordPolicy{
		{MinLength: 4, MaxLength: 72},   // below floor 8
		{MinLength: 12, MaxLength: 100}, // above bcrypt cap 72
		{MinLength: 40, MaxLength: 20},  // max < min
		{MinLength: 12, MaxLength: 72, HistoryDepth: -1},
	}
	for i, p := range bad {
		if err := s.validateConfig(p); err == nil {
			t.Errorf("case %d: expected error for insane policy %+v", i, p)
		}
	}
	if err := s.validateConfig(models.DefaultPasswordPolicy()); err != nil {
		t.Errorf("default policy should be valid, got %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test -C api ./internal/services/ -run TestSavePolicy`
Expected: FAIL — `undefined: PolicyService` / `s.validateConfig undefined`.

- [ ] **Step 3: Write minimal implementation**

Append to `api/internal/services/policy.go` (add `"context"` and `"fmt"` to its imports):

```go
// ErrInvalidPolicy is returned when a proposed policy config is out of bounds.
var ErrInvalidPolicy = fmt.Errorf("invalid password policy")

// PolicyService owns the password policy config in etcd.
type PolicyService struct {
	etcd *EtcdClient
}

func NewPolicyService(etcd *EtcdClient) *PolicyService {
	return &PolicyService{etcd: etcd}
}

// LoadPolicy returns the stored policy, or the built-in defaults if none exists.
func (s *PolicyService) LoadPolicy(ctx context.Context) (models.PasswordPolicy, error) {
	p := models.DefaultPasswordPolicy()
	if err := s.etcd.GetJSON(ctx, models.ConfigKeyPasswordPolicy, &p); err != nil {
		return models.DefaultPasswordPolicy(), err
	}
	return p, nil
}

// SavePolicy validates and persists a policy.
func (s *PolicyService) SavePolicy(ctx context.Context, p models.PasswordPolicy) error {
	if err := s.validateConfig(p); err != nil {
		return err
	}
	return s.etcd.PutJSON(ctx, models.ConfigKeyPasswordPolicy, p)
}

// Validate loads the current policy and checks pw against it.
func (s *PolicyService) Validate(ctx context.Context, pw string, history []string) ([]Violation, error) {
	p, err := s.LoadPolicy(ctx)
	if err != nil {
		return nil, err
	}
	return ValidatePassword(p, pw, history), nil
}

func (s *PolicyService) validateConfig(p models.PasswordPolicy) error {
	switch {
	case p.MinLength < 8:
		return fmt.Errorf("%w: min_length must be >= 8", ErrInvalidPolicy)
	case p.MaxLength > 72:
		return fmt.Errorf("%w: max_length must be <= 72 (bcrypt limit)", ErrInvalidPolicy)
	case p.MaxLength < p.MinLength:
		return fmt.Errorf("%w: max_length must be >= min_length", ErrInvalidPolicy)
	case p.HistoryDepth < 0 || p.ExpiryDays < 0 || p.LockoutThreshold < 0 || p.LockoutWindowMinutes < 0:
		return fmt.Errorf("%w: numeric fields must be non-negative", ErrInvalidPolicy)
	}
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test -C api ./internal/services/ -run TestSavePolicy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/internal/services/policy.go api/internal/services/policy_test.go
git commit -m "feat(auth): add PolicyService load/save with config validation"
```

---

### Task 4: Enforce complexity in CreateUser and ChangePassword

**Files:**
- Modify: `api/internal/handlers/auth.go` (add `policyService` field; inject in `NewAuthHandler`; validate in `CreateUser` ~line 165 and `ChangePassword` ~line 288)
- Modify: `api/cmd/main.go` (build `PolicyService`, pass to `NewAuthHandler`)

**Interfaces:**
- Consumes: `services.NewPolicyService`, `AuthHandler.policyService.Validate`.
- Produces: `CreateUser`/`ChangePassword` return `422 {"error","violations"}` on policy failure. `NewAuthHandler(authService, teamService, policyService)`.

- [ ] **Step 1: Add the field and constructor param**

In `api/internal/handlers/auth.go`, add `policyService *services.PolicyService` to the `AuthHandler` struct, and update `NewAuthHandler` (line ~34) to accept and assign it:

```go
func NewAuthHandler(authService *services.AuthService, teamService *services.TeamService, policyService *services.PolicyService) *AuthHandler {
	return &AuthHandler{authService: authService, teamService: teamService, policyService: policyService}
}
```

(Match the existing struct-literal style already in the file.)

- [ ] **Step 2: Validate in CreateUser**

In `CreateUser`, immediately **before** `hash, err := h.authService.HashPassword(req.Password)`:

```go
	if violations, err := h.policyService.Validate(c.Request.Context(), req.Password, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load password policy"})
		return
	} else if len(violations) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Password does not meet policy", "violations": violations})
		return
	}
```

- [ ] **Step 3: Validate in ChangePassword**

In `ChangePassword`, immediately **after** the old-password check and **before** `hash, err := h.authService.HashPassword(req.NewPassword)`:

```go
	if violations, err := h.policyService.Validate(c.Request.Context(), req.NewPassword, nil); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load password policy"})
		return
	} else if len(violations) > 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Password does not meet policy", "violations": violations})
		return
	}
```

- [ ] **Step 4: Wire the service in main.go**

In `api/cmd/main.go`, where the other services are constructed (near `authService := ...`), add:

```go
	policyService := services.NewPolicyService(etcdClient)
```

and update the `NewAuthHandler(...)` call to pass `policyService` as the third argument.

- [ ] **Step 5: Build**

Run: `go build -C api ./...`
Expected: exit 0. (If `NewAuthHandler` is called anywhere else, update those call sites too — grep: `grep -rn "NewAuthHandler(" api/`.)

- [ ] **Step 6: Write a handler test for rejection**

Create/append `api/internal/handlers/auth_policy_test.go` — a table test that boots an `httptest` router with `CreateUser`, sends a weak password with a super_admin context, and asserts `422`. Follow the existing handler-test setup if one exists (`grep -rln "httptest" api/internal/handlers`); if none exists, assert at the service layer instead by calling `policyService.Validate(ctx, "weak", nil)` against a real etcd-less default (use `ValidatePassword(models.DefaultPasswordPolicy(), "weak", nil)` and assert non-empty). Minimal service-level test:

```go
package handlers

import (
	"testing"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

func TestWeakPasswordProducesViolations(t *testing.T) {
	if len(services.ValidatePassword(models.DefaultPasswordPolicy(), "weak", nil)) == 0 {
		t.Fatal("expected violations for a weak password")
	}
}
```

- [ ] **Step 7: Run tests**

Run: `go test -C api ./...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add api/internal/handlers/auth.go api/internal/handlers/auth_policy_test.go api/cmd/main.go
git commit -m "feat(auth): enforce password complexity on create and change"
```

---

### Task 5: Settings endpoints (GET/PUT password policy)

**Files:**
- Create: `api/internal/handlers/settings.go`
- Modify: `api/cmd/main.go` (construct `SettingsHandler`; register routes)

**Interfaces:**
- Consumes: `services.PolicyService.LoadPolicy` / `SavePolicy`; `middleware.GetRole`; `models.RoleSuperAdmin`; `services.ErrInvalidPolicy`.
- Produces: `SettingsHandler` with `GetPasswordPolicy(c)` and `UpdatePasswordPolicy(c)`. Routes `GET /api/v1/settings/password-policy` (authenticated) and `PUT /api/v1/settings/password-policy` (super_admin).

- [ ] **Step 1: Create the handler**

Create `api/internal/handlers/settings.go` (ASF header, then):

```go
package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/middleware"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
	"github.com/wboudiche/multi-apisix-dashboard/api/internal/services"
)

type SettingsHandler struct {
	policyService *services.PolicyService
}

func NewSettingsHandler(policyService *services.PolicyService) *SettingsHandler {
	return &SettingsHandler{policyService: policyService}
}

// GetPasswordPolicy returns the effective password policy (any authenticated user).
func (h *SettingsHandler) GetPasswordPolicy(c *gin.Context) {
	p, err := h.policyService.LoadPolicy(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load policy"})
		return
	}
	c.JSON(http.StatusOK, p)
}

// UpdatePasswordPolicy replaces the policy (super_admin only).
func (h *SettingsHandler) UpdatePasswordPolicy(c *gin.Context) {
	if middleware.GetRole(c) != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}
	var p models.PasswordPolicy
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.policyService.SavePolicy(c.Request.Context(), p); err != nil {
		if errors.Is(err, services.ErrInvalidPolicy) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save policy"})
		return
	}
	c.JSON(http.StatusOK, p)
}
```

- [ ] **Step 2: Register routes in main.go**

In `api/cmd/main.go`: construct `settingsHandler := handlers.NewSettingsHandler(policyService)`. In the `protected` group add `protected.GET("/settings/password-policy", settingsHandler.GetPasswordPolicy)`; in the `admin` group add `admin.PUT("/settings/password-policy", settingsHandler.UpdatePasswordPolicy)`.

- [ ] **Step 3: Build**

Run: `go build -C api ./...`
Expected: exit 0.

- [ ] **Step 4: Manual smoke test**

Start the stack (see CLAUDE.md), then:

```bash
TOKEN=$(curl -s -X POST localhost:8086/api/v1/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"<admin-pw>"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s localhost:8086/api/v1/settings/password-policy -H "Authorization: Bearer $TOKEN"      # expect default JSON
curl -s -X PUT localhost:8086/api/v1/settings/password-policy -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"min_length":4,"max_length":72}' -w '\n%{http_code}\n'   # expect 422
```
Expected: GET returns the policy JSON; the PUT with `min_length:4` returns `422`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/handlers/settings.go api/cmd/main.go
git commit -m "feat(auth): add GET/PUT password-policy settings endpoints"
```

---

### Task 6: Frontend policy API client

**Files:**
- Create: `src/apis/policy.ts`

**Interfaces:**
- Produces: `PasswordPolicy` type (snake_case fields matching the Go JSON); `policyApi.get()` / `policyApi.update(p)`; `PolicyViolation` type `{ code: string; params?: Record<string, unknown> }`.

- [ ] **Step 1: Create the client**

Create `src/apis/policy.ts` (ASF header copied from `src/apis/teams.ts`, then):

```ts
import { apiClient } from './client';

export type PasswordPolicy = {
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  history_depth: number;
  expiry_days: number;
  lockout_threshold: number;
  lockout_window_minutes: number;
};

export type PolicyViolation = {
  code: string;
  params?: Record<string, unknown>;
};

export const policyApi = {
  get: async (): Promise<PasswordPolicy> => {
    const response = await apiClient.get<PasswordPolicy>('/api/v1/settings/password-policy');
    return response.data;
  },
  update: async (policy: PasswordPolicy): Promise<PasswordPolicy> => {
    const response = await apiClient.put<PasswordPolicy>('/api/v1/settings/password-policy', policy);
    return response.data;
  },
};
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm exec eslint src/apis/policy.ts --max-warnings=0`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/apis/policy.ts
git commit -m "feat(auth): add password-policy api client"
```

---

### Task 7: i18n keys for settings + policy

**Files:**
- Modify: `src/locales/en/common.json` (source of truth) + `de/es/tr/zh/common.json`

**Interfaces:**
- Produces: `sources.settings`; `settings.*` and `passwordRules.*` keys used by Tasks 8-9.

- [ ] **Step 1: Add keys to en/common.json**

Add a `sources.settings` entry (inside the existing `sources` object) and a new top-level `settings` object:

```json
  "settings": {
    "title": "Settings",
    "passwordPolicy": "Password policy",
    "minLength": "Minimum length",
    "maxLength": "Maximum length",
    "requireUppercase": "Require an uppercase letter",
    "requireLowercase": "Require a lowercase letter",
    "requireDigit": "Require a digit",
    "requireSymbol": "Require a symbol",
    "historyDepth": "Passwords remembered (no reuse)",
    "expiryDays": "Expire after (days, 0 = never)",
    "lockoutThreshold": "Lock after failed attempts (0 = off)",
    "lockoutWindowMinutes": "Lockout duration (minutes)",
    "save": "Save policy",
    "saved": "Password policy saved",
    "saveError": "Failed to save policy",
    "accessDenied": "Only Super Admins can edit settings."
  },
  "passwordRules": {
    "title": "Password must:",
    "min_length": "Be at least {{min}} characters",
    "max_length": "Be at most {{max}} characters",
    "missing_uppercase": "Contain an uppercase letter",
    "missing_lowercase": "Contain a lowercase letter",
    "missing_digit": "Contain a digit",
    "missing_symbol": "Contain a symbol"
  }
```

(Also add `"settings": "Settings"` to the `sources` object.)

- [ ] **Step 2: Mirror the same keys to de/es/tr/zh**

Add the same `settings`, `passwordRules`, and `sources.settings` keys to each of `src/locales/{de,es,tr,zh}/common.json` with translated values (translate the English strings; keep the `{{min}}`/`{{max}}` placeholders intact).

- [ ] **Step 3: Validate JSON + lint gate**

Run: `python3 -c "import json;[json.load(open(f'src/locales/{l}/common.json')) for l in ['en','de','es','tr','zh']];print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "feat(auth): add i18n keys for settings and password rules"
```

---

### Task 8: Settings page + nav entry

**Files:**
- Create: `src/routes/settings/index.tsx`
- Modify: `src/config/navRoutes.ts` (add `/settings` entry)
- Modify: `src/hooks/usePermission.ts:31` (add `/settings` to `SUPER_ADMIN_ONLY`)

**Interfaces:**
- Consumes: `policyApi`, `PasswordPolicy`, `usePermission`.
- Produces: route `/settings` (super_admin) rendering the policy form.

- [ ] **Step 1: Gate the route super_admin-only**

In `src/hooks/usePermission.ts` line 31, change the set to include `/settings`:

```ts
const SUPER_ADMIN_ONLY = new Set(['/users', '/instances', '/teams', '/settings']);
```

- [ ] **Step 2: Add the nav entry**

In `src/config/navRoutes.ts`, append to the `navRoutes` array:

```ts
  {
    to: '/settings',
    label: 'settings',
    icon: 'settings',
  },
```

(The `settings` icon is already in `Navbar.tsx`'s `iconMap`; `label: 'settings'` resolves to `t('sources.settings')` added in Task 7.)

- [ ] **Step 3: Create the Settings page**

Create `src/routes/settings/index.tsx` (ASF header, then a page that loads the policy, renders number inputs + switches, and saves). Use Mantine + TanStack Query + `useTranslation`, following the `teams/index.tsx` super_admin-guard pattern:

```tsx
import { Button, Container, Group, NumberInput, Paper, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type PasswordPolicy, policyApi } from '@/apis/policy';
import { usePermission } from '@/hooks/usePermission';

const Settings = () => {
  const { t } = useTranslation();
  const { isSuperAdmin } = usePermission();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['password-policy'], queryFn: policyApi.get });
  const [form, setForm] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: policyApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['password-policy'] });
      notifications.show({ message: t('settings.saved'), color: 'green' });
    },
    onError: () => notifications.show({ message: t('settings.saveError'), color: 'red' }),
  });

  if (!isSuperAdmin) {
    return (
      <Container size="sm">
        <Paper p="xl" withBorder ta="center">
          <Text c="dimmed">{t('settings.accessDenied')}</Text>
        </Paper>
      </Container>
    );
  }
  if (!form) return null;

  const num = (key: keyof PasswordPolicy, label: string) => (
    <NumberInput
      label={label}
      value={form[key] as number}
      min={0}
      onChange={(v) => setForm({ ...form, [key]: Number(v) || 0 })}
    />
  );
  const sw = (key: keyof PasswordPolicy, label: string) => (
    <Switch
      label={label}
      checked={form[key] as boolean}
      onChange={(e) => setForm({ ...form, [key]: e.currentTarget.checked })}
    />
  );

  return (
    <Container size="sm">
      <Title order={2} mb="lg">{t('settings.passwordPolicy')}</Title>
      <Paper p="xl" withBorder>
        <Stack gap="md">
          {num('min_length', t('settings.minLength'))}
          {num('max_length', t('settings.maxLength'))}
          {sw('require_uppercase', t('settings.requireUppercase'))}
          {sw('require_lowercase', t('settings.requireLowercase'))}
          {sw('require_digit', t('settings.requireDigit'))}
          {sw('require_symbol', t('settings.requireSymbol'))}
          {num('history_depth', t('settings.historyDepth'))}
          {num('expiry_days', t('settings.expiryDays'))}
          {num('lockout_threshold', t('settings.lockoutThreshold'))}
          {num('lockout_window_minutes', t('settings.lockoutWindowMinutes'))}
          <Group justify="flex-end">
            <Button loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
              {t('settings.save')}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
};

export const Route = createFileRoute('/settings/')({
  component: Settings,
});
```

- [ ] **Step 4: Regenerate route tree + typecheck + lint**

Run: `pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm exec eslint src/routes/settings/index.tsx src/config/navRoutes.ts src/hooks/usePermission.ts --max-warnings=0`
Expected: exit 0. (The dev server regenerates `src/routeTree.gen.ts`; if running headless, run `pnpm build` once to regenerate it so `/settings` is a known route.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings/index.tsx src/config/navRoutes.ts src/hooks/usePermission.ts src/routeTree.gen.ts
git commit -m "feat(auth): add super_admin password-policy settings page"
```

---

### Task 9: Password requirement checklist in the create-user form

**Files:**
- Create: `src/components/PasswordRequirements.tsx`
- Modify: `src/routes/users/index.tsx` (render the checklist under the password field ~line 451-455)

**Interfaces:**
- Consumes: `policyApi`, `PasswordPolicy`, the client-side mirror of `ValidatePassword`.
- Produces: `<PasswordRequirements password={...} />` component.

- [ ] **Step 1: Create the checklist component**

Create `src/components/PasswordRequirements.tsx` (ASF header, then). It fetches the policy and shows a ✓/✗ list mirroring the server rules (client-side is UX only; the server remains authoritative):

```tsx
import { List, ThemeIcon } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconDot from '~icons/material-symbols/radio-button-unchecked';

import { policyApi } from '@/apis/policy';

const hasUpper = (s: string) => /[A-Z]/.test(s);
const hasLower = (s: string) => /[a-z]/.test(s);
const hasDigit = (s: string) => /[0-9]/.test(s);
const hasSymbol = (s: string) => /[^A-Za-z0-9]/.test(s);

export const PasswordRequirements = ({ password }: { password: string }) => {
  const { t } = useTranslation();
  const { data: policy } = useQuery({ queryKey: ['password-policy'], queryFn: policyApi.get });
  if (!policy) return null;

  const rules: { ok: boolean; text: string }[] = [
    { ok: password.length >= policy.min_length, text: t('passwordRules.min_length', { min: policy.min_length }) },
    ...(policy.require_uppercase ? [{ ok: hasUpper(password), text: t('passwordRules.missing_uppercase') }] : []),
    ...(policy.require_lowercase ? [{ ok: hasLower(password), text: t('passwordRules.missing_lowercase') }] : []),
    ...(policy.require_digit ? [{ ok: hasDigit(password), text: t('passwordRules.missing_digit') }] : []),
    ...(policy.require_symbol ? [{ ok: hasSymbol(password), text: t('passwordRules.missing_symbol') }] : []),
  ];

  return (
    <List spacing={4} size="sm" center>
      {rules.map((r) => (
        <List.Item
          key={r.text}
          icon={
            <ThemeIcon color={r.ok ? 'green' : 'gray'} size={18} radius="xl" variant="light">
              {r.ok ? <IconCheck width={14} height={14} /> : <IconDot width={14} height={14} />}
            </ThemeIcon>
          }
        >
          {r.text}
        </List.Item>
      ))}
    </List>
  );
};
```

- [ ] **Step 2: Render it in the create-user form**

In `src/routes/users/index.tsx`, import the component (`import { PasswordRequirements } from '@/components/PasswordRequirements';`) and render `<PasswordRequirements password={formData.password} />` immediately after the password `PasswordInput`/`TextInput` (around line 455).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm exec tsc --noEmit -p tsconfig.app.json && pnpm exec eslint src/components/PasswordRequirements.tsx src/routes/users/index.tsx --max-warnings=0`
Expected: exit 0.

- [ ] **Step 4: E2E smoke (Playwright)**

Add/adjust an e2e that logs in as admin, opens `/ui/settings`, sets `min_length` and saves (expects the success toast), then opens the create-user form and types a weak password (expects the checklist to show unmet ✗). Run: `pnpm e2e e2e/tests/password-policy.spec.ts`
Expected: PASS. (If the e2e harness needs the backend on :8086, follow CLAUDE.md "Stack bring-up".)

- [ ] **Step 5: Commit**

```bash
git add src/components/PasswordRequirements.tsx src/routes/users/index.tsx e2e/tests/password-policy.spec.ts
git commit -m "feat(auth): show live password requirement checklist on user create"
```

---

## Phase 1 done — what ships

A super_admin can edit the complexity policy at `/ui/settings`; the backend rejects non-conforming passwords on user creation and password change with structured `422` violations; the create-user form shows a live requirement checklist. History, expiry, forced-change, and lockout are **not** included — they are Phases 2-4 (separate plans).

## Self-review notes

- Spec coverage (Phase 1 rows of §11): complexity validation (Tasks 2-4), policy store in etcd (Tasks 1,3), Settings page (Tasks 7,8), checklist (Task 9), endpoints §7 (Task 5). ✔
- The spec's `Validate(pw, username, history)` signature was simplified to `ValidatePassword(policy, pw, history)` (+ service `Validate(ctx, pw, history)`) because the username-in-password check was dropped with weak-password blocking; `history` is carried now, used in Phase 2.
- No `models.User` changes this phase (correct — complexity/config only).

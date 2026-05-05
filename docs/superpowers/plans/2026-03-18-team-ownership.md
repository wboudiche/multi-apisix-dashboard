# Team Ownership Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable team-based resource isolation so users only see routes, services, and upstreams owned by their team.

**Architecture:** The backend proxy handler already records ownership on resource creation and filters responses by team. This plan wires the frontend to that existing logic: team indicator in header, team select in role assignment, X-Team-ID header for admin team switching.

**Tech Stack:** Go/Gin backend, React/Mantine/Jotai frontend, etcd storage, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-18-team-ownership-design.md`

---

### Task 1: Backend — Add OwnershipService.CountByTeam method

**Files:**
- Modify: `api/internal/services/ownership.go`

- [ ] **Step 1: Add CountByTeam method**

Add to `ownership.go` after the existing `DeleteOwner` method:

```go
func (s *OwnershipService) CountByTeam(ctx context.Context, teamID string) (int, error) {
	resp, err := s.client.GetWithPrefix(ctx, "/ownership/")
	if err != nil {
		return 0, err
	}
	count := 0
	for _, kv := range resp {
		if string(kv.Value) == teamID {
			count++
		}
	}
	return count, nil
}
```

- [ ] **Step 2: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 3: Commit**

```bash
git add api/internal/services/ownership.go
git commit -m "feat: add CountByTeam to OwnershipService"
```

---

### Task 2: Backend — Add GetTeam endpoint and block team deletion

**Files:**
- Modify: `api/internal/handlers/team.go`
- Modify: `api/cmd/main.go`

- [ ] **Step 1: Add ownershipService to TeamHandler**

In `team.go`, update the struct and constructor:

```go
type TeamHandler struct {
	teamService      *services.TeamService
	ownershipService *services.OwnershipService
}

func NewTeamHandler(teamService *services.TeamService, ownershipService *services.OwnershipService) *TeamHandler {
	return &TeamHandler{teamService: teamService, ownershipService: ownershipService}
}
```

- [ ] **Step 2: Add GetTeam handler**

Add after `ListTeams`:

```go
func (h *TeamHandler) GetTeam(c *gin.Context) {
	id := c.Param("id")
	team, err := h.teamService.GetTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if team == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Team not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"value": team})
}
```

- [ ] **Step 3: Update DeleteTeam to check ownership**

Replace the existing `DeleteTeam` handler:

```go
func (h *TeamHandler) DeleteTeam(c *gin.Context) {
	role := middleware.GetRole(c)
	if role != models.RoleSuperAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	id := c.Param("id")

	count, err := h.ownershipService.CountByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("Cannot delete team: it owns %d resources. Reassign or delete them first.", count),
		})
		return
	}

	if err := h.teamService.DeleteTeam(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
```

Add `"fmt"` to imports.

- [ ] **Step 4: Update main.go to wire new dependencies**

In `cmd/main.go`, update the TeamHandler creation:

```go
// Change:
teamHandler := handlers.NewTeamHandler(teamService)
// To:
teamHandler := handlers.NewTeamHandler(teamService, ownershipService)
```

Add `GET /api/v1/teams/:id` route in the admin group:

```go
admin.GET("/teams/:id", teamHandler.GetTeam)
```

- [ ] **Step 5: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 6: Commit**

```bash
git add api/internal/handlers/team.go api/cmd/main.go
git commit -m "feat: add GetTeam endpoint and block deletion if team owns resources"
```

---

### Task 3: Backend — Add team members endpoint

**Files:**
- Modify: `api/internal/handlers/team.go`
- Modify: `api/internal/services/auth.go`
- Modify: `api/cmd/main.go`

- [ ] **Step 1: Add ListUsersByTeam to AuthService**

In `auth.go`, add a method that scans all UserInstance records and filters by TeamID:

```go
func (s *AuthService) ListUsersByTeam(ctx context.Context, teamID string) ([]*models.UserInstance, error) {
	resp, err := s.client.GetWithPrefix(ctx, "/user_instances/")
	if err != nil {
		return nil, err
	}
	var results []*models.UserInstance
	for _, kv := range resp {
		var ui models.UserInstance
		if err := json.Unmarshal(kv.Value, &ui); err != nil {
			continue
		}
		if ui.TeamID == teamID {
			results = append(results, &ui)
		}
	}
	return results, nil
}
```

- [ ] **Step 2: Add authService to TeamHandler**

Update the struct to include authService:

```go
type TeamHandler struct {
	teamService      *services.TeamService
	ownershipService *services.OwnershipService
	authService      *services.AuthService
}

func NewTeamHandler(teamService *services.TeamService, ownershipService *services.OwnershipService, authService *services.AuthService) *TeamHandler {
	return &TeamHandler{teamService: teamService, ownershipService: ownershipService, authService: authService}
}
```

- [ ] **Step 3: Add GetTeamMembers handler**

```go
func (h *TeamHandler) GetTeamMembers(c *gin.Context) {
	id := c.Param("id")
	members, err := h.authService.ListUsersByTeam(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"list": members, "total": len(members)})
}
```

- [ ] **Step 4: Wire in main.go**

Update constructor call:

```go
teamHandler := handlers.NewTeamHandler(teamService, ownershipService, authService)
```

Add route:

```go
admin.GET("/teams/:id/members", teamHandler.GetTeamMembers)
```

- [ ] **Step 5: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 6: Commit**

```bash
git add api/internal/handlers/team.go api/internal/services/auth.go api/cmd/main.go
git commit -m "feat: add team members endpoint"
```

---

### Task 4: Backend — Validate team_id on role assignment

**Files:**
- Modify: `api/internal/handlers/instance.go`

- [ ] **Step 1: Add team validation to SetUserInstanceRole**

In `instance.go`, after the `ShouldBindJSON` call in `SetUserInstanceRole` (around line 263), add validation:

```go
// Validate team_id required for developer/viewer
if req.Role == models.RoleDeveloper || req.Role == models.RoleViewer {
	if req.TeamID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "team_id is required for developer and viewer roles"})
		return
	}
}
```

The InstanceHandler needs access to TeamService to validate the team exists. Add `teamService` to InstanceHandler struct and constructor, then add:

```go
if req.TeamID != "" {
	team, err := h.teamService.GetTeam(c.Request.Context(), req.TeamID)
	if err != nil || team == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team_id: team not found"})
		return
	}
}
```

- [ ] **Step 2: Update InstanceHandler struct and constructor**

```go
type InstanceHandler struct {
	instanceService *services.InstanceService
	authService     *services.AuthService
	teamService     *services.TeamService
}

func NewInstanceHandler(instanceService *services.InstanceService, authService *services.AuthService, teamService *services.TeamService) *InstanceHandler {
	return &InstanceHandler{instanceService: instanceService, authService: authService, teamService: teamService}
}
```

- [ ] **Step 3: Update main.go constructor call**

```go
instanceHandler := handlers.NewInstanceHandler(instanceService, authService, teamService)
```

- [ ] **Step 4: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 5: Commit**

```bash
git add api/internal/handlers/instance.go api/cmd/main.go
git commit -m "feat: validate team_id required for developer/viewer roles"
```

---

### Task 5: Backend — Add team info to GetCurrentUser response

**Files:**
- Modify: `api/internal/handlers/auth.go`

- [ ] **Step 1: Update GetCurrentUser to include team context**

Replace the `GetCurrentUser` handler:

```go
func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.authService.GetUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	user.PasswordHash = ""

	// Build response with team context
	resp := gin.H{
		"id":       user.ID,
		"username": user.Username,
		"email":    user.Email,
		"role":     user.Role,
	}

	// Add team info if instance is selected
	instanceID := c.GetHeader("X-Instance-ID")
	if instanceID != "" {
		ui, err := h.authService.GetUserInstance(c.Request.Context(), userID, instanceID)
		if err == nil && ui != nil && ui.TeamID != "" {
			resp["team_id"] = ui.TeamID
			// Look up team name — need teamService injected
		}
	}

	c.JSON(http.StatusOK, resp)
}
```

Note: The AuthHandler needs a `teamService` reference to look up team names. Add it to the struct and constructor. Then add inside the `ui.TeamID != ""` block:

```go
team, err := h.teamService.GetTeam(c.Request.Context(), ui.TeamID)
if err == nil && team != nil {
	resp["team_name"] = team.Name
}
```

- [ ] **Step 2: Update AuthHandler struct**

Add `teamService *services.TeamService` to the struct and constructor. Update `main.go`:

```go
authHandler := handlers.NewAuthHandler(authService, teamService)
```

- [ ] **Step 3: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 4: Commit**

```bash
git add api/internal/handlers/auth.go api/cmd/main.go
git commit -m "feat: include team_id and team_name in GetCurrentUser response"
```

---

### Task 6: Backend — Support X-Team-ID header in proxy handler

**Files:**
- Modify: `api/internal/handlers/proxy.go`

- [ ] **Step 1: Add effective team resolution at the start of ProxyRequest**

After line 58 (`role := middleware.GetRole(c)`) in `ProxyRequest`, add:

```go
// Resolve effective team ID
var effectiveTeamID string
if role == models.RoleSuperAdmin || role == models.RoleInstanceAdmin {
	// Admins can override team context via header
	effectiveTeamID = c.GetHeader("X-Team-ID")
} else if ui != nil {
	effectiveTeamID = ui.TeamID
}
```

- [ ] **Step 2: Replace all ui.TeamID references with effectiveTeamID**

In the proxy handler, replace references to `ui.TeamID` with `effectiveTeamID` for:
- Pre-mutation ownership check
- Post-mutation ownership recording
- GET response filtering

Guard against nil `ui` for super_admin by using `effectiveTeamID` directly.

- [ ] **Step 3: Build to verify**

Run: `cd api && go build ./cmd/main.go`
Expected: successful build

- [ ] **Step 4: Commit**

```bash
git add api/internal/handlers/proxy.go
git commit -m "feat: support X-Team-ID header for admin team switching"
```

---

### Task 7: Frontend — Add team Jotai atom and API

**Files:**
- Create: `src/stores/team.ts`
- Modify: `src/apis/teams.ts`

- [ ] **Step 1: Create team atom store**

Create `src/stores/team.ts`:

```typescript
import { atom } from 'jotai';

import { currentInstanceIdAtom } from './instance';

const getTeamStorageKey = (instanceId: string) => `team:current_id:${instanceId}`;

// Read the team ID for the current instance from localStorage
const _currentTeamIdAtom = atom<string>('');

export const currentTeamIdAtom = atom(
  (get) => {
    const instanceId = get(currentInstanceIdAtom);
    if (!instanceId) return '';
    return localStorage.getItem(getTeamStorageKey(instanceId)) || '';
  },
  (_get, set, newTeamId: string) => {
    const instanceId = _get(currentInstanceIdAtom);
    if (instanceId) {
      if (newTeamId) {
        localStorage.setItem(getTeamStorageKey(instanceId), newTeamId);
      } else {
        localStorage.removeItem(getTeamStorageKey(instanceId));
      }
    }
    set(_currentTeamIdAtom, newTeamId);
  }
);

export const currentTeamNameAtom = atom<string>('');
```

- [ ] **Step 2: Update teams API**

Add to `src/apis/teams.ts`:

```typescript
getTeam: async (id: string): Promise<Team> => {
  const response = await apiClient.get<{ value: Team }>(`/api/v1/teams/${id}`);
  return response.data.value;
},

getMembers: async (id: string): Promise<any[]> => {
  const response = await apiClient.get<{ list: any[] }>(`/api/v1/teams/${id}/members`);
  return response.data.list || [];
},
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/team.ts src/apis/teams.ts
git commit -m "feat: add team Jotai atom and API functions"
```

---

### Task 8: Frontend — Add X-Team-ID to Axios interceptors

**Files:**
- Modify: `src/config/req.ts`
- Modify: `src/apis/client.ts`

- [ ] **Step 1: Add X-Team-ID to req.ts interceptor**

In `src/config/req.ts`, inside the request interceptor (after the `X-Instance-ID` header block around line 68), add:

```typescript
// Get current team ID for admin team switching
const teamId = localStorage.getItem(
  `team:current_id:${instanceId}`
) || '';
if (teamId) {
  conf.headers.set('X-Team-ID', teamId);
}
```

- [ ] **Step 2: Add X-Team-ID to client.ts interceptor**

In `src/apis/client.ts`, inside the request interceptor (after the Authorization header), add:

```typescript
const instanceId = localStorage.getItem('instance:current_id') || '';
if (instanceId) {
  config.headers['X-Instance-ID'] = instanceId;
}
const teamId = localStorage.getItem(`team:current_id:${instanceId}`) || '';
if (teamId) {
  config.headers['X-Team-ID'] = teamId;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/config/req.ts src/apis/client.ts
git commit -m "feat: add X-Team-ID header to both Axios interceptors"
```

---

### Task 9: Frontend — Add team indicator/switcher in header

**Files:**
- Modify: `src/components/Header/index.tsx`

- [ ] **Step 1: Add team switcher component to header**

Import the team atom and API:

```typescript
import { useAtom, useAtomValue } from 'jotai';
import { currentTeamIdAtom, currentTeamNameAtom } from '@/stores/team';
import { teamApi } from '@/apis/teams';
```

Create a `TeamSwitcher` component that:
- For `developer`/`viewer`: shows a read-only `Badge` with team name from `GET /api/v1/user` response
- For `super_admin`/`instance_admin`: shows a `Select` dropdown with "All Teams" + team list from `GET /api/v1/teams`
- On change: updates `currentTeamIdAtom`, invalidates TanStack Query cache for routes/services/upstreams

```typescript
const TeamSwitcher = () => {
  const [teamId, setTeamId] = useAtom(currentTeamIdAtom);
  const user = /* get from existing auth state */;
  const isAdmin = user?.role === 'super_admin' || user?.role === 'instance_admin';
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (isAdmin) {
      teamApi.list().then(setTeams);
    }
  }, [isAdmin]);

  if (!isAdmin) {
    // Read-only badge for non-admins
    return teamName ? <Badge>{teamName}</Badge> : null;
  }

  const options = [
    { value: '', label: 'All Teams' },
    ...teams.map(t => ({ value: t.id, label: t.name }))
  ];

  return (
    <Select
      data={options}
      value={teamId || ''}
      onChange={(val) => {
        setTeamId(val || '');
        queryClient.invalidateQueries({ queryKey: ['routes'] });
        queryClient.invalidateQueries({ queryKey: ['services'] });
        queryClient.invalidateQueries({ queryKey: ['upstreams'] });
      }}
      size="xs"
      placeholder="All Teams"
    />
  );
};
```

- [ ] **Step 2: Place TeamSwitcher in the header layout**

Add it after the instance selector in the header JSX, following the existing pattern.

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:5173/ui` and verify:
- Admin sees team dropdown in header
- Switching team triggers resource list refetch
- Team selection persists per instance

- [ ] **Step 4: Commit**

```bash
git add src/components/Header/index.tsx
git commit -m "feat: add team indicator and switcher in header"
```

---

### Task 10: Frontend — Validate team in user-instance role form

**Files:**
- Modify: `src/routes/users/index.tsx`

- [ ] **Step 1: Add required validation for team field**

The team select already exists in the users page (around line 498-509). Add conditional required validation:

- When role is `developer` or `viewer`, show the team select and make it required
- When role is `instance_admin`, hide the team select
- Block form submission if developer/viewer has no team selected

Find the form submission handler (around line 145-161) and add validation:

```typescript
if ((config.role === 'developer' || config.role === 'viewer') && !config.team_id) {
  notifications.show({
    message: 'Team is required for developer and viewer roles',
    color: 'red',
  });
  return;
}
```

- [ ] **Step 2: Conditionally show/hide team select**

Wrap the team select (around line 498-509) with a condition:

```typescript
{config?.role && config.role !== 'instance_admin' && (
  <Select
    label="Team"
    placeholder="Select team"
    data={teamOptions}
    value={config?.team_id || null}
    onChange={(val) => /* existing handler */}
    required
  />
)}
```

- [ ] **Step 3: Verify in browser**

Navigate to Users page, edit a user, try to assign developer role without team — should show error.

- [ ] **Step 4: Commit**

```bash
git add src/routes/users/index.tsx
git commit -m "feat: require team selection for developer/viewer roles"
```

---

### Task 11: Integration test — verify team filtering end to end

**Files:**
- Test manually in browser

- [ ] **Step 1: Restart backend**

```bash
kill $(lsof -t -i:8086) 2>/dev/null
cd api && PORT=8086 go run ./cmd/main.go &
```

- [ ] **Step 2: Create test scenario**

1. Create two teams: "Team Alpha" and "Team Beta"
2. Create two users: "alice" (developer, Team Alpha) and "bob" (developer, Team Beta)
3. Log in as alice → create a route → verify it's visible
4. Log in as bob → verify alice's route is NOT visible
5. Log in as admin → verify both routes visible
6. Admin selects "Team Alpha" in switcher → verify only alice's route visible

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for team ownership"
```

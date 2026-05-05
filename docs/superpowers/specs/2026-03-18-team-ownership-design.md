# Team Ownership — Design Spec

## Problem

The dashboard supports multiple APISIX instances and multiple users, but all users on an instance see all resources. There is no isolation between teams sharing the same gateway. A developer on "Team Payments" can see and modify routes created by "Team Security."

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Team required? | Required for developer/viewer, optional for admins | Admins need cross-team visibility; developers need isolation |
| Team scope | One team per user per instance | Matches real orgs — same person, different roles on different environments |
| Team deletion | Block if team owns resources | Prevents orphaned resources and data loss |
| Team visibility in UI | Header bar indicator, always visible | Users must know their context to understand why they see certain resources |
| Admin team switching | Dropdown in header to view as any team | Enables debugging and support without switching accounts |
| Unowned resources | Visible to everyone (including admins with X-Team-ID set) | Backwards compatible with pre-team resources |
| Resource types covered | Routes, services, upstreams only | These are the team-scoped resources. Consumers, SSLs, global rules, plugins are instance-wide shared resources |

## Architecture

### Data Flow

```
User logs in → JWT has global role
    ↓
Super admin assigns User → Instance with TeamID (ITU binding)
    ↓
User makes request with X-Instance-ID header
    ↓
RBAC Middleware fetches UserInstance (includes TeamID) → stored in context
    ↓
Proxy Handler:
  - Read effective TeamID: from UserInstance.TeamID, or from X-Team-ID header (admins only)
  - Pre-check: Is this resource owned by my team? (mutations)
  - Execute proxy to APISIX
  - Post-check: Record new resource under effective TeamID (creates)
  - Post-check: Filter list responses by effective TeamID (reads)
```

### Storage (etcd)

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `/user_instances/{userID}/{instanceID}` | UserInstance JSON (includes TeamID) | User-team-instance binding |
| `/ownership/{instanceID}/{resourceType}/{resourceID}` | TeamID string | Resource ownership |
| `/teams/{teamID}` | Team JSON | Team metadata |

### Existing Backend (already built)

- `OwnershipService`: SetOwner, GetOwner, DeleteOwner
- `UserInstance.TeamID` field stored and retrieved
- Proxy handler: pre-mutation ownership check, post-mutation recording, GET response filtering
- RBAC middleware: populates team context from UserInstance

## Backend Changes

### New Endpoints

#### `GET /api/v1/teams/:id`
Returns single team details.

**Response:** `{ "value": { "id": "...", "name": "...", "description": "..." } }`

#### `GET /api/v1/teams/:id/members`
Lists all UserInstance records where TeamID matches, across all instances. Uses a full prefix scan of `/user_instances/` and filters by TeamID value. Acceptable for current scale (tens of users, not thousands).

**Response:** `{ "list": [{ "user_id": "...", "username": "...", "instance_id": "...", "instance_name": "...", "role": "..." }], "total": N }`

### Updated Endpoints

#### `DELETE /api/v1/teams/:id`
Before deleting, scan all `/ownership/` keys and check if any value matches the team ID. If so, return 409 Conflict:

```json
{ "error": "Cannot delete team: it owns 5 resources. Reassign or delete them first." }
```

New method: `OwnershipService.CountByTeam(ctx, teamID) (int, error)` — full prefix scan of `/ownership/`, filters values matching teamID. Acceptable at current scale.

#### `GET /api/v1/user`
Include `team_id` and `team_name` for the user's current instance. The handler reads `X-Instance-ID` from the request header, looks up the UserInstance to get TeamID, then looks up the Team for the name. Returns `team_id: null, team_name: null` when no instance is selected or user has no team on that instance.

**Added fields:** `{ ..., "team_id": "abc", "team_name": "Payments" }`

#### `POST /api/v1/user-access/:user_id/instances/:instance_id/role`
Validate: if role is `developer` or `viewer`, `team_id` is required and must reference an existing team. Return 400 if missing or invalid.

### X-Team-ID Header

**Where it is read:** The proxy handler reads `X-Team-ID` directly from the request header at the start of `ProxyRequest()`.

**Resolution logic:**
1. Get `UserInstance` from RBAC middleware context (nil for super_admin)
2. Read `X-Team-ID` from request header
3. Determine effective TeamID:
   - If user is `super_admin` or `instance_admin`: use `X-Team-ID` header value (empty = no filtering = see all)
   - If user is `developer`/`viewer`: always use `UserInstance.TeamID` (ignore header)
4. Pass effective TeamID to all ownership checks and filtering logic

**RBAC middleware change:** For `super_admin`, the middleware currently does an early return without fetching UserInstance. This remains unchanged — the proxy handler handles the `X-Team-ID` header independently of the middleware.

## Frontend Changes

### 1. Header Team Indicator

**Layout:**
```
[Instance: Local APISIX ▼] [Team: Payments ▼] [🔔] [⚙️] [admin ▼]
```

**Behavior by role:**
- `developer`/`viewer`: read-only badge showing team name
- `super_admin`/`instance_admin`: dropdown with "All Teams" (default, no filtering) + list of teams

**State:** New Jotai atom `currentTeamIdAtom`. localStorage key is `team:current_id:{instanceId}` — scoped per instance so switching instances remembers the previous team selection. When instance changes, read the stored team for that instance (or default to "All Teams" for admins).

**Data source:** `GET /api/v1/user` returns team_id for current instance. Admin team list from `GET /api/v1/teams`.

**On team switch:** Invalidate all TanStack Query caches for resource lists (routes, services, upstreams) to trigger a refetch with the new `X-Team-ID` header.

### 2. Axios Interceptors

Add `X-Team-ID` header to **both** Axios instances when an admin has selected a team:
- `src/config/req.ts` (the `req` instance — used for APISIX proxy requests)
- `src/apis/client.ts` (the `apiClient` instance — used for dashboard API requests)

Both need it because the team context affects proxy responses and the `/api/v1/user` endpoint.

### 3. User-Instance Role Assignment Form

Add team `Select` field to the role assignment UI:
- Visible when role is `developer` or `viewer`
- Hidden when role is `instance_admin`
- Required validation — cannot submit without team for developer/viewer
- Data from `GET /api/v1/teams`
- Pre-fills when editing existing assignment

### 4. Team API Client

Update `src/apis/teams.ts`:
- `getTeam(id)` — single team fetch
- `getTeamMembers(id)` — list members

## Not In Scope

- Performance optimization of proxy-level response filtering (full scans acceptable at current scale)
- Audit logging on ownership changes
- Ownership cascade cleanup on team deletion (blocked by design)
- Dedicated team member add/remove UI (managed through user-instance role assignment)
- Cross-team resource sharing or transfer
- Ownership for consumers, SSLs, global rules, plugins (instance-wide shared resources)

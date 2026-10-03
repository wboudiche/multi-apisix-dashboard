# Several teams per instance, one role per team — design

Date: 2026-10-03

## Goal

Let a user belong to several teams on the same APISIX instance, with a role
per team: viewer in one team and developer in another, or developer in two.
Memberships on different instances stay independent of each other. End-to-end
tests cover a user with several teams on one instance and teams on different
instances.

## Starting point (origin/main at #393)

- `models.UserInstance{UserID, InstanceID, TeamID, Role, Scope}` is stored at
  `/apisix-dashboard/user_instances/<user>/<instance>`: one role and one team
  per (user, instance).
- For a non-admin, `callerTeamScope` (`handlers/caller_scope.go`) returns
  `ui.TeamID`. The proxy uses it for three things:
  - filtering lists and single reads (`nonAdminMayAccess`: owner == team);
  - allowing writes to an existing resource;
  - naming the owner of a resource it creates (`SetOwnerIfUnowned`).
- An admin's team comes from `X-Team-ID`. The SPA sends that header only for a
  `super_admin` (`selectedTeamId`, #203).
- Developers and viewers get 403 from `/api/v1/teams`, so they do not know
  their teams' names.
- `Scope` is stored and returned but never enforced. The SPA also sends
  `pathPrefixes` in camelCase, which Go ignores.
- `GET /user` returns `team_id`/`team_name`, but nothing reads them.
- `DeleteTeam` leaves assignments that point at the deleted team. That is a
  pre-existing defect and is out of scope here.

## Decisions

| Question | Decision |
|---|---|
| Where the role lives | Per (user, instance, team) for `developer`/`viewer`. `instance_admin` stays per (user, instance) and excludes team memberships. `super_admin` is unchanged. |
| Storage | Keep one key per (user, instance) and change its value (approach A). Rejected: a key per triplet (a prefix list on every proxied request, plus two sources of truth for `instance_admin`); members under the team (scans every team on the hot path). |
| Migration | On read, in `UnmarshalJSON`. Records are rewritten in the new shape only when an admin next saves them. No script and no startup step. |
| Reads | Union: a non-admin sees every resource owned by any of their teams, whatever their role in it. |
| Writes to an existing resource | Allowed when the owner is one of the caller's developer teams; otherwise 403. |
| Owner of a create | `X-Team-ID` if the caller is a developer in that team. If the header is absent and the caller has exactly one developer team, that team. Otherwise refused before APISIX is called. |
| Old request body `{role, team_id}` | No longer accepted. The only callers (SPA, e2e helpers) move in the same change. |
| `Scope` | Removed from the model, the API, the SPA and the e2e helper. Old records that carry it still decode. |
| `GET /user` `team_id`/`team_name` | Removed. |
| Dangling memberships after `DeleteTeam` | Out of scope; a follow-up issue, explained first. |

## Data model

```go
type TeamMembership struct {
    TeamID string `json:"team_id"`
    Role   string `json:"role"` // developer | viewer
}

type UserInstance struct {
    UserID     string           `json:"user_id"`
    InstanceID string           `json:"instance_id"`
    Role       string           `json:"role,omitempty"` // "instance_admin" or ""
    Teams      []TeamMembership `json:"teams,omitempty"`
}
```

**Invariants** (checked on write, 400 otherwise):

- Exactly one of: `Role == "instance_admin"` with no teams, or `Role == ""`
  with at least one team.
- Every team role is `developer` or `viewer`, and every team exists.
- No team appears twice.

**Decoding old records:**

| Stored | Decoded |
|---|---|
| `{"role":"developer"\|"viewer","team_id":"t1"}` | `Teams: [{t1, role}]`, `Role: ""` |
| `{"role":"instance_admin","team_id":…}` | `Role: "instance_admin"`, team dropped (an admin's team already comes from the header) |
| `{"role":"developer"\|"viewer","team_id":""}` | an assignment with no teams. It sees no team-owned resource, as today. It reports `InstanceRole()` = the stored role, so the instance stays listed and the viewer gate still applies. |
| any record with `scope` | `scope` ignored |

A record with no teams and no role can only come from the last case. Writes
never produce one.

**Helpers on `UserInstance`:**

- `RoleIn(teamID) string`: the role in that team, or `""`.
- `ReadableTeams()`, `WritableTeams()`: all teams, and the developer teams.
- `InstanceRole() string`: the strongest role on the instance
  (`instance_admin` > `developer` > `viewer`). It is used wherever a single
  role is needed: the viewer GET-only gate, `HasResourcePermission`,
  `require_resource_permission`, `hasAccess`.

## Proxy and route test

`callerTeamScope` returns a `teamScope` instead of `(isAdmin, teamID)`:

```go
type teamScope struct {
    isAdmin  bool
    readable map[string]bool
    writable map[string]bool
    createAs string // owner for a resource with no owner yet; "" if none
}
func (s teamScope) mayRead(owner string) bool  // isAdmin || readable[owner]
func (s teamScope) mayWrite(owner string) bool // isAdmin || writable[owner]
```

- **Admin** (`super_admin` in the JWT, or `Role == instance_admin`):
  `createAs = X-Team-ID`. Optional, as today.
- **Non-admin**, deciding `createAs`:
  1. If `X-Team-ID` is set and in `writable`, use it.
  2. If `X-Team-ID` is set but not in `writable`, the scope carries a refusal
     reason.
  3. If `X-Team-ID` is absent and exactly one team is writable, use that team.
  4. Otherwise `createAs = ""`.
- **List filtering and single `GET`:** `mayRead(owner)`. A resource with no
  owner stays hidden from non-admins.
- **`PUT`/`PATCH`/`DELETE` on an id with an owner:** `mayWrite(owner)`,
  otherwise 403 with a reason naming the caller's role in that team. A
  resource the caller cannot read is still answered as not found.
- **A write to a team-scoped id with no owner yet, by a non-admin:** refused
  before APISIX is called when `createAs` is empty or the header was refused:
  - 400 when the caller has several developer teams and sent none;
  - 403 when the header names a team they cannot write to.

  This keeps a create from producing a resource nobody owns.
- **Recording the owner:** `SetOwnerIfUnowned(createAs)`. A resource that
  already has a team keeps it (#260).
- **The viewer gate in `RBACMiddleware`** uses `InstanceRole()`. A caller who
  is a viewer in every team is still stopped at the door.
- **`ReassignOwnership`** and **`isLabelAdmin`**: admin only, unchanged
  (`Role == instance_admin`).
- **Route test** (`route_test_handler.go`): it may test a route the caller
  can read (`mayRead`).

## API

`POST /api/v1/user-access/:user_id/instances/:instance_id/role`

```json
{ "role": "instance_admin" }
{ "teams": [ {"team_id": "t1", "role": "viewer"}, {"team_id": "t2", "role": "developer"} ] }
```

- Invariants are checked here. `{"teams": []}` with no role deletes the
  assignment, the same as `DELETE`.
- The response echoes the stored record.

`GET /api/v1/user-access/:user_id/instances` returns the new shape. Every
membership carries `team_name`, resolved at read time (empty for a deleted
team). This is how a non-admin's SPA names their teams.

`GET /api/v1/teams/:id/members` returns
`{user_id, instance_id, role}` for every assignment listing that team, with
`role` being the role in that team.

`GET /api/v1/user` no longer returns `team_id`/`team_name`.

Maintenance: `OrphanedAssignment` reports `role` and `teams` instead of
`role` and `team_id`. Detection (the user no longer exists) is unchanged.

Unchanged: assignment counting and deletion on instance delete (key-based),
the quoting fallbacks in `rbac.go`, the overview.

## SPA

**Types** (`src/apis/instances.ts`):

- `UserInstanceRole` becomes `{user_id, instance_id, role?, teams?: {team_id, team_name, role}[]}`.
- `SetUserRoleRequest` becomes `{role: 'instance_admin'} | {teams: {team_id, role}[]}`.
- `Scope` is removed.

**`usePermission`:**

- New: `teams` (memberships on the current instance).
- New: `canCreate`, true for an admin or when the user is a developer in at
  least one team. For a user with several developer teams it also requires a
  valid header pick.
- New: `canWriteOwner(teamId)`, true for an admin or a developer in that team.
- `canEdit`/`canDelete`/`canWriteResource` keep their current meaning,
  computed from `InstanceRole`, for pages that are not team-scoped.

**Per-row gating** on team-scoped pages (routes, services, upstreams,
consumers, consumer_groups, stream_routes and their nested lists and details):

- Edit, delete and the batch-delete checkbox use
  `canWriteOwner(record.__team_id)`.
- Detail pages use `canWriteOwner(detail.__team_id)`.
- `DeleteResourceBtn` and the edit link take the owner team as a prop.

**Header:**

| Caller | Header shows | `X-Team-ID` sent |
|---|---|---|
| super_admin | switcher over all teams (unchanged) | the pick |
| instance_admin | unchanged (no switcher, #203) | none |
| non-admin, ≥2 developer teams | "Team for new resources" switcher over those teams | the pick, if still one of them |
| non-admin, otherwise | one badge per membership, `team · role` | none |

- `selectedTeamId` returns the pick for the third row too. A pick that is no
  longer a developer team of the caller is treated as no pick, so the switcher
  asks again and `canCreate` stays false.
- `clearTeamPicks` on sign-in stays as is.

**Users page, Permissions modal** (one block per instance):

```
local          ( ) No access  ( ) Instance admin  (•) By team
               ┌────────────────┬─────────────┬───┐
               │ Payments     ▾ │ developer ▾ │ ✕ │
               │ Catalogue    ▾ │ viewer    ▾ │ ✕ │
               └────────────────┴─────────────┴───┘
               + Add a team
```

- A team already chosen in a row is not offered in the other rows.
- "By team" with no rows is refused with the existing `users.teamRequired`.
- The users table's Teams column shows one `team · role` badge per
  membership across instances, with the instance name as a tooltip.

All new strings go in `en` plus `de`, `es`, `tr`, `zh`, under the existing
ESLint rules (`no-literal-string`, `icon-button-name` for ✕).

## Testing

**Go unit tests:**

- Decoding the old and new shapes, and the invariants.
- `teamScope`: read, write and `createAs` across the full case table (admin
  with and without a header; non-admin with 0, 1 or 2 developer teams, with
  no header, with a header naming a writable team, with a header naming a
  viewer team or an unrelated team).
- The proxy's refusal of an ownerless create.
- Existing tests move to the new shape: `route_test_team_test.go`,
  `require_resource_permission_test.go`, `maintenance_test.go`.
  `ownership_access_test.go` becomes the `teamScope` tests.

**Vitest:** `usePermission` (`canCreate`, `canWriteOwner`), and
`selectedTeamId` for a non-admin with a stale pick.

**E2E, new `e2e/tests/users.multi-team.spec.ts`.** Fixtures: teams T1, T2 and
T4 on `local`, T3 on `staging`, user alice, and one admin-created route per
team.

1. In the Permissions modal, alice gets viewer in T1 and developer in T2 on
   `local`. After a reload both rows read back, and the Users table shows
   both badges.
2. alice sees the T1 and T2 routes on `local`, and not the T4 route.
3. She can edit the T2 route. The T1 route shows no edit or delete, and a
   direct proxy `PUT` gets 403.
4. As viewer T1 + developer T2, she creates a route without choosing, and it
   is owned by T2.
5. As developer in T1 and T2:
   - the header offers T1 and T2, and her create is owned by the team she
     picked;
   - a proxy create with no header gets 400, and one with `X-Team-ID: T4`
     gets 403;
   - she can edit both teams' routes.
6. The admin removes T2. alice no longer sees the T2 route and keeps T1. A
   stale T2 pick is not sent.
7. As developer T2 on `local` and viewer T3 on `staging`, switching instance
   in the header changes the list and the rights: she can edit on `local`
   and only read on `staging`.
8. An old-shape record written straight to etcd still reads, displays and
   grants the same rights.

**Existing e2e:**

- `ensureUserInstanceRole` keeps accepting `{role, team_id}` and translates it.
  A new `teams` input covers several teams, and the unused `scope` option is
  removed.
- `maintenance.orphaned-assignments` keeps writing the old shape and expects
  `teams` in the report.
- `users.admin` checks the member role.
- `permission.role-loading` and `access-unreadable` get updated mocked
  responses.

**Verification before the PR:**

1. `go test ./...`
2. `pnpm lint --no-cache`
3. `tsc -b`
4. vitest
5. The new spec and the touched specs, against the worktree's own backend
   (`:18086`) and vite (`:5175`). Targeted only: a full parallel run saturates
   the machine.

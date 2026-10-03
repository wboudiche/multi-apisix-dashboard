# A role per team — design

Date: 2026-10-03

## Goal

Give a user a role per team on an instance: viewer in one team and developer
in another, or developer in two. `instance_admin` stays instance-wide.
Memberships on different instances stay independent. End-to-end tests cover a
user with several teams and different roles on one instance, and teams on
different instances.

## Starting point (origin/main at #393)

#374 and #376 already let an assignment hold several teams on one instance.
What they built, and what this design keeps:

- `UserInstance{UserID, InstanceID, TeamIDs []string, Role}` is stored at
  `/apisix-dashboard/user_instances/<user>/<instance>` as
  `{user_id, instance_id, team_ids, team_id, role}`. `team_id` is the first
  team, written for older clients and for a rollback. Records from before the
  list are read as a list of one.
- `teamScope` (`handlers/caller_scope.go`) for a non-admin:
  - reads are the union of their teams (`mayAccess`);
  - `X-Team-ID` naming one of their teams narrows a list (`chosen`) and names
    the owner of a create (`acting`);
  - with no header, a create goes to their only team; with several teams it is
    refused with 400 `team_required`;
  - a team that is not theirs is refused with 403 `team_not_assigned`.
- `/user` and the caller's own `/user-access` list carry `teams: [{id, name}]`,
  which is how a non-admin learns their teams' names.
- The header gives a non-admin with several teams a switcher ("All my teams"
  plus their teams). With one team they get a badge.
- The Users page edits, per instance, a role `Select` and a teams
  `MultiSelect`.
- Deleting a team that an assignment names is refused (#379). Scope is gone
  (#388).

What is missing is a role per team. `Role` covers every team of the
assignment, and each check reads it once, before anything knows which team the
request touches:

- the viewer GET-only gate (`middleware/rbac.go`);
- `HasResourcePermission(effRole, …)` in the proxy;
- `require_resource_permission` (test-route, test-upstream, wsdl);
- `hasAccess`, `isLabelAdmin`, `ReassignOwnership`.

The SPA gates writes on the account's role on the instance only. No page gates
a row by its `__team_id`.

## Decisions

| Question | Decision |
|---|---|
| Where the role lives | Per (user, instance, team) for `developer`/`viewer`. `instance_admin` stays per (user, instance). `super_admin` is unchanged. |
| Storage | Same key. New field `team_roles: {team_id: role}` beside `team_ids` (`teams` is already the name of the `{id, name}` view in responses). |
| Meaning of `role` | For a non-admin, the **strongest** of their team roles (developer > viewer), in memory, in storage and in responses. Every existing check that reads `ui.Role` (the viewer gate, the resource-type check, `hasAccess`, label and reassign admin checks) stays correct unchanged. |
| Old records | No `team_roles`: every team has `role`. That is exactly what they meant. No script; the next save writes the new field. |
| Reads | Unchanged: the union of every team, whatever the role in it. |
| Writes to an owned resource | Only if the caller is a developer in the owning team. Otherwise 403 with the new code `team_read_only`. |
| Owner of a create | The named team if the caller is a developer in it. With no header, their only developer team. A named viewer team gives 403 `team_read_only`. Several developer teams and no header give 400 `team_required`, as today. |
| Route test | Requires developer in the route's team. A viewer cannot test routes today, and a viewer team must not change that. |
| Rollback | A binary from before this change reads `role` (the strongest) for every team, so a viewer team becomes writable until the record is saved again. Accepted: it only affects users given mixed roles after this ships, and a rollback is exceptional. |
| Dangling memberships, scope | Already handled (#379, #388). |

## Data model (`api/internal/models/models.go`)

```go
type UserInstance struct {
    UserID     string
    InstanceID string
    TeamIDs    []string
    // TeamRoles is the role in each team of TeamIDs, developer or viewer.
    // Empty for an instance admin.
    TeamRoles  map[string]string
    // Role is instance_admin, or for a non-admin the strongest of TeamRoles.
    Role       string
}
```

`userInstanceJSON` gains `TeamRoles map[string]string 'json:"team_roles,omitempty"'`.

**`UnmarshalJSON`:**

- Teams are read as today (`TeamIDsFrom`).
- If `role` is `instance_admin`: `TeamRoles = nil`.
- Otherwise, for each team, take `team_roles[team]` if it is developer or
  viewer, else `role`. If the stored `role` is itself neither, the team gets
  nothing and stays out of `TeamRoles`.
- `Role` is then recomputed as the strongest value in `TeamRoles`, or the
  stored `role` when `TeamRoles` is empty. That last case is a legacy
  developer/viewer with no team, which keeps today's behaviour.
- Entries of `team_roles` for teams not in the list are dropped.

**`MarshalJSON`:** writes `team_ids`, `team_id` (first team), `team_roles`
(nil for an admin; never null otherwise) and `role` (the strongest).

**New methods:**

```go
func (ui UserInstance) RoleIn(teamID string) string // "" if not a member
func (ui UserInstance) CanWrite(teamID string) bool  // RoleIn == developer
func (ui UserInstance) WritableTeams() []string      // developer teams, in TeamIDs order
func StrongestRole(roles map[string]string) string  // developer > viewer > ""
```

## Assignment API (`handlers/instance.go`)

`SetUserInstanceRoleRequest` gains `TeamRoles map[string]string 'json:"team_roles"'`.

- `role` stays required. For a non-admin it is the role of every team that
  `team_roles` does not name, so `{role: "developer", team_ids: [a, b]}` keeps
  meaning developer in both. Every existing client and the e2e seeding keep
  working.
- `team_roles` keys must be teams of the request's list. Values must be
  `developer` or `viewer`. Otherwise 400, naming the offending team.
- `team_roles` with `role: instance_admin`: 400.
- The #374 rule is unchanged: `team_id` alone, naming a team the assignment
  already holds, keeps the list. In that case it also keeps the stored
  `team_roles`, so a client that knows one team does not reset the others'
  roles.
- The stored record has full `team_roles` and `role` = strongest. It is
  echoed in the response.

**Readers:**

- The caller's own `/user-access` list and `/user`: each `teams` entry
  becomes `{id, name, role}`.
- `/teams/:id/members` returns the raw record, which now carries
  `team_roles`.
- The maintenance orphan report adds `team_roles`.

## Proxy and route test (`handlers/caller_scope.go`, `proxy.go`, `route_test_handler.go`)

`teamScope` gains:

```go
writable  []string // a non-admin's developer teams
readOnly  bool     // the named team is theirs but they are a viewer in it
```

- `mayWrite(owner) bool`: `owner != "" && owner ∈ writable`.
- **`callerTeamScope`, non-admin:**
  - no header: `acting` = their only **writable** team, if exactly one;
  - header naming one of their teams: `chosen = named`, so a viewer team
    still narrows lists. If it is writable, `acting = named`; otherwise
    `readOnly = true`;
  - foreign header: unchanged.
- **Ownerless create** (`createNeedsTeam` true, proxy.go:642 and :689): 403
  `team_read_only` when `readOnly`, otherwise 400 `team_required` as today.
- **Write to an owned resource** (proxy.go:696):
  - `!mayAccess(owner)`: 403 "owned by another team", unchanged;
  - `mayAccess && !mayWrite`: 403 `team_read_only`, "You are a viewer in the
    team that owns this resource".
- **Lists and single reads:** unchanged (`lists`, `mayAccess`).
- **Route test:** `!mayWrite(owner)` is refused. A route the caller cannot
  read keeps `routeTestOtherTeamCode`. A readable route in a viewer team gets
  403 `team_read_only`.
- `team_read_only` is a new constant beside `team_required` and
  `team_not_assigned`.

## SPA

**Types** (`src/apis/instances.ts`):

- `UserInstanceRole` gains `team_roles?: Record<string, 'developer' | 'viewer'>`.
- `teams` entries gain `role`.
- `SetUserRoleRequest` gains `team_roles?`.
- A helper `roleInTeam(assignment, teamId)`.

**Permissions** (`usePermission`, `stores/team.ts`):

- `ownTeamsAtom` entries carry `role`. `writableTeams` is derived from them.
- New `canWriteOwner(teamId)`: true for an admin, or a developer in that team.
- `canCreate` for a non-admin:
  - with a pick: the pick is a developer team;
  - with no pick: exactly one developer team.

  This mirrors the proxy's `acting`.
- `canEdit`, `canDelete` and `canWriteResource` keep their meaning, from the
  instance role, for pages that are not team-scoped.

**Per-row gating** on team-scoped pages (routes, services, upstreams,
consumers, consumer_groups, stream_routes; lists, nested lists, details):

- Edit, delete and the batch-delete checkbox use
  `canWriteOwner(record.__team_id)`.
- Details use `canWriteOwner(detail.__team_id)`.
- `DeleteResourceBtn` and the edit actions take the owner as a prop.

**Header:**

- The non-admin switcher still lists every team of the caller (for
  narrowing), each labelled `name · role`.
- The single-team badge shows `name · role`.

**Refusals:** `src/utils/team-refusal.ts` maps `team_read_only` to a new
`error.teamReadOnly` message.

**Users page, per instance:**

- The role `Select` offers `instance_admin`, or "By team".
- "By team" shows one row per team: a team select, a role select (developer
  or viewer), and a ✕. Below the rows, "+ Add a team". A team chosen in one
  row is not offered in the others.
- Save sends:

  ```
  {role: strongest, team_ids: rows in order, team_roles: every row}
  ```

- No rows: the existing `users.teamRequired`.
- The Teams column shows one `team · role` badge per membership, with the
  instance in the tooltip.

New strings go in `en`, `de`, `es`, `tr`, `zh`.

## Testing

**Go:**

- `user_instance_test.go`:
  - a legacy record with no `team_roles` gives every team `role`;
  - `team_roles` overrides per team;
  - `role` is recomputed as the strongest;
  - stray `team_roles` keys are dropped;
  - an admin has no `team_roles`;
  - a round-trip keeps everything.
- `instance_role_validation_test.go`:
  - unknown team key gives 400;
  - a bad role value gives 400;
  - `team_roles` with `instance_admin` gives 400;
  - `team_id` alone keeps `team_roles`.
- `caller_scope_test.go`: `acting`, `readOnly`, `mayWrite` for viewer+developer
  and developer+developer, with no header, a developer header, a viewer header
  and a foreign header.
- Proxy: an owned write in a viewer team gives `team_read_only`; an ownerless
  create with a viewer header gives `team_read_only`.
- `route_test_team_test.go`: a viewer team's route is refused.

**Vitest:** `canWriteOwner`, `canCreate` (pick or no pick; 0, 1 or 2
developer teams), `ownTeamsAtom` roles, `team-refusal` for `team_read_only`.

**E2E, new `e2e/tests/multi-team.roles.spec.ts`.** The existing
`multi-team.spec.ts` and `team-switch.developer.spec.ts` already cover
developer-only memberships. Fixtures: teams T1, T2, T4 on `local`, T3 on
`staging`; user alice; one admin-created route per team.

1. In the Permissions modal, the admin gives alice viewer in T1 and developer
   in T2 on `local`. After a reload both rows read back, and the Users table
   shows `T1 · viewer` and `T2 · developer`.
2. alice sees the T1 and T2 routes, and not the T4 route.
3. She can edit the T2 route. The T1 row and detail show no edit or delete,
   and a direct proxy `PUT` to it gets 403 `team_read_only`.
4. With no pick she creates a route, and it is owned by T2, her only
   developer team.
5. With T1 picked, the list narrows to T1 and the create button is hidden. A
   proxy create with `X-Team-ID: T1` gets 403 `team_read_only`.
6. A route test of the T1 route is refused, and of the T2 route allowed.
7. As developer T2 on `local` and viewer T3 on `staging`, switching instance
   changes the list and the rights: she can write on `local` and only read on
   `staging`, where every write is refused by the viewer gate.
8. A legacy record (`team_ids` + `role`, no `team_roles`) written straight to
   etcd gives the same role in every team.

**Existing e2e:**

- `ensureUserInstanceRole` gains an optional `team_roles`. Its 22 callers are
  unchanged.
- `multi-team.spec.ts:136-164` additionally sees `role` in `teams`.
- The specs touched by the model and the Users page are re-run: `multi-team`,
  `team-switch.developer`, `team-switch`, `users.admin`, `teams.admin`,
  `route-test.team-scope`, `plugin_metadata.viewer-read-only`,
  `header.account-role`, and the maintenance specs.

**Verification before the PR:**

1. `go test ./...`
2. `pnpm lint --no-cache`
3. `tsc -b`
4. vitest
5. The new spec and the touched specs, against the worktree's own backend
   (`:18086`) and vite (`:5175`). Targeted only.

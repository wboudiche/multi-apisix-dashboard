# Role per team — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a user a role per team on an instance (viewer in one team, developer in another). `instance_admin` stays instance-wide.

**Architecture:**

- The assignment record gains `team_roles: {team_id: role}`. `role` becomes the strongest team role, so every existing check that reads `ui.Role` stays correct.
- Only the places that know the owning team change:
  - the proxy's write check and create owner, through `teamScope.writable` and `readOnly`;
  - the route test;
  - the SPA's per-row gating, through `canWriteOwner`.

**Tech Stack:** Go 1.24 + Gin + etcd (`api/`); React 19 + jotai + TanStack Query + Mantine/antd (`src/`); Playwright (`e2e/`); vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-multi-team-membership-design.md`

## Global Constraints

- Work in the worktree `.claude/worktrees/feat-multi-team-membership`, branch `feat-multi-team-membership`, based on `origin/main` (#393).
- Commits follow Conventional Commits:
  - type ∈ `feat|fix|test|docs|refactor`;
  - scope `team`, `user` or `api`;
  - imperative, lowercase, no trailing period;
  - a body explaining *why* (except `docs:`);
  - **no `Co-Authored-By` trailer**.
- Every new `.ts`/`.tsx`/`.go` file starts with the ASF license header, copied from a neighbour.
- JS/TS:
  - single quotes;
  - `import type` for type-only imports;
  - no user-visible literal strings: every new string is a key in `src/locales/en/common.json` **and** in `de`, `es`, `tr`, `zh`.
- i18next escapes interpolations. Team names go through `{{team}}`, so pass `{ interpolation: { escapeValue: false } }`.
- `pnpm lint` must be run as `pnpm lint --no-cache` (the cache hides errors).
- Never run the full e2e suite in parallel. Run the named specs only, against the worktree's own backend on `:18086` and vite on `:5175`. The memory note `worktree-dev-stack` has the recipe.
- Role values: `instance_admin`, `developer`, `viewer`. New error code: `team_read_only`.

## Review Focus

1. **A legacy record** (`team_ids` + `role`, no `team_roles`) must grant exactly what it granted before, in the proxy and in the SPA. Owner: Task 1 (decode test), Task 3 (`teamScope` built from a struct literal without `TeamRoles`), and Task 8 (e2e test 8).
2. **A viewer in every team** must still be stopped by the RBAC viewer gate on every write, `/test-route` included. Owner: Task 1 (`Role` is recomputed to `viewer`) and Task 8 (e2e test 7, on staging).
3. **A team removed from an assignment while a tab still has it picked** must neither be sent nor make Create look available. Owner: Task 4 (`canCreate` with a pick that is not one of the caller's teams: `sentTeamIdAtom` is already `''`, so the vitest case asserts it).
4. **An instance admin whose stored record still holds teams** (allowed today) must not get `team_roles`, and saving one with `team_roles` must be refused. Owner: Task 1 (marshal test) and Task 2 (validation test).
5. **Batch delete on a page mixing writable and read-only rows** must never select, and so never send a DELETE for, a read-only row. Owner: Task 5 (`selectable` disables the checkbox; vitest on the hook).

---

### Task 1: Model — `team_roles` on the assignment

**Files:**
- Modify: `api/internal/models/models.go` (`UserInstance`, `userInstanceJSON`, `UnmarshalJSON`, `MarshalJSON`, new helpers right after `HasTeam`)
- Test: `api/internal/models/user_instance_test.go`

**Interfaces:**
- Produces:
  - `UserInstance.TeamRoles map[string]string`
  - `func (ui UserInstance) RoleIn(teamID string) string`
  - `func (ui UserInstance) WritableTeams() []string` (nil when none)
  - `func IsTeamRole(role string) bool`
  - `func TeamRolesFor(teamIDs []string, stored map[string]string, fallback string) map[string]string` (nil for `instance_admin`)
  - `func StrongestRole(roles map[string]string) string`

- [ ] **Step 1: Write the failing tests** (append to `user_instance_test.go`):

```go
// A role per team (#role-per-team). A record from before it has one role for
// every team, and is read that way; a record that names a role per team is
// read as it says, and its role is the strongest of them.
func TestUserInstanceReadsARolePerTeam(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		wantRoles map[string]string
		wantRole  string
	}{
		{"before the roles: every team has the role",
			`{"team_ids":["a","b"],"role":"viewer"}`,
			map[string]string{"a": "viewer", "b": "viewer"}, "viewer"},
		{"a role per team",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer","b":"developer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "developer"}, "developer"},
		{"the role is recomputed, whatever was stored",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer","b":"viewer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "viewer"}, "viewer"},
		{"a team the roles leave out takes the role",
			`{"team_ids":["a","b"],"team_roles":{"a":"viewer"},"role":"developer"}`,
			map[string]string{"a": "viewer", "b": "developer"}, "developer"},
		{"a role for a team the list does not hold is dropped",
			`{"team_ids":["a"],"team_roles":{"a":"developer","x":"developer"},"role":"developer"}`,
			map[string]string{"a": "developer"}, "developer"},
		{"a value that is not a team role falls back to the role",
			`{"team_ids":["a"],"team_roles":{"a":"instance_admin"},"role":"viewer"}`,
			map[string]string{"a": "viewer"}, "viewer"},
		{"an instance admin has no team roles",
			`{"team_ids":["a"],"team_roles":{"a":"developer"},"role":"instance_admin"}`,
			nil, "instance_admin"},
		// Permitted before teams were required: it sees nothing team-owned,
		// and keeps its role so the viewer gate still applies.
		{"a developer with no team keeps the role",
			`{"team_ids":[],"role":"developer"}`,
			map[string]string{}, "developer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var ui UserInstance
			if err := json.Unmarshal([]byte(tc.in), &ui); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if !reflect.DeepEqual(ui.TeamRoles, tc.wantRoles) {
				t.Errorf("TeamRoles %#v, want %#v", ui.TeamRoles, tc.wantRoles)
			}
			if ui.Role != tc.wantRole {
				t.Errorf("Role %q, want %q", ui.Role, tc.wantRole)
			}
		})
	}
}

func TestUserInstanceWritesItsTeamRoles(t *testing.T) {
	ui := UserInstance{
		UserID: "u", InstanceID: "i", TeamIDs: []string{"a", "b"},
		TeamRoles: map[string]string{"a": "viewer", "b": "developer"}, Role: "viewer",
	}
	out, err := json.Marshal(ui)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(out, &got)
	if got["role"] != "developer" {
		t.Errorf("role %v, want the strongest, developer", got["role"])
	}
	if !reflect.DeepEqual(got["team_roles"], map[string]any{"a": "viewer", "b": "developer"}) {
		t.Errorf("team_roles %v", got["team_roles"])
	}

	admin := UserInstance{TeamIDs: []string{"a"}, TeamRoles: map[string]string{"a": "developer"}, Role: RoleInstanceAdmin}
	out, _ = json.Marshal(admin)
	got = map[string]any{}
	_ = json.Unmarshal(out, &got)
	if _, ok := got["team_roles"]; ok {
		t.Errorf("an instance admin was written with team_roles: %s", out)
	}
	if got["role"] != RoleInstanceAdmin {
		t.Errorf("role %v, want instance_admin", got["role"])
	}
}

// Built in code without TeamRoles - every test fixture before the roles - an
// assignment reads as a record from before them: its role in every team.
func TestRoleInFallsBackToTheRole(t *testing.T) {
	legacy := UserInstance{Role: RoleDeveloper, TeamIDs: []string{"a", "b"}}
	if got := legacy.RoleIn("b"); got != RoleDeveloper {
		t.Errorf("RoleIn(b) = %q, want developer", got)
	}
	if got := legacy.WritableTeams(); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Errorf("WritableTeams() = %#v", got)
	}

	mixed := UserInstance{Role: RoleDeveloper, TeamIDs: []string{"a", "b"},
		TeamRoles: map[string]string{"a": RoleViewer, "b": RoleDeveloper}}
	if got := mixed.RoleIn("a"); got != RoleViewer {
		t.Errorf("RoleIn(a) = %q, want viewer", got)
	}
	if got := mixed.RoleIn("x"); got != "" {
		t.Errorf("RoleIn(x) = %q, want none: not a team of theirs", got)
	}
	if got := mixed.WritableTeams(); !reflect.DeepEqual(got, []string{"b"}) {
		t.Errorf("WritableTeams() = %#v, want [b]", got)
	}

	viewer := UserInstance{Role: RoleViewer, TeamIDs: []string{"a"}}
	if got := viewer.WritableTeams(); got != nil {
		t.Errorf("WritableTeams() = %#v, want nil", got)
	}
	admin := UserInstance{Role: RoleInstanceAdmin, TeamIDs: []string{"a"}}
	if got := admin.RoleIn("a"); got != "" {
		t.Errorf("an instance admin's RoleIn = %q, want none: they are not a team member", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail.**
  Run: `cd api && go test ./internal/models -run 'RolePerTeam|WritesItsTeamRoles|RoleInFallsBack' -v`
  Expected: compile errors, because `TeamRoles`, `RoleIn` and `WritableTeams` are undefined.

- [ ] **Step 3: Implement.** In `models.go`:

```go
// UserInstance represents the role assignment between user and instance
type UserInstance struct {
	UserID     string
	InstanceID string
	// TeamIDs are the teams the user works for on this instance. ...(keep the existing comment)
	TeamIDs []string
	// TeamRoles is the role in each team of TeamIDs: developer or viewer. One
	// role covered every team until #role-per-team, so that a viewer in one
	// team could not be a developer in another. Nil for an instance admin,
	// who is not a member of a team. A team it does not name has Role.
	TeamRoles map[string]string
	// Role is instance_admin, or for a developer or a viewer the strongest of
	// their team roles: the role every check that does not know which team a
	// request touches - the viewer gate, the resource-type table - applies.
	Role string
}
```

Add `TeamRoles map[string]string \`json:"team_roles,omitempty"\`` to `userInstanceJSON`, between `TeamID` and `Role`. Then extend its doc comment:

```go
// team_roles is the role in each team (#role-per-team). A record from before
// it has none, and every team has its role - which is what it meant. role is
// written as the strongest team role, so a binary from before the roles reads
// a role the user has in at least one team.
```

Replace `UnmarshalJSON` and `MarshalJSON`:

```go
func (ui *UserInstance) UnmarshalJSON(data []byte) error {
	var raw userInstanceJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	teams := TeamIDsFrom(raw.TeamIDs, raw.TeamID)
	roles := TeamRolesFor(teams, raw.TeamRoles, raw.Role)
	role := raw.Role
	if strongest := StrongestRole(roles); strongest != "" {
		role = strongest
	}
	*ui = UserInstance{
		UserID:     raw.UserID,
		InstanceID: raw.InstanceID,
		TeamIDs:    teams,
		TeamRoles:  roles,
		Role:       role,
	}
	return nil
}

func (ui UserInstance) MarshalJSON() ([]byte, error) {
	teams := NormalizeTeamIDs(ui.TeamIDs)
	first := ""
	if len(teams) > 0 {
		first = teams[0]
	}
	roles := TeamRolesFor(teams, ui.TeamRoles, ui.Role)
	role := ui.Role
	if strongest := StrongestRole(roles); strongest != "" {
		role = strongest
	}
	return json.Marshal(userInstanceJSON{
		UserID:     ui.UserID,
		InstanceID: ui.InstanceID,
		TeamIDs:    teams,
		TeamID:     first,
		TeamRoles:  roles,
		Role:       role,
	})
}
```

After `HasTeam`, add:

```go
// RoleIn is the user's role in teamID: developer, viewer, or "" when it is
// not one of their teams. A team TeamRoles does not name has Role, as in a
// record from before the roles; an instance admin is in no team.
func (ui UserInstance) RoleIn(teamID string) string {
	if !ui.HasTeam(teamID) {
		return ""
	}
	if role, ok := ui.TeamRoles[teamID]; ok && IsTeamRole(role) {
		return role
	}
	if IsTeamRole(ui.Role) {
		return ui.Role
	}
	return ""
}

// WritableTeams are the teams the user is a developer in, in the order of
// TeamIDs. Nil when there are none.
func (ui UserInstance) WritableTeams() []string {
	var out []string
	for _, id := range ui.TeamIDs {
		if ui.RoleIn(id) == RoleDeveloper {
			out = append(out, id)
		}
	}
	return out
}

// IsTeamRole reports whether role is one a team member can hold.
func IsTeamRole(role string) bool {
	return role == RoleDeveloper || role == RoleViewer
}

// TeamRolesFor is the role in each of teamIDs: the one stored for it, or
// fallback. Entries for other teams are dropped. Nil for an instance admin,
// who is not a member of a team; never nil otherwise. One reading for a
// stored record and for a request.
func TeamRolesFor(teamIDs []string, stored map[string]string, fallback string) map[string]string {
	if fallback == RoleInstanceAdmin {
		return nil
	}
	out := make(map[string]string, len(teamIDs))
	for _, id := range teamIDs {
		switch {
		case IsTeamRole(stored[id]):
			out[id] = stored[id]
		case IsTeamRole(fallback):
			out[id] = fallback
		}
	}
	return out
}

// StrongestRole is developer if any team has it, else viewer if any has
// that, else "".
func StrongestRole(roles map[string]string) string {
	strongest := ""
	for _, role := range roles {
		if role == RoleDeveloper {
			return RoleDeveloper
		}
		if role == RoleViewer {
			strongest = RoleViewer
		}
	}
	return strongest
}
```

> `"team_roles"` with `omitempty` drops an empty map. The "developer with no team" case therefore round-trips with no field. That is fine, because decoding rebuilds it.

- [ ] **Step 4: Run the models tests.**
  Run: `cd api && go test ./internal/models -v`
  Expected: PASS, including the pre-existing `TestUserInstance*`. If `TestUserInstanceKeepsTheRestOfTheRecord` or the "writes the list" test compares the full JSON, add `"team_roles"` to its expected value (`{"a": role}` for each team) and keep the test's intent.

- [ ] **Step 5: Run the whole backend suite.**
  Run: `cd api && go test ./...`
  Expected: PASS. A fixture that asserts on full marshalled JSON may need `team_roles` added. Fix only such expected values, never behaviour.

- [ ] **Step 6: Commit.**

```bash
git add api/internal/models
git commit -m "feat(team): store a role per team on an assignment" -m "An assignment held several teams under one role, so a user could not be a viewer in one team and a developer in another on the same instance. team_roles carries the role in each team; a record without it means its role in every team, which is what it always meant. role becomes the strongest team role, so every check that does not know which team a request touches keeps applying the right one."
```

---

### Task 2: Assignment API and readers

**Files:**
- Modify: `api/internal/handlers/instance.go`:
  - `SetUserInstanceRoleRequest` (around :99);
  - `SetUserInstanceRole` (around :590-625);
  - `teamName` and `assignmentWithTeams` (around :702-753).
- Modify: `api/internal/handlers/auth.go` (`GetCurrentUser`, the `teams` loop around :197-205)
- Test: `api/internal/handlers/instance_role_validation_test.go`

**Interfaces:**
- Consumes: `models.TeamRolesFor`, `models.StrongestRole`, `models.IsTeamRole` and `UserInstance.RoleIn` from Task 1.
- Produces: `func (r SetUserInstanceRoleRequest) assignment() (teams []string, roles map[string]string, role string, err error)`. Responses gain `team_roles` (record) and `teams[].role`.

- [ ] **Step 1: Write the failing tests** (append to `instance_role_validation_test.go`):

```go
// A role per team: team_roles names a role for some of the request's teams,
// and the rest take role. The stored role is the strongest of them.
func TestAssignmentRequestRoles(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantRoles map[string]string
		wantRole  string
		wantErr   string
	}{
		{"no team_roles: every team has role",
			`{"role":"developer","team_ids":["t1","t2"]}`,
			map[string]string{"t1": "developer", "t2": "developer"}, "developer", ""},
		{"a role per team",
			`{"role":"viewer","team_ids":["t1","t2"],"team_roles":{"t2":"developer"}}`,
			map[string]string{"t1": "viewer", "t2": "developer"}, "developer", ""},
		{"every team a viewer",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t1":"viewer"}}`,
			map[string]string{"t1": "viewer"}, "viewer", ""},
		{"the old single team takes role",
			`{"role":"viewer","team_id":"t1"}`,
			map[string]string{"t1": "viewer"}, "viewer", ""},
		{"an instance admin",
			`{"role":"instance_admin"}`, nil, "instance_admin", ""},
		{"a team the request does not hold",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t9":"viewer"}}`,
			nil, "", "t9"},
		{"a role a team cannot hold",
			`{"role":"developer","team_ids":["t1"],"team_roles":{"t1":"instance_admin"}}`,
			nil, "", "developer or viewer"},
		{"team roles for an instance admin",
			`{"role":"instance_admin","team_ids":["t1"],"team_roles":{"t1":"developer"}}`,
			nil, "", "instance admin"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req SetUserInstanceRoleRequest
			if err := json.Unmarshal([]byte(tc.body), &req); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, roles, role, err := req.assignment()
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err %v, want one mentioning %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("err %v", err)
			}
			if !reflect.DeepEqual(roles, tc.wantRoles) || role != tc.wantRole {
				t.Errorf("got %#v / %q, want %#v / %q", roles, role, tc.wantRoles, tc.wantRole)
			}
		})
	}
}

// The teams of an answer say the role in each: the only place a developer or
// a viewer learns which of their teams they may change.
func TestAssignmentWithTeamsNamesTheRoleInEach(t *testing.T) {
	ui := &models.UserInstance{TeamIDs: []string{"t1", "t2"}, Role: models.RoleDeveloper,
		TeamRoles: map[string]string{"t1": models.RoleViewer, "t2": models.RoleDeveloper}}
	out, err := json.Marshal(assignmentWithTeams(ui, map[string]string{"t1": "One", "t2": "Two"}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `{"id":"t1","name":"One","role":"viewer"}`) ||
		!strings.Contains(string(out), `{"id":"t2","name":"Two","role":"developer"}`) {
		t.Errorf("teams without their roles: %s", out)
	}
}
```

Add `"strings"` (and `"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"`, if missing) to the test imports.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `cd api && go test ./internal/handlers -run 'AssignmentRequestRoles|NamesTheRoleInEach' -v`
  Expected: compile error, `req.assignment undefined`.

- [ ] **Step 3: Implement the request.** In `instance.go`, add the field and the method:

```go
type SetUserInstanceRoleRequest struct {
	Role string `json:"role" binding:"required"`
	TeamIDs []string `json:"team_ids"`
	TeamID string `json:"team_id"`
	// TeamRoles is the role in some of the teams; the others take Role
	// (#role-per-team). A client from before it sends none, and means Role
	// in every team.
	TeamRoles map[string]string `json:"team_roles"`
}

// assignment is what the request asks to store: its teams, the role in each,
// and the role of the assignment - instance_admin, or the strongest team
// role. A team_roles entry for a team the request does not hold, or with a
// role a team cannot hold, is refused rather than dropped: it is a request
// for something else than what would be stored.
func (r SetUserInstanceRoleRequest) assignment() ([]string, map[string]string, string, error) {
	teams := r.teams()
	if r.Role == models.RoleInstanceAdmin {
		if len(r.TeamRoles) > 0 {
			return nil, nil, "", errors.New("team_roles is for developer and viewer assignments, not an instance admin")
		}
		return teams, nil, r.Role, nil
	}
	for id, role := range r.TeamRoles {
		if !slices.Contains(teams, id) {
			return nil, nil, "", fmt.Errorf("team_roles names %s, which is not one of the assignment's teams", id)
		}
		if !models.IsTeamRole(role) {
			return nil, nil, "", fmt.Errorf("team_roles: the role in %s must be developer or viewer", id)
		}
	}
	roles := models.TeamRolesFor(teams, r.TeamRoles, r.Role)
	role := r.Role
	if strongest := models.StrongestRole(roles); strongest != "" {
		role = strongest
	}
	return teams, roles, role, nil
}
```

Add `"fmt"` and `"slices"` to the imports if missing (`errors` is already there).

In `SetUserInstanceRole`, replace `teamIDs := req.teams()` with:

```go
	teamIDs, teamRoles, assignedRole, err := req.assignment()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
```

Keep the `roleNeedsTeam(req.Role)` check and the team-existence loop as they are. The `err` variable is already declared above by `instance, err :=`, so use `=`, not `:=`, if the compiler complains. Then build the record:

```go
	ui := &models.UserInstance{
		UserID:     userID,
		InstanceID: instanceID,
		TeamIDs:    teamIDs,
		TeamRoles:  teamRoles,
		Role:       assignedRole,
	}
```

- [ ] **Step 4: Implement the readers.**
  - In `instance.go`, give `teamName` a role field: `Role string \`json:"role,omitempty"\``.
  - In `assignmentWithTeams`, append `teamName{ID: id, Name: name, Role: ui.RoleIn(id)}`.
  - In `auth.go` `GetCurrentUser`, change the loop body to `teams = append(teams, gin.H{"id": team.ID, "name": team.Name, "role": ui.RoleIn(teamID)})`.
  - Leave the `team_name` comparison below it as it is: it compares `teams[0]["id"]`, which is unchanged.

- [ ] **Step 5: Run the handler tests.**
  Run: `cd api && go test ./internal/handlers -v -run 'Assignment|RoleNeedsTeam|IsAssignable'`
  Expected: PASS. Then run `cd api && go test ./...` and expect PASS.

- [ ] **Step 6: Commit.**

```bash
git add api/internal/handlers/instance.go api/internal/handlers/auth.go api/internal/handlers/instance_role_validation_test.go
git commit -m "feat(team): take and answer a role per team in the assignment API" -m "The assignment API took one role for every team. team_roles names the role in some teams and the others keep role, so every existing client still means what it meant. A role for a team the request does not hold, or one a team cannot hold, is refused rather than dropped. The teams the access list and /user answer carry the role in each: a developer or a viewer cannot read the team catalogue, so that is where the SPA learns which of their teams they may change."
```

---

### Task 3: Proxy and route test — write by the role in the owning team

**Files:**
- Modify: `api/internal/handlers/caller_scope.go` (`teamScope`, `callerTeamScope`, new `mayWrite` and `createRefusal`)
- Modify: `api/internal/handlers/proxy.go`:
  - the constants near :172-177 and the messages near :360;
  - the two `team_required` refusal sites near :642 and :689;
  - the owned-resource branch near :696.
- Modify: `api/internal/handlers/route_test_handler.go` (the non-admin block near :173-184)
- Test: `api/internal/handlers/caller_scope_test.go`, `api/internal/handlers/route_test_team_test.go`

**Interfaces:**
- Consumes: `UserInstance.WritableTeams()` from Task 1.
- Produces:
  - `teamScope.writable []string`
  - `teamScope.readOnly bool`
  - `func (s teamScope) mayWrite(owner string) bool`
  - `func createRefusal(s teamScope) (status int, msg, code string)`
  - `const teamReadOnlyCode = "team_read_only"`
  - `const teamReadOnlyMsg`

- [ ] **Step 1: Update the existing expectations, then add new cases.**
  - In `TestCallerTeamScope`, every non-admin `want` gains the `writable` the assignment implies. `developerOn(...)` builds a developer, so `writable` equals `teams`, and a case with no assignment keeps `writable: nil`. For example:

    ```go
    want: teamScope{teams: []string{"team-a"}, writable: []string{"team-a"}, acting: "team-a"},
    ```

  - Then append these cases to the same table:

```go
		{
			// A viewer in one team and a developer in the other: what they
			// create can only go to the team they may write to.
			name:    "a viewer team and a developer team, none named",
			jwtRole: models.RoleDeveloper, ui: mixedOn("team-a", "team-b"),
			want: teamScope{teams: []string{"team-a", "team-b"}, writable: []string{"team-b"}, acting: "team-b"},
		},
		{
			name:    "a viewer team and a developer team, the developer one named",
			jwtRole: models.RoleDeveloper, ui: mixedOn("team-a", "team-b"), header: "team-b",
			want: teamScope{teams: []string{"team-a", "team-b"}, writable: []string{"team-b"}, chosen: "team-b", acting: "team-b"},
		},
		{
			// Still narrows the list: a viewer reads their team. Creates
			// nothing in it.
			name:    "a viewer team and a developer team, the viewer one named",
			jwtRole: models.RoleDeveloper, ui: mixedOn("team-a", "team-b"), header: "team-a",
			want: teamScope{teams: []string{"team-a", "team-b"}, writable: []string{"team-b"}, chosen: "team-a", readOnly: true},
		},
		{
			name:    "a viewer in every team acts for none",
			jwtRole: models.RoleViewer, ui: &models.UserInstance{Role: models.RoleViewer, TeamIDs: []string{"team-a"}},
			want: teamScope{teams: []string{"team-a"}},
		},
```

  and add the helper beside `developerOn`:

```go
// mixedOn is a viewer in the first team and a developer in the second.
func mixedOn(viewerTeam, developerTeam string) *models.UserInstance {
	return &models.UserInstance{
		Role:      models.RoleDeveloper,
		TeamIDs:   []string{viewerTeam, developerTeam},
		TeamRoles: map[string]string{viewerTeam: models.RoleViewer, developerTeam: models.RoleDeveloper},
	}
}
```

  and these two tests:

```go
func TestTeamScopeMayWrite(t *testing.T) {
	s := scopeOf(models.RoleDeveloper, mixedOn("team-a", "team-b"), "")
	if !s.mayAccess("team-a") || s.mayWrite("team-a") {
		t.Errorf("a viewer team: mayAccess %v, mayWrite %v; want true, false", s.mayAccess("team-a"), s.mayWrite("team-a"))
	}
	if !s.mayWrite("team-b") {
		t.Error("a developer team is not writable")
	}
	if s.mayWrite("") || s.mayWrite("team-x") {
		t.Error("an unowned or foreign resource is writable")
	}
}

func TestCreateRefusal(t *testing.T) {
	status, _, code := createRefusal(scopeOf(models.RoleDeveloper, mixedOn("team-a", "team-b"), "team-a"))
	if status != http.StatusForbidden || code != teamReadOnlyCode {
		t.Errorf("a viewer team named: %d %s, want 403 %s", status, code, teamReadOnlyCode)
	}
	status, _, code = createRefusal(scopeOf(models.RoleDeveloper, developerOn("team-a", "team-b"), ""))
	if status != http.StatusBadRequest || code != teamRequiredCode {
		t.Errorf("several developer teams, none named: %d %s, want 400 %s", status, code, teamRequiredCode)
	}
}
```

  Also update any `TestTeamScopeAccessAndListing` / `TestCreateNeedsATeam` literal that builds a `teamScope` by hand only if the compiler or a failing assertion demands it. A literal that names no `writable` still compiles.

- [ ] **Step 2: Add the route-test case** to `route_test_team_test.go`:

```go
// A viewer in the route's team may read it and not send traffic through it: a
// viewer cannot test routes, and being a developer elsewhere does not change
// that for this team.
func TestRouteTestRefusesARouteOfAViewerTeam(t *testing.T) {
	adminAPI := adminAPIWithRoute(t, testRouteID, map[string]any{"uri": "/theirs"})
	gateway, reached := gatewayThatAnswers(t)
	owners := stubOwners{owners: map[string]string{"i-1/routes/" + testRouteID: otherTeam}}
	mixed := &models.UserInstance{Role: models.RoleDeveloper, TeamIDs: []string{myTeam, otherTeam},
		TeamRoles: map[string]string{myTeam: models.RoleDeveloper, otherTeam: models.RoleViewer}}

	w := callTestRouteForTeam(t, owners, instanceFor(adminAPI.URL, gateway.URL),
		models.RoleDeveloper, mixed,
		`{"route_id":"`+testRouteID+`","method":"GET","path":"/theirs"}`, "")

	if w.Code != http.StatusForbidden {
		t.Errorf("status %d, want %d: body %s", w.Code, http.StatusForbidden, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), teamReadOnlyCode) {
		t.Errorf("body %s, want code %s", w.Body.String(), teamReadOnlyCode)
	}
	if len(*reached) != 0 {
		t.Errorf("the gateway was sent %v, want nothing", *reached)
	}
}
```

- [ ] **Step 3: Run them to verify they fail.**
  Run: `cd api && go test ./internal/handlers -run 'CallerTeamScope|MayWrite|CreateRefusal|ViewerTeam' -v`
  Expected: compile errors (`writable`, `readOnly`, `mayWrite`, `createRefusal`, `teamReadOnlyCode` undefined).

- [ ] **Step 4: Implement `caller_scope.go`.** Add the fields to `teamScope` after `teams`:

```go
	// writable are the teams among them the non-admin is a developer in:
	// what they may change, and what a create of theirs may go to
	// (#role-per-team). Reads stay with teams.
	writable []string
	// readOnly: the non-admin named one of their teams that they are a
	// viewer in. Their lists narrow to it; a create in it is refused.
	readOnly bool
```

Add after `mayAccess`:

```go
// mayWrite reports whether a non-admin may change a resource owned by
// ownerTeamID: they have to be a developer in it. A team they only view is
// theirs to read (mayAccess) and not to change.
func (s teamScope) mayWrite(ownerTeamID string) bool {
	return ownerTeamID != "" && slices.Contains(s.writable, ownerTeamID)
}

// createRefusal is what a create with no team to own it is answered: the team
// named is one the caller only views, or they have not said which of several
// they may write to.
func createRefusal(s teamScope) (int, string, string) {
	if s.readOnly {
		return http.StatusForbidden, teamReadOnlyMsg, teamReadOnlyCode
	}
	return http.StatusBadRequest, teamRequiredMsg, teamRequiredCode
}
```

Replace the non-admin part of `callerTeamScope`:

```go
	var scope teamScope
	if ui != nil {
		scope.teams = ui.TeamIDs
		scope.writable = ui.WritableTeams()
	}
	switch {
	case named == "":
		// Their only team they may write to: with one, nothing to choose.
		if len(scope.writable) == 1 {
			scope.acting = scope.writable[0]
		}
	case scope.mayAccess(named):
		scope.chosen = named
		if scope.mayWrite(named) {
			scope.acting = named
		} else {
			scope.readOnly = true
		}
	default:
		scope.foreign = true
	}
	return scope
```

- [ ] **Step 5: Implement `proxy.go`.** Beside `teamNotAssignedCode`:

```go
// teamReadOnlyCode marks a write refused because the caller is a viewer in the
// team that owns the resource, or in the team they named for a create
// (#role-per-team).
const teamReadOnlyCode = "team_read_only"
```

  - In the message block, add: `teamReadOnlyMsg = "You are a viewer in that team on this instance: you can read its resources, not change them or create one in it."`
  - At **both** `createNeedsTeam(...)` refusal sites, replace `refuse(c, http.StatusBadRequest, teamRequiredMsg, teamRequiredCode)` with:

```go
				status, msg, code := createRefusal(scope)
				refuse(c, status, msg, code)
```

  - In the owned-resource branch, after the `else if !scope.mayAccess(ownerTeamID) { ... }` block, add:

```go
			} else if !scope.mayWrite(ownerTeamID) {
				// Theirs to read, not to change: a viewer in the owning team,
				// whatever they are in another.
				refuse(c, http.StatusForbidden, teamReadOnlyMsg, teamReadOnlyCode)
				return
			}
```

  (Merge it into the existing `if / else if` chain, so that the closing braces stay balanced.)

- [ ] **Step 6: Implement the route test.** In `route_test_handler.go`, right after the `if !scope.mayAccess(owner) { ... return }` block, add:

```go
		if !scope.mayWrite(owner) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": teamReadOnlyMsg,
				"code":  teamReadOnlyCode,
			})
			return
		}
```

- [ ] **Step 7: Run the backend suite.**
  Run: `cd api && go test ./...`
  Expected: PASS. `TestRouteTestAllowsARouteOfAnyOfTheCallersTeams` still passes, because its fixture is a developer in both teams.

- [ ] **Step 8: Commit.**

```bash
git add api/internal/handlers
git commit -m "feat(team): let a viewer team be read and not written" -m "With a role per team, the role a request needs is the one in the team that owns what it touches, which only these checks know. A non-admin may change a resource of a team they are a developer in; one of a team they view is answered team_read_only. A create goes to their only developer team, or to the team they name if they develop in it; naming a team they view still narrows their lists and refuses the create. The route test sends traffic through a route, which a viewer could never do, so it now requires the developer role in the route's team."
```

---

### Task 4: SPA permissions — roles per team, `canWriteOwner`, the refusal

**Files:**
- Modify: `src/apis/instances.ts` (types near :117-144, plus `roleInTeam`)
- Modify: `src/stores/team.ts` (`OwnTeams`, `ownTeamsAtom`)
- Modify: `src/hooks/usePermission.ts`
- Modify: `src/utils/team-refusal.ts`
- Modify: `src/locales/{en,de,es,tr,zh}/common.json` (`error.teamReadOnly`)
- Test: create `src/hooks/usePermission.test.ts`; modify `src/stores/team.test.ts`; find the `team-refusal` tests with `grep -rln teamRefusal src --include=*.test.ts` and add a case there.

**Interfaces:**
- Consumes: the `/user-access` answer from Task 2, whose `teams[].role` and `team_roles` fields it reads.
- Produces:
  - `type TeamRole = 'developer' | 'viewer'`
  - `roleInTeam(a: UserInstanceRole, teamId: string): TeamRole | undefined`
  - `OwnTeams.roles: Record<string, TeamRole>`
  - `Permissions.canWriteOwner(teamId: string | undefined): boolean`

- [ ] **Step 1: Write the failing tests.** Create `src/hooks/usePermission.test.ts` (ASF header first, copied from `src/stores/team.test.ts`). Base it on the store set-up that `team.test.ts` uses: `getDefaultStore()`, `currentUserAtom`, `userInstancesAtom`, `currentInstanceIdAtom`, `currentTeamIdAtom`. Read that file first and reuse its helpers for seeding localStorage and the store.

```ts
import { getDefaultStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';

import type { UserInstanceRole } from '@/apis/instances';
import { permissionsAtom } from '@/hooks/usePermission';
import { currentUserAtom, userInstancesAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';
import { clearTeamPicks, currentTeamIdAtom } from '@/stores/team';

const store = getDefaultStore();
const INSTANCE = 'inst-1';
const mixed: UserInstanceRole = {
  user_id: 'u', instance_id: INSTANCE, team_id: 'a', team_ids: ['a', 'b'],
  team_roles: { a: 'viewer', b: 'developer' }, role: 'developer',
  teams: [{ id: 'a', name: 'A', role: 'viewer' }, { id: 'b', name: 'B', role: 'developer' }],
};

const signIn = (assignment: UserInstanceRole) => {
  store.set(currentUserAtom, { id: 'u', username: 'u', email: '', role: '' } as never);
  store.set(userInstancesAtom, [assignment]);
  store.set(currentInstanceIdAtom, INSTANCE);
};

describe('a role per team', () => {
  beforeEach(() => {
    localStorage.clear();
    clearTeamPicks();
  });

  it('writes the teams it develops in, and only those', () => {
    signIn(mixed);
    const p = store.get(permissionsAtom);
    expect(p.canWriteOwner('b')).toBe(true);
    expect(p.canWriteOwner('a')).toBe(false);
    expect(p.canWriteOwner(undefined)).toBe(false);
    expect(p.canWriteOwner('x')).toBe(false);
  });

  it('offers no create with a viewer team picked, and one with a developer team or none', () => {
    signIn(mixed);
    expect(store.get(permissionsAtom).canCreate).toBe(true);
    store.set(currentTeamIdAtom, 'a');
    expect(store.get(permissionsAtom).canCreate).toBe(false);
    store.set(currentTeamIdAtom, 'b');
    expect(store.get(permissionsAtom).canCreate).toBe(true);
  });

  it('reads an assignment from before the roles as its role in every team', () => {
    signIn({ ...mixed, team_roles: undefined, teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(store.get(permissionsAtom).canWriteOwner('a')).toBe(true);
  });

  it('is a viewer in every team: no write, no create', () => {
    signIn({ ...mixed, role: 'viewer', team_roles: { a: 'viewer', b: 'viewer' } });
    const p = store.get(permissionsAtom);
    expect(p.isViewer).toBe(true);
    expect(p.canCreate).toBe(false);
    expect(p.canWriteOwner('b')).toBe(false);
  });

  it('lets an admin write any team', () => {
    signIn({ ...mixed, role: 'instance_admin', team_roles: undefined });
    expect(store.get(permissionsAtom).canWriteOwner('a')).toBe(true);
  });
});
```

Then:
  - In `src/stores/team.test.ts`, add a case where `ownTeamsAtom` gives `roles: { a: 'viewer', b: 'developer' }` for `mixed`, and `{ a: 'developer', b: 'developer' }` when `team_roles` is absent and `role` is `developer`.
  - In the team-refusal test file, add: `teamRefusal('team_read_only')` equals `i18n.t('error.teamReadOnly')`.

- [ ] **Step 2: Run them to verify they fail.**
  Run: `pnpm vitest run src/hooks/usePermission.test.ts src/stores/team.test.ts`
  Expected: FAIL, because `permissionsAtom` is not exported, and `canWriteOwner` and `roles` are undefined.

- [ ] **Step 3: Implement `instances.ts`.**

```ts
/** A role a team member holds: per team, since #role-per-team. */
export type TeamRole = 'developer' | 'viewer';

export type UserInstanceRole = {
  user_id: string;
  instance_id: string;
  team_ids?: string[];
  team_id: string;
  /**
   * The role in each team. Absent from a backend before it, and from an
   * instance admin: every team then has `role`.
   */
  team_roles?: Record<string, TeamRole>;
  teams?: { id: string; name: string; role?: TeamRole }[];
  /** instance_admin, or the strongest team role. */
  role: 'instance_admin' | 'developer' | 'viewer';
};

/** The role in one team of an assignment, as the backend's `RoleIn` reads it. */
export const roleInTeam = (a: UserInstanceRole, teamId: string): TeamRole | undefined => {
  if (!teamsOf(a).includes(teamId)) return undefined;
  const role = a.team_roles?.[teamId];
  if (role === 'developer' || role === 'viewer') return role;
  return a.role === 'developer' || a.role === 'viewer' ? a.role : undefined;
};

export type SetUserRoleRequest = {
  role: string;
  team_ids: string[];
  /** The role in each team; left out for an instance admin (#role-per-team). */
  team_roles?: Record<string, TeamRole>;
};
```

- [ ] **Step 4: Implement `stores/team.ts`.**
  - Add `roles: Record<string, 'developer' | 'viewer'>` to `OwnTeams`, with a doc line: "The role in each of `ids`, read as `roleInTeam` reads it."
  - Add `role?: 'developer' | 'viewer'` to the `teams` entries.
  - In `ownTeamsAtom`, `@/apis/instances` cannot be imported here (see the existing comment), so inline the same rule:

```ts
    const fallback = assignment.role;
    const roles = Object.fromEntries(
      ids.map((id) => [id, assignment.team_roles?.[id] ?? fallback])
    ) as Record<string, 'developer' | 'viewer'>;
    own[assignment.instance_id] = {
      ids,
      roles,
      teams: (assignment.teams ?? ids.map((id) => ({ id, name: knownTeamNames.get(id) ?? id })))
        .map((team) => ({ ...team, role: team.role ?? roles[team.id] })),
    };
```

  (`fallback` is `developer` or `viewer` here: the loop already skips any other role.)

- [ ] **Step 5: Implement `usePermission.ts`.**
  - Export the atom: `export const permissionsAtom = ...`.
  - Import `ownTeamsAtom` and `sentTeamIdAtom` from `@/stores/team`.
  - Add `canWriteOwner` to `Permissions`, with this doc:

```ts
  /**
   * Whether this account may change a resource a team owns, given the
   * `__team_id` the proxy put on it: an admin any; a developer or a viewer
   * only one of the teams they are a developer in (#role-per-team). Not
   * known, or no team: no.
   */
  canWriteOwner: (teamId: string | undefined) => boolean;
```

  - Inside `permissionsAtom`, after `canWrite`:

```ts
  const own = get(ownTeamsAtom)[get(currentInstanceIdAtom)];
  const writable = own ? own.ids.filter((id) => own.roles[id] === 'developer') : [];
  // The team a create would go to, when one is picked: one they only view
  // takes the create button away, as the proxy would refuse it
  // (team_read_only). None picked is left as it was - a developer with
  // several developer teams is asked to choose by the proxy (#376).
  const sent = get(sentTeamIdAtom);
  const canCreate = isAdmin || (canWrite && (!sent || writable.includes(sent)));
  const canWriteOwner = (teamId: string | undefined) =>
    isAdmin || (!!teamId && writable.includes(teamId));
```

  and return `canCreate` (instead of `canWrite`) and `canWriteOwner`.

  > If importing `sentTeamIdAtom` makes `usePermission.ts` and `stores/team.ts` import each other, stop. Check with `grep -n "usePermission" src/stores/team.ts`, which should return nothing.

- [ ] **Step 6: Implement the refusal and the strings.**
  - In `team-refusal.ts`, add as the first line of `teamRefusal`: `if (code === 'team_read_only') return i18n.t('error.teamReadOnly');`. Then add a sentence to its doc comment saying that this one is a viewer team.
  - In `src/locales/en/common.json`, under `"error"`, next to `teamNotAssigned`: `"teamReadOnly": "You are a viewer in that team: you can read its resources, not change them or create one in it."`
  - The same key in the other four languages:
    - `de`: `"Sie sind in diesem Team Betrachter: Sie können seine Ressourcen lesen, aber weder ändern noch darin anlegen."`
    - `es`: `"Eres lector en ese equipo: puedes ver sus recursos, pero no modificarlos ni crear uno en él."`
    - `tr`: `"Bu ekipte görüntüleyicisiniz: kaynaklarını okuyabilirsiniz, ancak değiştiremez veya içinde yeni bir tane oluşturamazsınız."`
    - `zh`: `"你在该团队中是查看者：可以查看其资源，但不能修改，也不能在其中创建资源。"`

- [ ] **Step 7: Run the tests.**
  Run: `pnpm vitest run src/hooks src/stores src/utils`
  Expected: PASS.

- [ ] **Step 8: Type-check and lint.**
  Run: `pnpm exec tsc -b && pnpm lint --no-cache`
  Expected: no errors.

- [ ] **Step 9: Commit.**

```bash
git add src/apis/instances.ts src/stores/team.ts src/hooks src/utils/team-refusal.ts src/utils/*.test.ts src/locales
git commit -m "feat(team): know the role in each of the account's teams" -m "The SPA gated writes on one role for the instance, which a role per team makes wrong both ways: a viewer team showed edit buttons the proxy refuses, and a developer team would be hidden behind a viewer one. canWriteOwner answers for the team that owns a resource; the create button goes when the team picked is one the account only views; team_read_only is said in the reader's language."
```

---

### Task 5: Per-row gating on team-scoped pages

**Files:**
- Modify: `src/components/page/DeleteResourceBtn.tsx`: add an `allowed?: boolean` prop. When it is given it replaces `canDelete`.
- Modify: `src/hooks/useTableRowSelection.ts`: `RowNaming` gains `selectable?: (row: T) => boolean`. `getCheckboxProps` adds `disabled: !selectable(row)`, and only selectable rows are kept in `selectedIds`.
- Modify the lists: `src/routes/{upstreams,services,consumers,consumer_groups,stream_routes}/index.tsx` and `src/routes/routes/index.tsx`.
- Modify the details:
  - `src/routes/upstreams/detail.$id.tsx`
  - `src/routes/services/detail.$id/index.tsx`
  - `src/routes/consumers/detail.$username/index.tsx`
  - `src/routes/consumer_groups/detail.$id.tsx`
  - `src/routes/stream_routes/detail.$id.tsx`
  - `src/routes/routes/detail.$id.tsx`
  - plus the nested lists `src/routes/services/detail.$id/routes/index.tsx` and `.../stream_routes/index.tsx`, if they render `DeleteResourceBtn` (check with grep).
- Create: `src/utils/owner.ts`, holding `ownerOf(value: unknown): string | undefined`, which reads `__team_id`.
- Test: `src/utils/owner.test.ts`; extend the `useTableRowSelection` tests if a test file exists (`ls src/hooks/*.test.ts`).

**Interfaces:**
- Consumes: `Permissions.canWriteOwner` from Task 4.
- Produces:
  - `ownerOf(value)`
  - `DeleteResourceBtn` prop `allowed?: boolean`
  - `RowNaming.selectable?`

- [ ] **Step 1: Write the failing test** `src/utils/owner.test.ts` (ASF header):

```ts
import { describe, expect, it } from 'vitest';

import { ownerOf } from '@/utils/owner';

describe('ownerOf', () => {
  it('reads the team the proxy put on a resource', () => {
    expect(ownerOf({ id: 'r1', __team_id: 't1' })).toBe('t1');
  });
  it('is undefined for no team, an empty one, or no resource yet', () => {
    expect(ownerOf({ id: 'r1' })).toBeUndefined();
    expect(ownerOf({ id: 'r1', __team_id: '' })).toBeUndefined();
    expect(ownerOf(undefined)).toBeUndefined();
    expect(ownerOf(null)).toBeUndefined();
  });
});
```

  If `src/hooks/useTableRowSelection.test.ts` exists, add a case there: with `selectable: (row) => row.id !== 'b'`, the checkbox props of row `b` have `disabled: true`.

- [ ] **Step 2: Run it to verify it fails.**
  Run: `pnpm vitest run src/utils/owner.test.ts`
  Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `src/utils/owner.ts`** (ASF header):

```ts
/**
 * The team that owns a resource, as the proxy says on every team-scoped row
 * and detail it answers (`__team_id`). Undefined for none, and while the
 * resource has not arrived: a write control waits for it rather than show
 * itself a moment early.
 */
export const ownerOf = (value: unknown): string | undefined => {
  const owner = (value as { __team_id?: unknown } | null | undefined)?.__team_id;
  return typeof owner === 'string' && owner !== '' ? owner : undefined;
};
```

- [ ] **Step 4: `DeleteResourceBtn`.**
  - Add to `DeleteResourceProps`:

```ts
  /**
   * Whether this account may delete this one resource. A team-scoped page
   * passes canWriteOwner(owner): the role that counts is the one in the
   * resource's team (#role-per-team). Left out, the account's canDelete.
   */
  allowed?: boolean;
```

  - Destructure `allowed` from the props, then replace `if (!canDelete) return null;` with `if (!(allowed ?? canDelete)) return null;`.

- [ ] **Step 5: `useTableRowSelection`.**
  - Add `selectable?: (row: T) => boolean` to `RowNaming`, with this doc: "Whether a row may be ticked: a row this account may not delete is not offered for a batch delete."
  - In `useTableRowSelection`, destructure `selectable`.
  - Pass only the selectable rows' ids to `useRowSelection`: `useRowSelection((selectable ? rows.filter(selectable) : rows).map(idOf), listKey)`.
  - Wrap `naming.getCheckboxProps` so that it adds `disabled: selectable ? !selectable(row) : false`.
  - Add `selectable` to the `useMemo` dependencies.

- [ ] **Step 6: The antd lists** (upstreams, services, consumers, consumer_groups, stream_routes). For each:
  - Take `canWriteOwner` from `usePermission()`.
  - Pass `selectable: (row) => canWriteOwner(ownerOf(row.value))` to `useTableRowSelection`. Define it with `useCallback([canWriteOwner])`, so antd does not recompute every checkbox.
  - Add `allowed={canWriteOwner(ownerOf(record.value))}` to the row's `DeleteResourceBtn`.
  - Change the row's Configure/View label to `canWriteResource('<type>') && canWriteOwner(ownerOf(record.value))`.
  - Add `canWriteOwner` to the `columns` `useMemo` dependencies.

  Upstreams is the example:

```tsx
  const { canWriteResource, canWriteOwner } = usePermission();
  const selectable = useCallback(
    (row: UpstreamRow) => canWriteOwner(ownerOf(row.value)),
    [canWriteOwner]
  );
  const { selectedIds, setSelectedIds, tableProps } = useTableRowSelection(rows, listKey, {
    idOf: upstreamId,
    selectable,
  });
  // ...in the actions column:
  const writable = canWriteResource('upstreams') && canWriteOwner(ownerOf(record.value));
  // variant={writable ? 'filled' : 'light'}  and  t(writable ? 'form.btn.configure' : 'form.btn.view')
  // <DeleteResourceBtn allowed={canWriteOwner(ownerOf(record.value))} ... />
```

  Keep each page's existing `idOf` and `nameOf` arguments as they are. Read the current `useTableRowSelection(...)` call before editing it.

- [ ] **Step 7: The routes list** (`src/routes/routes/index.tsx`), which has its own Mantine table.
  - Take `canWriteOwner` and compute `const writableRow = (r: { value: { __team_id?: string } }) => canWriteOwner(ownerOf(r.value));`.
  - Build `allIds` from writable rows only: `data?.list?.filter(writableRow).map(...)`.
  - Disable the row checkbox: `disabled={!writableRow(record)}`.
  - In the row actions, replace each `canEdit &&` and `canDelete &&` with `canWriteOwner(ownerOf(record.value)) &&`. Keep `canWriteResource('routes')` where it is, AND-ed with `canWriteOwner(...)`.
  - For the JSON drawer near :702: `canEdit` → `canWriteOwner(ownerOf(<the record open in the drawer>))`. Read the drawer's state variable first.
  - The page-level `canEdit` usages at :810 and :820 (import buttons) are not about one row, so they stay.

- [ ] **Step 8: The detail pages.** In each page component that renders the header with Edit and Delete:
  - Read the resource with the query the form already uses. The cache is shared, so this costs no extra request. Use `useQuery`, not `useSuspenseQuery`, so that the header never suspends:

```tsx
  const { canWriteOwner } = usePermission();
  const owner = ownerOf(useQuery(getUpstreamQueryOptions(id)).data?.value);
  const canChange = canWriteOwner(owner);
  // {canChange && (<Button ... >{t('form.btn.edit')}</Button>)}
  // <DeleteResourceBtn mode="detail" allowed={canChange} ... />
```

  - Use the same pattern with `getServiceQueryOptions`, `getConsumerQueryOptions(username)`, `getConsumerGroupQueryOptions`, `getStreamRouteQueryOptions` and, on routes, the existing `rawJson`: `canWriteOwner(currentTeamId)` replaces `canEdit` at :389 and :413-415, plus `allowed` on its `DeleteResourceBtn`.
  - On routes, `canTest` becomes `canWriteResource('routes') && canWriteOwner(currentTeamId)`, to match the backend's route-test rule from Task 3.
  - Check `.data?.value` against each query's real return shape. If a query returns the resource itself rather than `{value}`, read `ownerOf(data)`.

- [ ] **Step 9: Run the tests, type-check and lint.**
  Run: `pnpm vitest run && pnpm exec tsc -b && pnpm lint --no-cache`
  Expected: PASS and no errors.

- [ ] **Step 10: Commit.**

```bash
git add src
git commit -m "feat(team): offer a write only where the role in the resource's team allows it" -m "Edit, delete, the batch checkbox and the route test were offered on the account's role for the instance. With a role per team that showed a viewer team's rows as writable, and every click on them ended in team_read_only. Each control now asks canWriteOwner for the team the proxy put on the row or the detail; the import buttons, which are about no single row, keep the account's role."
```

---

### Task 6: Header — show the role in each team

**Files:**
- Modify: `src/components/Header/index.tsx` (`TeamSwitcher`, the non-admin branches near :160-187)
- Modify: `src/locales/{en,de,es,tr,zh}/common.json` (`header.teamWithRole`)

**Interfaces:**
- Consumes: `OwnTeams.teams[].role` from Task 4, and `roleLabel` from `src/config/role-labels.ts`.

- [ ] **Step 1: Add the string.**
  - In `en`, under `"header"`: `"teamWithRole": "{{team}} · {{role}}"`.
  - Use the same value in `de`, `es`, `tr` and `zh`: the separator is the same, and the role comes translated through `roleLabel`.

- [ ] **Step 2: Implement.**
  - Give the `teams` prop type an optional `role?: 'developer' | 'viewer'`.
  - Add a helper inside `TeamSwitcher`:

```tsx
  // Its role beside a developer's or a viewer's team: with a role per team it
  // is what tells them which of their teams they may change (#role-per-team).
  const withRole = (team: { name: string; role?: string }) =>
    team.role
      ? t('header.teamWithRole', {
          team: team.name,
          role: roleLabel(t, team.role),
          interpolation: { escapeValue: false },
        })
      : team.name;
```

  - Use `{withRole(teams[0])}` in the badge, and `label: withRole(team)` in the non-admin `Select` data.
  - Leave the admin branch unchanged.

- [ ] **Step 3: Type-check and lint.**
  Run: `pnpm exec tsc -b && pnpm lint --no-cache`
  Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Header src/locales
git commit -m "feat(team): name the role beside each team in the header" -m "A developer or a viewer reads their teams in the header and nowhere else. With a role per team the name alone no longer says whether they may change what that team owns, so each of their teams carries its role."
```

---

### Task 7: Users page — a role per team in the Permissions modal and the table

**Files:**
- Modify: `src/routes/users/index.tsx`:
  - `AssignmentForm` near :71;
  - `handleSubmit` near :307-325;
  - `openEditModal` near :450-460;
  - the editor near :724-780;
  - the Teams column near :494-566.
- Modify: `src/locales/{en,de,es,tr,zh}/common.json` (`users.teamRoles`, `users.teamRoleIn`, `users.teamWithRole`)

**Interfaces:**
- Consumes: `roleInTeam`, `TeamRole` and `SetUserRoleRequest.team_roles` from Task 4, and `roleLabel`.

- [ ] **Step 1: Add the strings.**
  - In `en`, under `"users"`:

```json
    "teamRoles": "Role in each team",
    "teamRoleIn": "Role in {{team}}",
    "teamWithRole": "{{team}} · {{role}}",
```

  - `de`: `"Rolle in jedem Team"`, `"Rolle in {{team}}"`, `"{{team}} · {{role}}"`
  - `es`: `"Rol en cada equipo"`, `"Rol en {{team}}"`, `"{{team}} · {{role}}"`
  - `tr`: `"Her ekipteki rol"`, `"{{team}} içindeki rol"`, `"{{team}} · {{role}}"`
  - `zh`: `"各团队中的角色"`, `"在 {{team}} 中的角色"`, `"{{team}} · {{role}}"`

- [ ] **Step 2: Form state.**
  - Extend `AssignmentForm`:

```ts
type AssignmentForm = {
  role: string;
  team_ids: string[];
  /**
   * The role in each team, for a developer or a viewer (#role-per-team). A
   * team picked starts with `role`; choosing `role` sets every team to it.
   */
  team_roles: Record<string, TeamRole>;
};
```

  - Add a module-level helper:

```ts
const strongest = (roles: Record<string, TeamRole>, ids: string[]): TeamRole =>
  ids.some((id) => roles[id] === 'developer') ? 'developer' : 'viewer';
```

  - In `openEditModal`, seed each assignment with `team_roles: Object.fromEntries(teamsOf(a).map((id) => [id, roleInTeam(a, id) ?? 'viewer']))`.
  - Every other place that builds an `AssignmentForm` gets `team_roles`. Find them with `grep -n "team_ids:" src/routes/users/index.tsx`.

- [ ] **Step 3: The handlers in the editor.**
  - The role `Select`'s `onChange`: when the new role is `developer` or `viewer`, set `team_roles` to every current team with that role. Otherwise keep `team_roles` as it is; it is not sent for an instance admin.
  - The `MultiSelect`'s `onChange`: keep the existing team-order logic, then build `team_roles` for the new list. A team that is already there keeps its role; a new one takes `roleNeedsTeam(role) ? role : 'viewer'`.

- [ ] **Step 4: The "Role in each team" block.**
  - Render it below the `<Group>` that holds the two fields, only when `roleNeedsTeam(config.role) && config.team_ids.length > 0`.
  - Import `SegmentedControl` from `@mantine/core`.

```tsx
<Stack gap={4} data-testid={`team-roles-${inst.id}`}>
  <Text size="xs" fw={500}>{t('users.teamRoles')}</Text>
  {config.team_ids.map((teamId) => {
    const name = teamById.get(teamId)?.name ?? teamId;
    return (
      <Group key={teamId} gap="sm" justify="space-between" wrap="nowrap">
        <Text size="sm">{name}</Text>
        <SegmentedControl
          size="xs"
          aria-label={t('users.teamRoleIn', { team: name, interpolation: { escapeValue: false } })}
          value={config.team_roles[teamId] ?? 'viewer'}
          data={(['developer', 'viewer'] as const).map((role) => ({ value: role, label: roleLabel(t, role) }))}
          onChange={(role) => setInstanceRoles({
            ...instanceRoles,
            [inst.id]: {
              ...config,
              team_roles: { ...config.team_roles, [teamId]: role as TeamRole },
            },
          })}
        />
      </Group>
    );
  })}
</Stack>
```

- [ ] **Step 5: Save.** In `handleSubmit`, send:

```ts
            const needsTeams = roleNeedsTeam(config.role);
            await instanceApi.setUserRole(userId, instanceID, {
              // The strongest team role: what the backend stores as role.
              role: needsTeams ? strongest(config.team_roles, config.team_ids) : config.role,
              team_ids: config.team_ids,
              ...(needsTeams ? {
                team_roles: Object.fromEntries(
                  config.team_ids.map((id) => [id, config.team_roles[id] ?? 'viewer'])
                ),
              } : {}),
            });
```

- [ ] **Step 6: The Teams column.** Replace the de-duplicated team list with one entry per (assignment, team):

```tsx
const memberships = assignments.flatMap((a) =>
  teamsOf(a).map((id) => ({
    key: `${a.instance_id}:${id}`,
    instance: availableInstances.find((i) => i.id === a.instance_id)?.name ?? a.instance_id,
    team: teamById.get(id) ?? (teamsLoaded ? { id, name: id } : undefined),
    role: roleInTeam(a, id),
  }))
).filter((m) => m.team !== undefined);
```

  - Each entry renders as a `<Tooltip label={m.instance}>`. It wraps the existing `<Group>` (icon plus text), whose text is `m.role ? t('users.teamWithRole', { team: m.team!.name, role: roleLabel(t, m.role), interpolation: { escapeValue: false } }) : m.team!.name`.
  - Keep the `super_admin` and unreadable branches as they are, and use `memberships.length === 0` for the dash.

  > `users.admin.spec.ts` looks up a team's name with `exact: true`, at :306-307. With a role beside it that exact text no longer matches. Task 8 updates those assertions, so do not keep the old text for their sake.

- [ ] **Step 7: Type-check and lint.**
  Run: `pnpm exec tsc -b && pnpm lint --no-cache`
  Expected: no errors.

- [ ] **Step 8: Commit.**

```bash
git add src/routes/users src/locales
git commit -m "feat(user): assign a role in each team from the Permissions modal" -m "The modal set one role for every team of an instance, which is all an assignment could hold. Each picked team now has its own developer or viewer control, seeded from the role field and set by it, and the save sends the role in each. The Teams column names the role in each team and the instance it is on, since the same team name can mean different rights on two gateways."
```

---

### Task 8: E2E — the seeding helper, the new spec, the specs it touches

**Files:**
- Modify: `e2e/utils/seed-client.ts` (`UserInstance` type near :56, `UserInstanceRoleInput` and `ensureUserInstanceRole` near :400-438; update the stale comment)
- Create: `e2e/tests/multi-team.roles.spec.ts`
- Modify: `e2e/tests/multi-team.spec.ts` (:136-164: `teams` entries now carry `role`)
- Modify: `e2e/tests/users.admin.spec.ts` (Teams-column lookups that use `exact: true` on a bare team name, near :306-307 and anywhere else `grep -n "exact: true" e2e/tests/users.admin.spec.ts` finds a team name)

**Interfaces:**
- Consumes: everything above.
- Produces: `UserInstanceRoleInput.team_roles?: Record<string, 'developer' | 'viewer'>`.

- [ ] **Step 1: Update the helper.**

```ts
// The backend's SetUserInstanceRole is a pure upsert, so calling it again is
// idempotent. A developer or a viewer needs at least one team (team_id or
// team_ids); team_roles names the role in some of them, the rest take role.
export type UserInstanceRoleInput = {
  role: string;
  team_id?: string;
  team_ids?: string[];
  /** The role in each team (#role-per-team). */
  team_roles?: Record<string, 'developer' | 'viewer'>;
};
```

  - Add to the JSON body: `...(input.team_roles ? { team_roles: input.team_roles } : {}),`.
  - Add `team_roles?: Record<string, 'developer' | 'viewer'>;` to the `UserInstance` type.

- [ ] **Step 2: Write the new spec** `e2e/tests/multi-team.roles.spec.ts`:
  - ASF header, copied from `multi-team.spec.ts`.
  - Reuse its patterns: `PREFIX = randomId(...)`, `onInstance`, `route()`, `refusal()`, `listed()`, a serial `describe`, and an `afterAll` that deletes routes, then users, then teams.
  - It takes the UI from `@e2e/utils/test` (`test`, which carries the admin storage state), together with `permission.loginAs` and `adminPom`.

```ts
import { adminPom } from '@e2e/pom/admin';
import { permission } from '@e2e/pom/permission';
import { deleteTeamsByPrefix, deleteUsersByPrefix } from '@e2e/utils/admin-api';
import { randomId } from '@e2e/utils/common';
import { etcdPut } from '@e2e/utils/etcd';
import { getFixtures } from '@e2e/utils/fixtures';
import {
  apiFetch,
  ensureTeam,
  ensureUser,
  ensureUserInstanceRole,
  HttpError,
  loginAdmin,
  type Team,
  type User,
} from '@e2e/utils/seed-client';
import { test } from '@e2e/utils/test';
import { roleText } from '@e2e/utils/ui/roles';
import { expect, type Page } from '@playwright/test';

/**
 * A role per team (#role-per-team): viewer in one team and developer in
 * another on the same instance, and independent roles on another instance.
 * multi-team.spec.ts covers a developer in several teams; this covers what a
 * viewer team changes.
 */
const PROXY = '/api/v1/apisix/admin';
const PREFIX = randomId('e2e-team-roles');
const PASSWORD = 'e2e-Team-r0les!pass';
const fx = () => getFixtures();
const on = (instanceId: string, team?: string) => ({
  'X-Instance-ID': instanceId,
  ...(team ? { 'X-Team-ID': team } : {}),
});
const local = (team?: string) => on(fx().localInstanceId, team);
const route = (id: string) => ({
  uri: `/${id}`,
  name: id,
  upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
});
type Row = { value: { id: string; __team_id?: string } };

test.describe.configure({ mode: 'serial' });

let viewed: Team;      // T1: alice is a viewer in it
let developed: Team;   // T2: alice is a developer in it
let foreign: Team;     // T4: not hers
let staged: Team;      // T3: on staging
let alice: User;
const ROUTE = `${PREFIX}-route`;
const routeOf = { viewed: `${ROUTE}-1`, developed: `${ROUTE}-2`, foreign: `${ROUTE}-4`, staged: `${ROUTE}-3` };
const aliceToken = () => loginAdmin(`${PREFIX}-alice`, PASSWORD);

const refusal = async (request: Promise<unknown>): Promise<HttpError | undefined> => {
  try {
    await request;
    return undefined;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
};

const listed = async (token: string, headers: Record<string, string>) => {
  const res = (await apiFetch(`${PROXY}/routes?name=${ROUTE}&page_size=50`, token, { headers })) as { list: Row[] };
  return Object.fromEntries(res.list.map((r) => [r.value.id, r.value.__team_id]));
};

const assignMixed = (admin: string) =>
  ensureUserInstanceRole(admin, alice.id, fx().localInstanceId, {
    role: 'viewer',
    team_ids: [viewed.id, developed.id],
    team_roles: { [developed.id]: 'developer' },
  });

test.beforeAll(async () => {
  const admin = await loginAdmin();
  viewed = await ensureTeam(admin, { name: `${PREFIX}-t1` });
  developed = await ensureTeam(admin, { name: `${PREFIX}-t2` });
  foreign = await ensureTeam(admin, { name: `${PREFIX}-t4` });
  staged = await ensureTeam(admin, { name: `${PREFIX}-t3` });
  alice = await ensureUser(admin, { username: `${PREFIX}-alice`, password: PASSWORD });
  await assignMixed(admin);
  for (const [id, team] of [
    [routeOf.viewed, viewed.id],
    [routeOf.developed, developed.id],
    [routeOf.foreign, foreign.id],
  ]) {
    await apiFetch(`${PROXY}/routes/${id}`, admin, { method: 'PUT', headers: local(team), json: route(id) });
  }
  await apiFetch(`${PROXY}/routes/${routeOf.staged}`, admin, {
    method: 'PUT', headers: on(fx().stagingInstanceId, staged.id), json: route(routeOf.staged),
  });
});

test.afterAll(async () => {
  const admin = await loginAdmin();
  try {
    for (const [instanceId] of [[fx().localInstanceId], [fx().stagingInstanceId]]) {
      for (const id of Object.keys(await listed(admin, on(instanceId)))) {
        await apiFetch(`${PROXY}/routes/${id}`, admin, { method: 'DELETE', headers: on(instanceId) })
          .catch(() => undefined);
      }
    }
  } finally {
    await deleteUsersByPrefix(PREFIX);
    await deleteTeamsByPrefix(PREFIX);
  }
});

test('the assignment holds a role per team, and says it back', async () => {
  const admin = await loginAdmin();
  const stored = await assignMixed(admin);
  expect(stored.role).toBe('developer');
  expect(stored.team_roles).toEqual({ [viewed.id]: 'viewer', [developed.id]: 'developer' });
  const own = (await apiFetch('/api/v1/user-access/' + alice.id + '/instances', await aliceToken())) as {
    teams?: { id: string; role?: string }[];
  }[];
  expect(own[0].teams).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: viewed.id, role: 'viewer' }),
    expect.objectContaining({ id: developed.id, role: 'developer' }),
  ]));
});

test('reads every team of hers, whatever the role, and no other', async () => {
  const rows = await listed(await aliceToken(), local());
  expect(rows[routeOf.viewed]).toBe(viewed.id);
  expect(rows[routeOf.developed]).toBe(developed.id);
  expect(rows).not.toHaveProperty(routeOf.foreign);
});

test('changes a route of the team she develops in, and not one of the team she views', async () => {
  const token = await aliceToken();
  await apiFetch(`${PROXY}/routes/${routeOf.developed}`, token, {
    method: 'PATCH', headers: local(), json: { desc: 'hers' },
  });
  const refused = await refusal(apiFetch(`${PROXY}/routes/${routeOf.viewed}`, token, {
    method: 'PATCH', headers: local(), json: { desc: 'not hers' },
  }));
  expect(refused?.status).toBe(403);
  expect(JSON.stringify(refused?.body)).toContain('team_read_only');
  const del = await refusal(apiFetch(`${PROXY}/routes/${routeOf.viewed}`, token, {
    method: 'DELETE', headers: local(),
  }));
  expect(del?.status).toBe(403);
});

test('a create with no team named goes to the one team she develops in', async () => {
  const id = `${ROUTE}-created`;
  await apiFetch(`${PROXY}/routes/${id}`, await aliceToken(), { method: 'PUT', headers: local(), json: route(id) });
  expect((await listed(await loginAdmin(), local()))[id]).toBe(developed.id);
});

test('naming the team she views narrows her list and refuses a create in it', async () => {
  const token = await aliceToken();
  const rows = await listed(token, local(viewed.id));
  expect(Object.values(rows)).toEqual([viewed.id]);
  const id = `${ROUTE}-refused`;
  const refused = await refusal(apiFetch(`${PROXY}/routes/${id}`, token, {
    method: 'PUT', headers: local(viewed.id), json: route(id),
  }));
  expect(refused?.status).toBe(403);
  expect(JSON.stringify(refused?.body)).toContain('team_read_only');
});

test('tests a route of the team she develops in, and not of the team she views', async () => {
  const token = await aliceToken();
  const status = async (routeId: string) => {
    const err = await refusal(apiFetch('/api/v1/test-route', token, {
      method: 'POST', headers: local(), json: { route_id: routeId, method: 'GET', path: `/${routeId}` },
    }));
    return err?.status ?? 200;
  };
  expect(await status(routeOf.viewed)).toBe(403);
  // Allowed: whatever the gateway answers, the dashboard did not refuse it.
  expect([200, 502]).toContain(await status(routeOf.developed));
});

const routeRow = (page: Page, id: string) => page.getByRole('row').filter({ hasText: id });

test('the routes page offers a write only on the team she develops in', async ({ page }) => {
  await permission.loginAs(page, `${PREFIX}-alice`, PASSWORD);
  await permission.switchInstance(page, 'Local APISIX');
  await page.goto(`${new URL(page.url()).origin}/ui/routes?name=${ROUTE}`);
  await expect(routeRow(page, routeOf.developed).getByRole('button', { name: 'Delete' })).toBeVisible({ timeout: 20000 });
  await expect(routeRow(page, routeOf.viewed)).toBeVisible();
  await expect(routeRow(page, routeOf.viewed).getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(routeRow(page, routeOf.viewed).getByRole('checkbox')).toBeDisabled();
});

test('the admin gives a role per team in the Permissions modal, and the table names them', async ({ page }) => {
  // Reset to one role for both, then make T2 developer through the UI.
  await ensureUserInstanceRole(await loginAdmin(), alice.id, fx().localInstanceId, {
    role: 'viewer', team_ids: [viewed.id, developed.id],
  });
  await adminPom.toUsers(page);
  const row = adminPom.rowByText(page, `${PREFIX}-alice`);
  await row.getByRole('button', { name: 'Permissions' }).click();
  await page.getByRole('tab', { name: 'Instance Access' }).click();
  const roles = page.getByTestId(`team-roles-${fx().localInstanceId}`);
  await roles.getByRole('radiogroup', { name: `Role in ${developed.name}` })
    .getByText(roleText('developer'), { exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Edit User & Permissions')).toHaveCount(0);

  const stored = (await apiFetch(`/api/v1/user-access/${alice.id}/instances`, await loginAdmin())) as {
    instance_id: string; team_roles?: Record<string, string>;
  }[];
  expect(stored.find((a) => a.instance_id === fx().localInstanceId)?.team_roles)
    .toEqual({ [viewed.id]: 'viewer', [developed.id]: 'developer' });
  await expect(row.getByText(`${viewed.name} · ${roleText('viewer')}`)).toBeVisible();
  await expect(row.getByText(`${developed.name} · ${roleText('developer')}`)).toBeVisible();
});

test('roles on another instance are its own', async () => {
  const admin = await loginAdmin();
  await ensureUserInstanceRole(admin, alice.id, fx().stagingInstanceId, { role: 'viewer', team_ids: [staged.id] });
  const token = await aliceToken();
  // Developer on local, in T2...
  await apiFetch(`${PROXY}/routes/${routeOf.developed}`, token, { method: 'PATCH', headers: local(), json: { desc: 'local' } });
  // ...viewer on staging: reads T3, writes nothing, stopped at the door.
  const staging = on(fx().stagingInstanceId);
  expect((await listed(token, staging))[routeOf.staged]).toBe(staged.id);
  const refused = await refusal(apiFetch(`${PROXY}/routes/${routeOf.staged}`, token, {
    method: 'PATCH', headers: staging, json: { desc: 'staging' },
  }));
  expect(refused?.status).toBe(403);
});

test('an assignment stored before the roles has its role in every team', async () => {
  // Written as a binary from before #role-per-team left it: one role.
  await etcdPut(`/user_instances/${alice.id}/${fx().localInstanceId}`, {
    user_id: alice.id,
    instance_id: fx().localInstanceId,
    team_ids: [viewed.id, developed.id],
    team_id: viewed.id,
    role: 'developer',
  });
  await apiFetch(`${PROXY}/routes/${routeOf.viewed}`, await aliceToken(), {
    method: 'PATCH', headers: local(), json: { desc: 'legacy developer' },
  });
});
```

  Check before running:
  - **The shape of `HttpError`.** The spec reads the response body as `refused.body`. Look at the class in `e2e/utils/seed-client.ts:77` and use its actual field name.
  - **How the routes page filters by name.** Read `e2e/pom/routes.ts` and use its `goto` or its filter helper if it has one, rather than the URL.
  - **The Delete button's accessible name** in a routes row, and whether the row checkbox is a `checkbox` role. Adjust the locators after a first `--headed` run if they differ.
  - **The `radiogroup` role.** Mantine `SegmentedControl` renders a `radiogroup` named by its `aria-label`. If the label is not exposed, fall back to `roles.getByText(developed.name)` plus a sibling locator.

- [ ] **Step 3: Update `multi-team.spec.ts`.** In the assertions on `teams` near :150-164, entries are now `{ id, name, role: 'developer' }`. Use `expect.objectContaining({ id, name })`, or add `role: 'developer'`.

- [ ] **Step 4: Update `users.admin.spec.ts`.** Every Teams-column lookup of a bare team name with `exact: true` becomes the `name · role` text: `` `${teamName} · ${roleText('developer')}` `` (or the role that test assigns). Lookups inside the modal card (`card.getByText(teamName, { exact: true })`) find the name in the "Role in each team" block and the MultiSelect pill. If that is now ambiguous, scope them to the MultiSelect with `teamsField(page)`.

- [ ] **Step 5: Bring up the worktree stack** by following the memory note `worktree-dev-stack`:
  - build the backend to the scratchpad and run it on `PORT=18086`;
  - write `vite.worktree.config.ts` (untracked; it overrides `API_PREFIX` **and** `/api` to `:18086`) and run vite on `:5175`;
  - `rm -rf test-results/.auth`.

- [ ] **Step 6: Run the new spec.**
  Run: `E2E_TARGET_URL=http://127.0.0.1:5175/ui/ E2E_API_URL=http://127.0.0.1:18086 pnpm e2e e2e/tests/multi-team.roles.spec.ts`
  Expected: all 10 tests PASS. Fix locators, not the product, unless a failure shows a real defect. In that case stop and report it.

- [ ] **Step 7: Run the touched specs, one invocation per group.**

```
pnpm e2e e2e/tests/multi-team.spec.ts e2e/tests/team-switch.developer.spec.ts e2e/tests/team-switch.spec.ts
pnpm e2e e2e/tests/users.admin.spec.ts e2e/tests/teams.admin.spec.ts e2e/tests/route-test.team-scope.spec.ts
pnpm e2e e2e/tests/plugin_metadata.viewer-read-only.spec.ts e2e/tests/header.account-role.spec.ts e2e/tests/maintenance.orphaned-assignments.spec.ts
```

  Use the same environment variables as Step 6. Expected: PASS. A failure caused by the machine being saturated is environmental; re-run that file alone.

- [ ] **Step 8: Commit.**

```bash
git add e2e
git commit -m "test(team): cover a viewer team beside a developer team, and roles on two instances" -m "Every multi-team spec used developers, so nothing exercised what a role per team changes: a viewer team read and not written, a create that can only go to the developer team, a route test refused on the viewer team, the modal that sets the role in each team, independent roles on a second instance, and a record from before the roles keeping its rights. The seeding helper takes team_roles; its existing callers are unchanged."
```

---

### Task 9: Final verification and PR

- [ ] **Step 1: Run the full non-e2e verification, from a clean state.**

```bash
cd api && go test ./... && cd ..
pnpm lint --no-cache
pnpm exec tsc -b
pnpm vitest run
```

  Expected: every command exits 0. Paste the summary lines into the PR body.

- [ ] **Step 2: Stop the worktree stack.** Kill only the PIDs this task started (check `/proc/<pid>/cwd`), and delete `vite.worktree.config.ts`.

- [ ] **Step 3: Request a review** with `superpowers:requesting-code-review` on the branch diff against `origin/main`. Fix every finding before opening the PR.

- [ ] **Step 4: Push and open the PR.** Push with `git push -u origin feat-multi-team-membership`, then run `gh pr create` with:
  - the title `feat(team): give a user a role per team on an instance`;
  - a body that explains why, lists what changed per layer, states the rollback consequence from the spec, and lists the verification results;
  - the PR attribution line at the end.

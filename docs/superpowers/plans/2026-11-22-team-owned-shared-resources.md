# Team-owned plugin configs, SSLs and protos (#455) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A viewer sees only their teams' plugin configs, SSLs and protos, as for routes; admins assign them to a team from the detail page.

**Architecture:** The proxy's team ownership is generic over `models.TeamScopedResources` (list filtering and pagination, detail-GET refusal, ownership recorded on create, removed on delete, write checks, orphan sweep). Adding the three types to that set is the backend change; the frontend list cache must key them by team the same way (`TEAM_OWNED_LISTS`), and the routes page's reassign dialog becomes a shared component offered on the three detail pages.

**Tech Stack:** Go 1.22 / Gin (`api/`), React 19 + TanStack Query + Mantine (`src/`), Playwright (`e2e/`).

**Spec:** GitHub issue #455 (`gh issue view 455`).

## Global Constraints

- Work only in `~/working/mad-feat-455-team-owned-resources` (branch `feat/455-team-owned-resources`); never in the shared checkout.
- In scope: `plugin_configs`, `ssls`, `protos`. **Not** `secrets` (follow-up, see the end), **not** `global_rules` / `plugin_metadata` (instance-wide by design, unchanged).
- An object with no owner stays admin-only (existing rule, `caller_scope.go` "unowned is admin-only"); no migration assigns existing objects.
- Admin creates follow routes: the team selected in the header is recorded (`req.ts` sends it on writes); none selected records no owner.
- No new user-visible strings unless unavoidable; reuse `form.reassignTeam.*`. Any new key goes in all 5 locales (use the `add-i18n-key` skill).
- ASF header on new files; `pnpm exec eslint --no-cache --max-warnings=0` clean on touched files; `go test -C api ./...` green.
- Commits: Conventional Commits with this fork's scopes (`api`, `plugin`, `ssl`, `common`…), body explains why, no Co-Authored-By.

## Review Focus

1. **SSL list after the change** - SSL rows still carry the certificate expiry annotation (`annotateCertificateList` runs before the team filter) and the list now paginates in the proxy: a viewer's SSL page shows expiry and correct totals. Pinned in Task 4's e2e.
2. **Direct URL to another team's object** - `GET /plugin_configs/<other team's id>` as a viewer is 403, not 200; the detail page shows the access error, not a blank form. Pinned in Task 4.
3. **Route preview of a plugin config the viewer cannot read** - falls back to the ID (#453 behaviour) instead of an error toast. Pinned in Task 4.
4. **Reassign to a type outside the set** - `PUT /ownership/global_rules/x` must not write a stray record that `DeleteTeam` would count. Pinned in Task 2.
5. **Admin with no team selected creating a plugin config** - it is unowned and disappears from viewers; the admin still sees it and can assign it. Pinned in Task 4.

---

### Task 1: Make the three types team-owned in the backend

**Files:**
- Modify: `api/internal/models/models.go` (`TeamScopedResources`, ~line 316, and its doc comment)
- Modify: `api/internal/handlers/proxy.go` (comment above the `annotateCertificateList` call: "ssls are not team-scoped" is no longer true; keep the call where it is and say why it runs for every list GET of ssls)
- Test: `api/internal/models/models_test.go` (create if absent)

**Interfaces:**
- Produces: `models.TeamScopedResources` containing exactly `routes, services, upstreams, consumers, consumer_groups, stream_routes, plugin_configs, ssls, protos`.

- [ ] **Step 1: Write the failing test** `TestTeamScopedResourcesAreTheTeamOwnedTypes`: asserts the set equals the nine names above, and that `secrets`, `global_rules`, `plugin_metadata`, `plugins`, `labels` are absent (the absences pin the issue's design, with a comment pointing at #455).
- [ ] **Step 2: Run** `go test -C api ./internal/models -run TeamScoped` - expect FAIL (three missing).
- [ ] **Step 3: Add the three types** to the map; update the map's comment (team-owned = has one team's traffic; instance-wide types listed with the reason).
- [ ] **Step 4: Run** `go test -C api ./...` - expect PASS (maintenance and proxy tests included).
- [ ] **Step 5: Commit** `feat(api): make plugin configs, ssls and protos team-owned`.

### Task 2: Refuse reassigning a type no team can own

**Files:**
- Modify: `api/internal/handlers/proxy.go` (`ReassignOwnership`, ~line 1216)
- Test: `api/internal/handlers/ownership_action_test.go`

**Interfaces:**
- Consumes: `models.TeamScopedResources` (Task 1).
- Produces: `func reassignableType(resourceType string) bool` in `proxy.go`.

- [ ] **Step 1: Write the failing test** `TestOnlyTeamOwnedTypesCanBeReassigned`: true for `routes`, `plugin_configs`, `ssls`, `protos`; false for `global_rules`, `secrets`, `plugin_metadata`, `""`, `"../routes"`.
- [ ] **Step 2: Run** `go test -C api ./internal/handlers -run Reassigned` - FAIL (undefined).
- [ ] **Step 3: Implement** `reassignableType` (membership in `models.TeamScopedResources`) and call it in `ReassignOwnership` right after reading the params: 400 `{"error": "This resource type is not owned by a team"}` when false. Today any type is accepted and a record is written that nothing reads but `CountByTeam` counts.
- [ ] **Step 4: Run** `go test -C api ./...` - PASS.
- [ ] **Step 5: Commit** `fix(api): refuse to reassign a resource type no team owns`.

### Task 3: Frontend - team-keyed lists and a shared reassign dialog

**Files:**
- Modify: `src/apis/hooks.ts` (`TEAM_OWNED_LISTS`, ~line 115)
- Create: `src/components/page/ReassignTeamModal.tsx` (moved from `src/routes/routes/detail.$id.tsx:187-303`: props type, `NO_TEAM`, component; exported)
- Modify: `src/routes/routes/detail.$id.tsx` (import it; delete the local copy)
- Modify: `src/routes/plugin_configs/detail.$id.tsx`, `src/routes/ssls/detail.$id.tsx`, `src/routes/protos/detail.$id.tsx`

**Interfaces:**
- Produces: `export const ReassignTeamModal: (props: { opened: boolean; onClose: () => void; onSaved: () => void; resourceType: string; resourceId: string; currentTeamId?: string }) => JSX.Element` from `@/components/page/ReassignTeamModal`.

- [ ] **Step 1: Add** `'plugin_configs'`, `'ssls'`, `'protos'` to `TEAM_OWNED_LISTS` (without it a team pick reuses another team's cached list).
- [ ] **Step 2: Move** the dialog to its own file unchanged in behaviour; routes detail imports it.
- [ ] **Step 3: On each of the three detail pages**, mirror the routes page: read `__team_id` from the detail query's `value`, render the admin-only "reassign" button next to the existing header actions (same `isAdmin` guard, same button as `routes/detail.$id.tsx:380-390`), and the `ReassignTeamModal` with `resourceType` = the API type and `onSaved` = the detail query's `refetch`. Edit/delete gating uses `canWriteOwner(__team_id)` as routes do.
- [ ] **Step 4: Verify** `pnpm exec tsc -b` and `pnpm exec eslint --no-cache --max-warnings=0 <touched files>` clean; `pnpm exec vitest run src/config/locale-keys.test.ts` passes (no dead or missing keys).
- [ ] **Step 5: Commit** `feat(common): offer team reassignment on plugin config, ssl and proto pages`.

### Task 4: e2e - a viewer sees only their teams' objects

**Files:**
- Create: `e2e/tests/shared-resources.team-scope.spec.ts`

**Interfaces:**
- Consumes: `getFixtures()` (`viewersTeamId`, `backendTeamId`, `users.viewer`, `users.admin`, `localInstanceId`), `loginAdmin(username, password)` and `apiFetch` from `@e2e/utils/seed-client`, `e2eReq`, `deleteByPrefix`, `uiCell`, POMs `pluginConfigsPom`, `sslsPom`, `protosPom`, `genTLS` for the SSL body.

Seed per type, as admin over the API with a unique prefix: one owned by the **Viewers** team (`X-Team-ID: viewersTeamId`), one by **Backend**, one with **no** team. Clean up by prefix in `afterAll`. Run serially.

- [ ] **Step 1: Write the tests** (one `describe` per type, same four checks, table-driven over the three types):
  - `a viewer lists only the <type> of their team`: as the viewer (token from `loginAdmin(viewer)`), the list contains the Viewers object and neither the Backend nor the unowned one; `total` counts one of the seeded prefix.
  - `a viewer cannot open another team's <type> by its id`: viewer GET of the Backend object -> 403; of the unowned one -> 403.
  - `an admin sees all three`: admin list contains all three.
  - `reassigning hands it to the viewer's team` (plugin configs only, through the UI): admin opens the Backend object's detail page, reassigns to Viewers; viewer's list now contains it.
  - Review-focus pins: the viewer's SSL list rows still carry the expiry field; a route whose `plugin_config_id` is the Backend object, opened by the viewer, shows the ID in the preview and no error toast.
- [ ] **Step 2: Prove they fail on main** - run the spec against a stack built from `origin/main` (stash Tasks 1-3 or use a second worktree): the "lists only" and "cannot open" checks fail.
- [ ] **Step 3: Run on the branch** with the worktree stack: `bash ~/.claude/skills/worktree-stack/scripts/stack.sh up`, then the `e2e-env` exports and `pnpm e2e e2e/tests/shared-resources.team-scope.spec.ts --workers=2` - all pass. Also run the specs this touches: `plugin_configs.*`, `ssls.*`, `protos.*`, `routes.reassign-team.spec.ts`, `maintenance.orphaned-ownership.spec.ts`.
- [ ] **Step 4: Commit** `test(common): a viewer sees only their teams' plugin configs, ssls and protos`.

### Task 5: Docs

**Files:**
- Modify: `CLAUDE.md` ("Resource-type RBAC" / role notes: which types are team-owned, which are instance-wide and why)
- Modify: `README.md` line 13 only if it lists owned types

- [ ] **Step 1:** Update the text; mention that objects created before this change are admin-only until assigned (the release note for the next tag says the same).
- [ ] **Step 2: Commit** `docs: say which resources a team owns`.

---

## Follow-up, not in this plan: secrets

A secret is addressed `/secrets/<manager>/<id>`. `getResourceMetadata` reads its id as the manager, and `ListOwnersByResourceType` keeps only the last key segment, so `vault/1` and `aws/1` would share one record. Team-owning secrets needs an ownership id of its own (e.g. `<manager>:<id>`, `:` being outside APISIX's id charset) used consistently by the write check, the detail GET, the list filter (row `value.id` is `vault/1`), delete and the orphan sweep. Separate PR, referencing #455.

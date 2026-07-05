# Admin-page E2E Coverage — Design

**Date:** 2026-07-05
**Status:** Approved
**Scope:** Playwright e2e tests for the four multi-tenant admin pages (Users, Teams, Instances, Overview), which currently have API-level coverage only (`multi-instance.spec.ts`) and no UI tests.

## Goal

Cover the fork-specific admin functionality that no existing e2e test drives through
the UI: page CRUD on Users/Teams/Instances, the per-instance role-assignment flow,
and the Overview dashboard. Depth is "CRUD + key flows" (~14 tests), not exhaustive
negative-casing.

## Approach (decided)

One spec file per page, parallel-safe via randomized entity names (Approach A).
Prerequisites that are not themselves under test are seeded via `e2eReq` (API);
every behavior under test is driven and asserted through the UI.

Rejected alternatives:

- **Serial "admin story" spec** — one failure cascades; can't shard across the
  3-shard CI matrix.
- **API-seeded hybrid with API assertions** — thinnest UI coverage; wouldn't catch
  UI-layer regressions (e.g., the 2026-07-05 import-modal footer bug).

## Files

| File | Purpose |
|---|---|
| `e2e/pom/admin.ts` | `goto` / `isPage` helpers for `/users`, `/teams`, `/instances`, `/overview` |
| `e2e/tests/teams.admin.spec.ts` | ~3 tests |
| `e2e/tests/instances.admin.spec.ts` | ~4 tests |
| `e2e/tests/users.admin.spec.ts` | ~5 tests |
| `e2e/tests/overview.spec.ts` | ~2 tests |

All specs use the existing `test` fixture from `e2e/utils/test.ts` (worker-scoped
admin login, pinned Local APISIX instance), `randomId()` from `e2e/utils/common.ts`
for entity names, and `e2eReq` from `e2e/utils/req.ts` for seeding/cleanup/API
assertions against the Go backend's `/api/v1/*`.

## Tests

### teams.admin.spec.ts

1. **Create team** — open "Add New Team" modal, submit a `randomId` name +
   description, assert the team appears in the table.
2. **Delete team** — delete the created team from the table, assert it disappears.
3. **Validation** — submitting the modal with an empty name shows a validation
   error and does not create a team.

The Teams page has no edit affordance (create/delete only, per
`src/routes/teams/index.tsx`), so no edit test.

### instances.admin.spec.ts

1. **Create instance** — "Add New Instance" modal with a `randomId` name, Admin API
   URL `http://127.0.0.1:9181` (the real Staging APISIX from
   `e2e/server/docker-compose.yml`), and its admin key
   (`edd1c9f034335f136f87ad84b625c8f1` from `apisix_conf_2.yml`); assert it appears
   in the table.
2. **Test Connection (reachable)** — the row's Test Connection action reports
   success for that instance.
3. **Edit instance** — change name/description, assert the table reflects it.
4. **Test Connection (unreachable) + delete** — an instance registered with an
   unreachable URL (e.g., `http://127.0.0.1:1`) reports a connection failure;
   delete both created instances, assert they're gone.

### users.admin.spec.ts

1. **Create user** — "Add New User" modal (Username, Email, Password, Global Role
   "User"), assert the user appears in the User Management table.
2. **Assign per-instance role** — edit the user, assign Role "Viewer" on the seeded
   Local APISIX instance plus a team (seeded via API in `beforeAll`), save, assert
   the assignment shows on the user row/detail.
3. **Key flow: assignment takes effect** — fresh browser context (no worker auth
   state), log in via the login page as the new user, assert: the header instance
   selector offers only Local APISIX, and the routes page shows no write
   affordances (viewer gating).
4. **Role upgrade** — as admin, change the user's per-instance role to Instance
   Admin; in a fresh context, the user now sees write affordances on routes.
5. **Delete user** — delete the user; a subsequent login attempt with their
   credentials fails (401 surfaced as a login-page error).

### overview.spec.ts

1. **Gateway health** — page renders "Gateway Health" with `active/total` counts
   matching `GET /api/v1/overview` (fetched via `e2eReq` in the same test).
2. **Resource matrix reflects reality** — create a route via API, reload Overview,
   assert the routes count is `>=` the pre-creation count + 1 (delta/`>=`
   assertions only — parallel tests create resources concurrently).

## Isolation rules (fullyParallel)

- Seeded fixtures (admin user, Local/Staging instances, global-setup teams/users)
  are **never modified or deleted**.
- Every created entity uses a `randomId()` name; assertions filter by that name,
  never by table position or exact totals.
- Cleanup in `afterAll` via `e2eReq`, resilient to mid-test failure (delete by
  name-match, ignore 404s).
- Overview asserts deltas or `>=`, never exact counts.

## Flake control

- The fresh-context login tests bypass the worker fixture deliberately; they use
  the same login-page path `auth.spec.ts` already exercises.
- Test Connection success depends on Staging APISIX (`:9181`) being up — guaranteed
  by the e2e docker-compose stack that CI brings up before the suite.
- The deleted-user login assertion tolerates the backend's error-message shape;
  it asserts the failure outcome, not exact copy.
- New-instance rows appear in every admin's header instance list while the test
  runs; other tests pin their instance explicitly (worker fixture), so this is
  benign.

## Out of scope

- Negative UI cases beyond the two above (non-admin blocked from /users, in-use
  team deletion refusal) — deferred; noted as a possible follow-up.
- OpenAPI import, batch delete, logout, header switching, proxy-error banner,
  RawJsonDrawer — identified as untested but not selected for this round.

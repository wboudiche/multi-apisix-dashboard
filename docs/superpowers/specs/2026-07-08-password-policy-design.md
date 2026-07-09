# Password Policy & Auth Hardening — Design Spec

- **Date:** 2026-07-08
- **Status:** Approved (design); pending implementation plan
- **Scope area:** `api/` (Go backend) + `src/` (React SPA)

## 1. Goal

Add an enforceable, admin-configurable password policy plus login-lockout
protection to the multi-tenant dashboard. Today passwords are bcrypt-hashed
(cost 10) but subject to **no** validation: `CreateUser`, `ChangePassword`, and
the admin bootstrap accept any non-empty string.

## 2. Scope (confirmed)

In scope:

1. **Complexity** — minimum length + character-class requirements.
2. **History** — reject reuse of the last N passwords.
3. **Expiry** — require rotation after N days.
4. **Lockout** — lock a username after N failed logins for a cooldown window.
5. **Forced change** — expired passwords and admin-created/reset accounts must
   change password at next login before doing anything else.
6. **Admin-editable policy** — super_admin edits the policy in the UI; stored in
   etcd; no redeploy needed.

Out of scope (explicitly dropped):

- Common/breached-password blocking (no bundled list, no HIBP).
- Email-based password reset (no mail infra in this project).
- Per-team or per-instance policies (single global policy).

## 3. Approach

**Approach A — dedicated `policy` service + etcd-backed state.** A new Go package
owns the policy config, validation, expiry, history, and lockout state. Chosen
over inline validation (scattered, in-memory lockout doesn't survive restarts /
multi-instance) and third-party libraries (limited i18n control; only covers
complexity anyway). Rationale: keeps logic cohesive and unit-testable, makes
lockout persistent and consistent, and matches the existing `services/` + etcd
architecture.

## 4. Data model & configuration

### 4.1 New `models.User` fields

| Field | Type | Purpose |
|---|---|---|
| `PasswordChangedAt` | `time.Time` | basis for expiry calculation |
| `PasswordHistory` | `[]string` | last N bcrypt hashes (reuse prevention) |
| `MustChangePassword` | `bool` | forces the change screen at next login |

`PasswordHash` (existing) is unchanged. `PasswordHistory` is capped at
`HistoryDepth` entries and is never returned by the API (like `PasswordHash`,
which handlers already blank out on responses).

### 4.2 Policy config — etcd key `/config/password_policy` (JSON)

Loaded into an in-memory cache at startup and refreshed on every successful
`PUT`. If the key is absent, the built-in defaults below are used (and written
on first save).

| Field | Default | Notes |
|---|---|---|
| `MinLength` | `12` | floor enforced ≥ 8 |
| `MaxLength` | `72` | hard cap; bcrypt only hashes the first 72 bytes |
| `RequireUppercase` | `true` | |
| `RequireLowercase` | `true` | |
| `RequireDigit` | `true` | |
| `RequireSymbol` | `true` | |
| `HistoryDepth` | `5` | `0` disables history |
| `ExpiryDays` | `90` | `0` disables expiry |
| `LockoutThreshold` | `5` | `0` disables lockout |
| `LockoutWindow` | `15m` | Go duration; cooldown after threshold reached |

A feature is disabled when its numeric value is `0`.

### 4.3 Lockout state — etcd key `/auth/lockout/<username>` (JSON)

`{ FailedCount int, FirstFailedAt time.Time, LockedUntil time.Time }`

Stored separately from the `User` record so that:
- a failed login does not rewrite the whole user object, and
- it is keyed by the submitted **username** — it works even when the user does
  not exist, so lockout behaviour cannot be used to enumerate accounts.

A record whose `LockedUntil` is in the past is treated as unlocked (lazy
cleanup; no background job required).

### 4.4 bcrypt 72-byte cap

bcrypt silently truncates input beyond 72 bytes. `MaxLength` is capped at 72 to
make the limit explicit rather than silent. (Alternative — pre-hash with
SHA-256 — is deliberately **not** taken, to keep hashes portable and the change
small.)

### 4.5 Migration of existing users

- Existing users have a zero `PasswordChangedAt`. A zero value is treated as
  "changed at deploy" — i.e. **not** expired immediately — and is stamped with
  the real time on the next password change.
- `PasswordHistory` starts empty; the current password is not retroactively
  added.
- No existing user is force-changed or locked out retroactively. The bootstrap
  admin is unaffected.

## 5. The `policy` service

New package `internal/services/policy` (single responsibility). Public surface:

```go
LoadPolicy(ctx) (*Policy, error)          // cached read of /config/password_policy; defaults if absent
SavePolicy(ctx, *Policy) error            // validate config sanity, write, refresh cache
Validate(pw, username string, history []string) []Violation  // complexity + reuse; returns ALL failures
IsExpired(user *models.User) bool         // ExpiryDays>0 && now-PasswordChangedAt > ExpiryDays
RegisterFailure(ctx, username) (locked bool, until time.Time)  // increment; lock at threshold
ClearFailures(ctx, username) error        // reset on successful login / unlock
IsLocked(ctx, username) (locked bool, until time.Time)
```

`Validate` returns a **slice** of violations (not the first failure) so the UI
can tick every rule at once. A `Violation` is `{ Code string, Params map[string]any }`
(e.g. `{"min_length", {"min":12}}`), never a pre-rendered sentence — the
frontend localises codes.

Reuse detection: `Validate` receives the candidate password and the user's
history; it bcrypt-compares the candidate against each stored history hash and
emits `reused_password` on a match.

## 6. Data flows

### 6.1 Setting a password (`CreateUser`, `ChangePassword`)

```
1. violations = policy.Validate(newPw, username, user.PasswordHistory)
   if violations: 422 { error, violations }        // nothing written
2. hash = bcrypt(newPw)
3. user.PasswordHistory = append(PasswordHistory, hash) truncated to HistoryDepth
4. user.PasswordHash = hash
5. user.PasswordChangedAt = now
6. user.MustChangePassword = false
7. persist
```

- **CreateUser** (super_admin): complexity applies to the temporary password;
  the new user is created with `MustChangePassword = true`.
- **ChangePassword**: existing old-password check runs first, then the flow above.

### 6.2 Login (`Login`)

```
1. if policy.IsLocked(username):            423 Locked { until }
2. if wrong password:
     locked, until = policy.RegisterFailure(username)
     locked ? 423 Locked { until } : 401 invalid credentials
3. correct password:
     policy.ClearFailures(username)
     mustChange = user.MustChangePassword || policy.IsExpired(user)
     200 { access_token, refresh_token, expires_in, must_change_password: mustChange }
```

Tokens are issued even when `must_change_password` is true, so the user can call
`ChangePassword`. The `must_change` state is carried as a JWT claim.

### 6.3 Forced-change gating (middleware)

- The access token carries `must_change` (set at login).
- A middleware after auth returns `403 { must_change_password: true }` for every
  route **except** the allowlist: `ChangePassword`, `me`, `GET
  /settings/password-policy`, `logout`.
- On a successful `ChangePassword`, the backend **re-issues** fresh tokens with
  `must_change = false`; the frontend swaps them and the gate clears.

## 7. API

| Method | Route | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/settings/password-policy` | authenticated | read policy (Settings page + form checklist) |
| `PUT` | `/api/v1/settings/password-policy` | super_admin | update policy (sanity-validated) |

Changed contracts:
- `POST /login` response gains `must_change_password: bool`; may return `423 Locked { until }`.
- `POST .../change-password` re-issues tokens (`must_change=false`) in its response.

`PUT` rejects nonsensical configs (`MinLength` below floor or above 72, negative
values) with `422`.

## 8. Frontend

1. **Settings page** — `/ui/settings`, super_admin, added to the
   `SUPER_ADMIN_ONLY` nav list in `usePermission`. Form for every policy field;
   saves via `apiClient` (`PUT`). Uses the JWT client, not `req`.
2. **Forced-change screen** — `/ui/change-password`. Entered by force when login
   returns `must_change_password`, or on any `403 { must_change_password }`; nav
   is blocked until the change succeeds. Also reachable voluntarily from the user
   menu. On success, store the re-issued tokens and redirect to `/`.
3. **Requirement checklist** — a reusable component that fetches the policy and
   live-validates the password field, ticking ✓/✗ per rule. Reused in the
   create-user form and the change-password screen.
4. **Messaging** — login shows "account locked until HH:MM" on `423`; server
   `422` violations render under the field via localized code→string mapping.
5. **i18n** — all new strings added to `en/de/es/tr/zh` `common.json`
   (source of truth = `en`), respecting the `no-literal-string` /
   `no-unknown-key` rules.

## 9. Error handling summary

| Condition | Status | Body |
|---|---|---|
| Password fails policy | `422` | `{ error, violations: [{code, params}] }` |
| Account locked | `423` | `{ error, until }` |
| Must change password (gated route) | `403` | `{ must_change_password: true }` |
| Invalid policy config on save | `422` | `{ error, violations }` |
| Wrong credentials | `401` | same message whether or not the user exists |

## 10. Testing

Follows the existing `internal/services/*_test.go` pattern (e.g. `label_test.go`).

- **Unit (`policy`)** — table-driven: each complexity rule pass/fail; reuse via
  history; `IsExpired` (enabled/disabled/boundary); `RegisterFailure` →
  threshold → lock → `ClearFailures`; disabled features (value `0` skips the
  check); bcrypt 72-byte boundary.
- **Handlers** — enforcement on `CreateUser` / `ChangePassword` / `Login`;
  policy endpoints require super_admin; login returns `must_change_password`;
  gating middleware allowlist.
- **Frontend** — checklist component logic; one Playwright e2e covering the
  forced-change flow and the lockout message.

## 11. Delivery phases

One spec, four independently shippable phases:

1. **Complexity + policy store + Settings page + checklist.** Core value, low risk.
2. **History (no reuse).**
3. **Expiry + forced-change flow + gating middleware.**
4. **Login lockout.**

## 12. Open items / assumptions

- Default policy values (§4.2) are opinionated defaults; all are runtime-editable.
- `MaxLength` capped at 72 (bcrypt); pre-hashing not adopted.
- Single global policy (no per-team/instance variation).
- Lockout is per-username, lazy-expired; no admin "unlock now" button in phase 4
  (a super_admin password reset clears failures) — can be added later.

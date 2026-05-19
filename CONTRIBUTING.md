<!--
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
-->

# Contributing to Multi-Tenant APISIX Dashboard

Thanks for your interest in contributing. This project is a fork of [apache/apisix-dashboard](https://github.com/apache/apisix-dashboard) that adds a Go backend and multi-tenant controls (users, teams, instances, roles, labels). Bug fixes against upstream code are welcome too — if you also want them upstream, mention that in your PR and we'll help land it there.

Participation in this project is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Reporting bugs

Search [open issues](../../issues) first. When opening a new one, include:

- A clear title and description.
- Steps to reproduce (commands run, URL hit, role/instance/team in use).
- Expected vs. actual behavior.
- Backend logs (`./bin/api` stderr) and browser console output if relevant.
- Versions: APISIX, Go, Node, browser.

## Proposing a feature or significant change

Open an issue first to discuss the design. Multi-tenant features especially benefit from upfront discussion because they cross the Go ↔ React boundary, the etcd schema, and the auth/RBAC middleware. PRs that arrive with no prior issue and substantial scope changes are likely to need rework.

## Development setup

See [`docs/en/development.md`](./docs/en/development.md) — covers Docker, etcd, the Go backend, and the Vite dev server.

## Submitting a pull request

Before you push:

- `pnpm lint` must pass with zero warnings (`--max-warnings=0`).
- `pnpm build` must succeed (TypeScript + Vite).
- `go test -C api ./...` must pass for backend changes.
- E2E (`pnpm e2e`) should pass for changes that touch resource pages or the auth flow.
- Add tests for new functionality. Co-locate Go tests next to the code; add Playwright specs under `e2e/tests/`.
- Multi-tenant RBAC and ownership coverage lives in `e2e/tests/*.ownership.spec.ts` and `e2e/tests/*.restricted-write.spec.ts`; fixtures (test users, teams, second instance) are provisioned by `e2e/utils/global-setup.ts` before any spec runs.
- Update `docs/en/development.md` or the README if your change affects how others run or deploy the project.

In the PR description:

- Reference the related issue (e.g. "resolves #123").
- Explain the *why* — what user-visible problem this solves.
- Note any breaking changes and migration steps (especially for etcd schema or JWT/auth changes — those affect existing deployments).
- For UI changes, include a screenshot or short clip.

## Commit message format

Inherited from upstream. Each commit has a header, body, and optional footer:

```
<type>(<scope>): <short summary>

<body explaining why — required for everything except docs>

<optional footer: BREAKING CHANGE, Fixes #N, etc.>
```

### Type

One of: `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `test`.

### Scope

This fork extends the upstream scope list with the multi-tenant additions. Use one of:

- Upstream resource scopes: `route`, `upstream`, `consumer`, `ssl`, `plugin`, `common`
- Multi-tenant scopes: `auth`, `user`, `team`, `instance`, `role`, `label`, `overview`, `api` (Go backend, not a specific feature)

Or omit the scope if the change is cross-cutting (`refactor:` across many areas, `docs:` not tied to one feature).

### Summary

- Imperative, present tense (`add`, not `added`).
- Lowercase first letter.
- No trailing period.
- ≤100 chars per line in the whole message.

### Body

Imperative, present tense. Explains **why** — the motivation, the alternative considered, the trade-off. Not what the code does (the diff already shows that).

### Footer

- `BREAKING CHANGE: <summary>` followed by a blank line and migration instructions, when applicable.
- `Fixes #N` to auto-close issues.

### Reverts

Start the header with `revert:` followed by the original header. In the body, include `This reverts commit <SHA>` and the reason.

Examples:

```
feat(instance): add per-instance admin key rotation

Operators currently need to redeploy the backend to rotate an instance's
admin key. This adds a UI flow + PUT /instances/:id/key endpoint so a
super_admin can rotate without restarting.

Fixes #142
```

```
fix(auth): reject empty JWT_SECRET at startup

A blank secret was silently accepted, producing tokens that any HS256
implementation would also accept. Refuse to start if JWT_SECRET is the
literal default in non-dev mode.

BREAKING CHANGE: backend now panics on startup if JWT_SECRET is unset
or matches the documented default. Set a 32+ byte random value before
upgrading.
```

## Questions

Open a [discussion](../../discussions) (or an issue if discussions aren't enabled yet).

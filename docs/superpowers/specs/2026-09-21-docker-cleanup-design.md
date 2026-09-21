# Fewer Docker pieces — design

Date: 2026-09-21

## Goal

Reduce the number of Docker artifacts in the repository without moving any
directory: drop the APISIX image that bakes the UI for the e2e stack, keep one
APISIX config per stack instead of two, and add a map of what remains.

## Starting point (origin/main after #235)

| Location | Role | Depended on by |
|---|---|---|
| `Dockerfile`, `.dockerignore` | official Go + SPA image | `docker.yml`, `deploy/` (`build: ..`) |
| `deploy/` (compose, `.env.example`, `apisix/apisix_conf.yml`, `apisix/apisix_conf_2.yml`, README) | demo stack consuming the image | README, docs |
| `e2e/server/` (compose, `Dockerfile`, `apisix_conf.yml`, `apisix_conf_2.yml`) | test stack: two APISIX + etcd | `e2e.yml`, `.devcontainer` (`include:`), the restart spec, docs |
| `.devcontainer/` (compose, override, Dockerfile) | VS Code container, includes the e2e compose | path mandated by VS Code |

Two facts drive the design:

- Nothing uses the UI baked into the e2e APISIX image any more. The suite
  targets the dev server on `:5173` (#272); the only remaining consumer of
  `http://127.0.0.1:9180/ui` is the readiness probe in `e2e.yml`. That image
  build costs minutes per CI shard and is the origin of the "stale page on
  9180" confusion (#237).
- The paired configs differ by two lines each: the etcd prefix, and (e2e only)
  the `control:` block that binds the Control API to `0.0.0.0` on the first
  gateway. APISIX 3.16 substitutes `${{VAR:=default}}` in `config.yaml`
  (verified: a gateway with `APISIX_ETCD_PREFIX=/apisix2` initialised
  `/apisix2/…` while the default one initialised `/apisix/…` in the same etcd).

## Decisions

| Question | Decision |
|---|---|
| Move directories under `docker/`? | No. Compose names the project after the directory (`server`), and the container names are relied on by docs, sessions and the restart spec (#290). |
| e2e APISIX image | Deleted; `apisix` uses `apache/apisix:3.16.0-debian` like `apisix2`. |
| Paired configs | One file per stack; the second gateway gets its prefix from an env var. |
| Shared configs between e2e and deploy? | No. `deploy/` stays copyable on its own; the restart spec edits the e2e file only. |
| Root `Dockerfile`, `docker.yml`, `.devcontainer/` | Unchanged. |

## 1. Drop the baked e2e image

- Delete `e2e/server/Dockerfile`.
- `e2e/server/docker-compose.yml`: the `apisix` service replaces its `build:`
  block with `image: apache/apisix:3.16.0-debian`. Everything else in the
  service (volumes, entrypoint, ports, control API comment) stays.
- `.github/workflows/e2e.yml`: the "Waiting dashboard service to be healthy"
  step becomes "Waiting for the gateway's Admin API" and probes
  `http://127.0.0.1:9180/apisix/admin/routes` expecting HTTP `401` (no key
  sent; APISIX answers 401 as soon as it is up). Same 30 s timeout.
- Prose that described the `:9180` bundle is removed or reworded:
  - `CLAUDE.md`: the "**The dashboard on `:9180` is not the working tree.**"
    paragraph goes; the E2E section's parenthetical "(the image bundle lives at
    `http://localhost:9180/ui/`)" goes.
  - `docs/en/development.md`: the bring-up list says `:9180` is the Admin API
    only (it already does); no mention of a UI on 9180 remains.
  - `README.md` compatibility paragraph: "see `e2e/server/docker-compose.yml`"
    only (the Dockerfile link is removed).
  - `src/components/BuildIdentity.tsx` doc comment: the page is served by the
    vite dev server or by the official image (`Dockerfile`, which installs git
    for `unplugin-info`); the #237 story stays as history in one sentence.
  - `e2e/utils/env.ts`: the `E2E_TARGET_URL` description drops the sentence
    about the image bundle at 9180 and keeps the dev-container hint.
- `.devcontainer/docker-compose.yml` needs no change: `include:` of a compose
  file without `build:` is fine, and its `apisix-dashboard` service builds from
  `.devcontainer/Dockerfile`, not the e2e one.

## 2. One APISIX config per stack

`e2e/server/apisix_conf.yml`:

```yaml
apisix:
  node_listen: 9080
  enable_ipv6: false
  # (existing comment about the Control API)
  control:
    # 0.0.0.0 on the first gateway only (set by the compose file); the second
    # keeps APISIX's loopback default, so the stack still has one gateway that
    # exposes nothing, which is the ordinary case worth testing too.
    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}
    port: 9090
  proxy_mode: http&stream
  stream_proxy: …
deployment:
  …
  etcd:
    host:
      - http://etcd:2379
    # The second gateway shares this file and this etcd; the compose file gives
    # it its own prefix so the two stay apart.
    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}
    timeout: 30
```

`e2e/server/docker-compose.yml`: `apisix` gets `environment: APISIX_CONTROL_IP:
0.0.0.0`; `apisix2` mounts `./apisix_conf.yml` and gets `environment:
APISIX_ETCD_PREFIX: /apisix2`. `e2e/server/apisix_conf_2.yml` is deleted.

`deploy/apisix/apisix_conf.yml`: `prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}`
(its `control:` block already binds `0.0.0.0` on both gateways; that stays).
`deploy/docker-compose.yml`: `apisix2` mounts `./apisix/apisix_conf.yml` and gets
`APISIX_ETCD_PREFIX: /apisix2`. `deploy/apisix/apisix_conf_2.yml` is deleted.
`deploy/README.md` points at the single file.

Comments in `e2e/tests/header.instance-health.spec.ts` and
`e2e/tests/instances.admin.spec.ts` that say "key from apisix_conf_2.yml" now say
"key from apisix_conf.yml (shared by both gateways)". `e2e/utils/global-setup.ts`
already reads the key from one place.

`e2e/utils/apisix-conf.test.ts` gains a case: a config containing
`prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}` and `ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}`
comes back from `withProxyMode` with both placeholders byte-identical (the yaml
library must not quote or fold them).

## 3. A map of what remains

`docs/en/development.md` gains a section "Docker in this repo" right after the
prerequisites:

| Path | What it is | Used by |
|---|---|---|
| `Dockerfile` | the official image (Go backend + built UI), published to GHCR on `vX.Y.Z` tags | `docker.yml`, `deploy/` |
| `deploy/` | a copyable compose that runs the image with etcd and two APISIX | people deploying |
| `e2e/server/` | the test stack (two stock APISIX + etcd, no image build) | `pnpm e2e`, CI, the devcontainer |
| `.devcontainer/` | VS Code container; includes the e2e stack | VS Code users |

`README.md` links to that section from the quick start.

## Out of scope

- Moving directories or renaming the compose project.
- Deduplicating the socket-purging entrypoint across the two compose files.
- Changes to the root `Dockerfile`, `.dockerignore` or `docker.yml`.

## Verification

1. `pnpm test` (unit, includes `apisix-conf.test.ts`) and `pnpm lint` pass.
2. From a worktree, `docker compose -f e2e/server/docker-compose.yml config`
   renders both gateways with the single conf mount and the two env vars; no
   `build:` key remains.
3. An isolated copy of the e2e stack (project `e2e-check`, host ports remapped)
   comes up: gateway 1 answers 401 on `/apisix/admin/routes` without a key, a
   route created on gateway 2 lands under `/apisix2/routes/` in etcd and not
   under `/apisix/`, and gateway 1's Control API answers on its network address
   while gateway 2's does not.
4. Same check on `deploy/` under project `dashboard-demo`: both gateways
   registrable, routes and stream routes 200 through the dashboard proxy.
5. The e2e workflow on the PR is green with the new probe, and its "Run e2e
   server" step no longer builds an image.

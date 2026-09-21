# Docker Clean-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the APISIX image that bakes the UI for the e2e stack, keep one APISIX config per stack (e2e and deploy) with the second gateway configured through env vars, and document what remains.

**Architecture:** No directory moves. The e2e compose runs two stock `apache/apisix:3.16.0-debian` gateways that mount the same `apisix_conf.yml`; APISIX substitutes `${{VAR:=default}}` in `config.yaml`, so the compose file hands the second gateway its etcd prefix (`APISIX_ETCD_PREFIX=/apisix2`) and the first its Control API bind address (`APISIX_CONTROL_IP=0.0.0.0`). The same prefix trick applies to `deploy/`. The CI readiness probe stops depending on a UI at `:9180`.

**Tech Stack:** Docker Compose (repo default plugin is 2.20; `/usr/local/bin/docker-compose` 2.29 supports `!override`), APISIX 3.16, GitHub Actions, vitest (`pnpm test`), the `yaml` npm package (`e2e/utils/apisix-conf.ts`).

**Spec:** `docs/superpowers/specs/2026-09-21-docker-cleanup-design.md`

## Global Constraints

- Work only in the worktree `/home/walidboudiche/working/multi-apisix-dashboard-docker` on branch `refactor/docker-cleanup`. Start every shell command with `cd` into it or use absolute paths. Never touch `/home/walidboudiche/working/multi-apisix-dashboard` (other sessions use it).
- Never run `docker restart`, `docker stop`, `docker rm`, `pkill` or `kill` on anything you did not start. Never attach to the `server_apisix` network. The shared stack (`server-apisix-1`, `server-apisix2-1`, `server-etcd-1`, backend `:8086`, vite `:5173`) is off-limits.
- Local stack checks run under their own compose project name (`e2e-check`, `dashboard-demo`) with remapped host ports, and are torn down with `down -v`.
- Container names `server-apisix-1` etc. and the e2e compose project name stay as they are (no `name:` key, no directory move).
- Pins stay: `apache/apisix:3.16.0-debian`, `bitnamilegacy/etcd:3.5`. Admin key stays `edd1c9f034335f136f87ad84b625c8f1`.
- Commit messages: Conventional Commits `<type>(<scope>): <summary>` with a body explaining why; no `Co-Authored-By` trailer. Type `build` for compose/Dockerfile, `ci` for workflows, `test` for e2e helpers, `docs` for docs-only.
- `pnpm lint --no-cache` must stay clean (the cached `pnpm lint` can hide errors). ASF license headers stay on every `.ts` and `.yml` file that has one today.

---

## File map

| Path | Change |
|---|---|
| `e2e/server/apisix_conf.yml` | `control.ip` and `etcd.prefix` become `${{VAR:=default}}` placeholders |
| `e2e/server/apisix_conf_2.yml` | **deleted** |
| `e2e/server/docker-compose.yml` | `apisix`: `build:` → `image:`, `environment: APISIX_CONTROL_IP`; `apisix2`: mounts `apisix_conf.yml`, `environment: APISIX_ETCD_PREFIX` |
| `e2e/server/Dockerfile` | **deleted** |
| `e2e/utils/apisix-conf.test.ts` | new case: placeholders survive `withProxyMode` |
| `e2e/tests/header.instance-health.spec.ts`, `e2e/tests/instances.admin.spec.ts` | one comment each |
| `e2e/utils/env.ts` | `E2E_TARGET_URL` description and doc comment |
| `.github/workflows/e2e.yml` | readiness probe on the Admin API |
| `src/components/BuildIdentity.tsx` | doc comment |
| `CLAUDE.md`, `README.md`, `docs/en/development.md` | prose about the `:9180` bundle removed; "Docker in this repo" map added |
| `deploy/apisix/apisix_conf.yml` | `etcd.prefix` placeholder |
| `deploy/apisix/apisix_conf_2.yml` | **deleted** |
| `deploy/docker-compose.yml` | `apisix2` mounts `apisix_conf.yml`, `environment: APISIX_ETCD_PREFIX` |
| `deploy/README.md` | wording |

---

### Task 1: One APISIX config for the e2e stack

**Files:**
- Modify: `e2e/server/apisix_conf.yml`
- Delete: `e2e/server/apisix_conf_2.yml`
- Modify: `e2e/server/docker-compose.yml` (services `apisix` and `apisix2`)
- Modify: `e2e/tests/header.instance-health.spec.ts:40`, `e2e/tests/instances.admin.spec.ts:29`
- Test: `e2e/utils/apisix-conf.test.ts`

**Interfaces:**
- Produces: env vars `APISIX_ETCD_PREFIX` (default `/apisix`) and `APISIX_CONTROL_IP` (default `127.0.0.1`) read by APISIX from `config.yaml`. Task 2 keeps the compose file otherwise intact; Task 3 reuses the prefix variable name in `deploy/`.

- [ ] **Step 1: Write the guard test**

Append to the `describe('withProxyMode', …)` block in `e2e/utils/apisix-conf.test.ts`, after the "leaves the gateway config byte for byte" case:

```ts
  // The compose files hand the second gateway its etcd prefix through an
  // env var that APISIX expands from config.yaml. The placeholder is plain
  // text to the yaml library; this pins that it is neither quoted nor folded
  // on the way through.
  it('keeps APISIX env placeholders byte for byte', () => {
    const conf = [
      'apisix:',
      '  proxy_mode: http&stream',
      '  control:',
      '    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}',
      'deployment:',
      '  etcd:',
      '    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}',
    ].join('\n');

    const updated = withProxyMode(conf, 'http');

    expect(updated).toContain('    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}\n');
    expect(updated).toContain('    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}\n');
  });
```

- [ ] **Step 2: Run it**

Run: `cd /home/walidboudiche/working/multi-apisix-dashboard-docker && pnpm test e2e/utils/apisix-conf.test.ts`
Expected: PASS (the yaml library already keeps plain scalars as written; the case is a guard against a future change of library or options). If it FAILS because the placeholder came back quoted, stop and report BLOCKED: the design depends on this.

- [ ] **Step 3: Rewrite `e2e/server/apisix_conf.yml`**

Replace the whole file with (keep it comment-rich; the byte-for-byte test counts comments):

```yaml
apisix:
  node_listen: 9080
  enable_ipv6: false
  # APISIX serves the Control API by default (enable_control), but binds it to
  # loopback inside the container, where nothing outside can reach it. The
  # dashboard reads upstream health from it (#281), so this stack moves it to
  # an address the host can reach - as a deployment would have to do
  # deliberately, since the port carries no authentication of its own.
  #
  # Both gateways read this one file. The compose file sets APISIX_CONTROL_IP
  # to 0.0.0.0 on the first gateway only; the second keeps the loopback
  # default, so the stack still has a gateway that exposes nothing, which is
  # the ordinary case worth testing too.
  control:
    ip: ${{APISIX_CONTROL_IP:=127.0.0.1}}
    port: 9090
  proxy_mode: http&stream
  stream_proxy:
    tcp:
      - 9100
    udp:
      - 9200
deployment:
  admin:
    allow_admin:
      - 0.0.0.0/0
    admin_key:
      - name: admin
        key: edd1c9f034335f136f87ad84b625c8f1
        role: admin
  etcd:
    host:
      - http://etcd:2379
    # The second gateway shares this file and this etcd; the compose file gives
    # it its own prefix (APISIX_ETCD_PREFIX=/apisix2) so the two stay apart.
    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}
    timeout: 30
```

- [ ] **Step 4: Point both compose services at it**

In `e2e/server/docker-compose.yml`:

In the `apisix` service, directly after the `restart: always` line, add:

```yaml
    environment:
      # See apisix_conf.yml: only this gateway publishes its Control API.
      APISIX_CONTROL_IP: 0.0.0.0
```

In the `apisix2` service, change the volume line and add the environment block after `restart: always`:

```yaml
    volumes:
      - ./apisix_conf.yml:/usr/local/apisix/conf/config.yaml:ro
    environment:
      # Same file as the first gateway, its own etcd prefix (see the comment on
      # `prefix` in apisix_conf.yml).
      APISIX_ETCD_PREFIX: /apisix2
```

Delete `e2e/server/apisix_conf_2.yml` (`git rm e2e/server/apisix_conf_2.yml`).

- [ ] **Step 5: Update the two spec comments**

In `e2e/tests/header.instance-health.spec.ts` line 40 and `e2e/tests/instances.admin.spec.ts` line 29, replace

```ts
// Real second APISIX from e2e/server/docker-compose.yml; key from apisix_conf_2.yml.
```

with

```ts
// Real second APISIX from e2e/server/docker-compose.yml; it shares apisix_conf.yml
// (and its admin key) with the first gateway, only the etcd prefix differs.
```

- [ ] **Step 6: Render the compose file and run the unit tests**

Run:

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
docker compose -f e2e/server/docker-compose.yml config 2>/dev/null | grep -nE 'apisix_conf|APISIX_|image: apache|build:' 
pnpm test e2e/utils/apisix-conf.test.ts
pnpm lint --no-cache
```

Expected: two `apisix_conf.yml` mounts, `APISIX_CONTROL_IP: 0.0.0.0` under `apisix`, `APISIX_ETCD_PREFIX: /apisix2` under `apisix2`, `image: apache/apisix:3.16.0-debian` under `apisix2` (the `apisix` service still shows `build:` until Task 2). Tests and lint pass.

- [ ] **Step 7: Bring up an isolated copy and prove the split**

Write the override to `/tmp/claude-1001/-home-walidboudiche-working-multi-apisix-dashboard/82be96f4-d868-4520-a196-b58393069fa2/scratchpad/e2e-check.override.yml`:

```yaml
services:
  apisix:
    ports: !override
      - '29080:9080'
      - '29180:9180'
      - '127.0.0.1:29090:9090'
  apisix2:
    ports: !override
      - '29181:9180'
  etcd:
    ports: !override
      - '22379:2379'
```

Then (the `apisix` service still builds the old image in this task; that is expected and takes a few minutes):

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker/e2e/server
C=/usr/local/bin/docker-compose
OV=/tmp/claude-1001/-home-walidboudiche-working-multi-apisix-dashboard/82be96f4-d868-4520-a196-b58393069fa2/scratchpad/e2e-check.override.yml
$C -p e2e-check -f docker-compose.yml -f "$OV" up -d --build
sleep 15
# gateway 1 up (401 = Admin API answering without a key)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29180/apisix/admin/routes
# a route on gateway 2 lands under /apisix2, not /apisix
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H 'X-API-KEY: edd1c9f034335f136f87ad84b625c8f1' http://127.0.0.1:29181/apisix/admin/routes/split-check -d '{"uri":"/split","upstream":{"type":"roundrobin","nodes":{"127.0.0.1:1":1}}}'
docker exec e2e-check-etcd-1 etcdctl get --prefix /apisix2/routes/ --keys-only
docker exec e2e-check-etcd-1 etcdctl get --prefix /apisix/routes/split-check --keys-only | wc -l
# control API: gateway 1 answers on the network, gateway 2 does not
docker exec e2e-check-apisix2-1 sh -c 'wget -qO- --timeout=3 http://apisix:9090/v1/healthcheck; echo " gw1=$?"'
docker exec e2e-check-apisix-1 sh -c 'wget -qO- --timeout=3 http://apisix2:9090/v1/healthcheck; echo " gw2=$?"'
$C -p e2e-check -f docker-compose.yml -f "$OV" down -v
docker ps -a --format '{{.Names}}' | grep -c e2e-check || echo "no e2e-check containers left"
```

Expected: `401`; `201`; the `/apisix2/routes/split-check` key listed; `0` under `/apisix`; `gw1=0` with a JSON body, `gw2=1` (connection refused); teardown leaves nothing. The APISIX images are Debian-based and ship neither `wget` nor `curl`: if the `wget` calls fail with "not found", use bash's TCP redirection instead — `docker exec e2e-check-apisix2-1 bash -c 'exec 3<>/dev/tcp/apisix/9090 && echo gw1=open'` must print `gw1=open`, and the same command from `e2e-check-apisix-1` against `apisix2` must fail with "Connection refused". Record which form you used.

- [ ] **Step 8: Commit**

```bash
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
git add e2e/server/apisix_conf.yml e2e/server/docker-compose.yml e2e/utils/apisix-conf.test.ts e2e/tests/header.instance-health.spec.ts e2e/tests/instances.admin.spec.ts
git rm -q e2e/server/apisix_conf_2.yml
git commit -m "build(common): run both e2e gateways from one APISIX config

The two configs differed by the etcd prefix and by which gateway publishes
its Control API. APISIX expands \${{VAR:=default}} in config.yaml, so the
compose file now hands the second gateway its prefix and the first its
control address, and the copy that drifted from the original goes away."
```

---

### Task 2: Drop the baked e2e image

**Files:**
- Delete: `e2e/server/Dockerfile`
- Modify: `e2e/server/docker-compose.yml` (service `apisix`, lines 19-22)
- Modify: `.github/workflows/e2e.yml:121-130`
- Modify: `CLAUDE.md:57-64` and `:212`, `README.md:100`, `docs/en/development.md` (no `:9180` UI mention remains), `src/components/BuildIdentity.tsx:23-35`, `e2e/utils/env.ts:28-48`

**Interfaces:**
- Consumes: the single-config compose from Task 1.
- Produces: an e2e compose with no `build:` key at all (the devcontainer `include:` keeps working unchanged).

- [ ] **Step 1: Stock image for the first gateway**

In `e2e/server/docker-compose.yml`, replace

```yaml
  apisix:
    build:
      context: ../..
      dockerfile: e2e/server/Dockerfile
    restart: always
```

with

```yaml
  apisix:
    image: apache/apisix:3.16.0-debian
    restart: always
```

Delete the Dockerfile: `git rm -q e2e/server/Dockerfile`.

- [ ] **Step 2: Readiness probe on the Admin API**

In `.github/workflows/e2e.yml`, replace the step named `Waiting dashboard service to be healthy` with:

```yaml
      - name: Waiting for the gateway's Admin API
        working-directory: ./e2e/server
        run: |
          # 401 is APISIX answering without a key: the gateway is up. Nothing
          # in this stack serves a UI any more; the suite targets vite.
          TIMEOUT=30
          timeout $TIMEOUT bash -c '
            until [ "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9180/apisix/admin/routes)" = "401" ]; do
              echo "Waiting for the APISIX Admin API..."
              sleep 5
            done
          ' || (echo "APISIX Admin API not ready after $TIMEOUT seconds" && exit 1)
```

Check: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml')); print('ok')"`.

- [ ] **Step 3: Remove the `:9180` bundle prose**

`CLAUDE.md`: delete the paragraph starting `**The dashboard on \`:9180\` is not the working tree.**` (through `directly.`) and the blank line after it. In the E2E section, change

```
Default target is the dev server, `http://localhost:5173/ui/`; override via `E2E_TARGET_URL` (the image bundle lives at `http://localhost:9180/ui/`).
```

to

```
Default target is the dev server, `http://localhost:5173/ui/`; override via `E2E_TARGET_URL`. The e2e stack serves no UI: `:9180` is the Admin API only.
```

`README.md` line 100: replace `— see [\`e2e/server/Dockerfile\`](./e2e/server/Dockerfile) and [\`e2e/server/docker-compose.yml\`](./e2e/server/docker-compose.yml)` with `— see [\`e2e/server/docker-compose.yml\`](./e2e/server/docker-compose.yml)`.

`docs/en/development.md`: grep for `9180`; the only mentions must describe the Admin API. If any sentence mentions a UI, a bundle or a build on 9180, delete that sentence.

`src/components/BuildIdentity.tsx`: replace the doc comment (lines 23-35) with

```ts
/**
 * Which build this page is.
 *
 * The dashboard is served two ways: the vite dev server, and the official
 * image (the root Dockerfile), which is only as fresh as the release it was
 * built from. Nothing on screen said so once: a months-old page looked exactly
 * like a current one, #221 was reported from such a page about behaviour fixed
 * long before it, and cost a full investigation (#237).
 *
 * The values come from `unplugin-info`, which shells out to git at build time -
 * which is why the Dockerfile installs git and keeps .git in the context.
 */
```

`e2e/utils/env.ts`: replace the doc comment above `export const env` (lines 27-38) with

```ts
/**
 * The dashboard under test.
 *
 * The dev server by default. An earlier stack served a stale bundle on the
 * gateway's port, and a local `pnpm e2e <spec>` defaulting to it ran against
 * months-old code while looking like the working tree - which is how #221 was
 * reported against behaviour fixed long before (#237). CI passes this
 * explicitly, and always did.
 */
```

and the `.describe(...)` string with

```ts
      `The dashboard under test; from a dev container, try http://host.docker.internal:5173${BASE_PATH}/`
```

- [ ] **Step 4: Verify**

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
git grep -n '9180/ui' -- . ':!docs/superpowers' ; echo "grep exit=$? (1 = nothing left)"
docker compose -f e2e/server/docker-compose.yml config 2>/dev/null | grep -c 'build:' ; echo "(expect 0)"
pnpm lint --no-cache && pnpm test && pnpm build
```

Then bring the isolated stack up once more (same override and commands as Task 1 Step 7, minus `--build`; it should be up in seconds now) and check the `401` probe and the etcd split, then `down -v`.

- [ ] **Step 5: Commit**

```bash
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
git add e2e/server/docker-compose.yml .github/workflows/e2e.yml CLAUDE.md README.md docs/en/development.md src/components/BuildIdentity.tsx e2e/utils/env.ts
git commit -m "build(common): stop baking the UI into the e2e APISIX image

Nothing has used the bundle served on :9180 since the suite moved to the
dev server (#272); the only reader left was the CI readiness probe. The
build cost minutes per shard and was the source of the stale-page
confusion behind #237. Both e2e gateways now run the stock image and CI
waits on the Admin API instead."
```

---

### Task 3: One APISIX config for the deploy stack

**Files:**
- Modify: `deploy/apisix/apisix_conf.yml` (the `prefix:` line and the header comment)
- Delete: `deploy/apisix/apisix_conf_2.yml`
- Modify: `deploy/docker-compose.yml` (service `apisix2`, volume + environment)
- Modify: `deploy/README.md:38` wording

**Interfaces:**
- Consumes: the `APISIX_ETCD_PREFIX` convention from Task 1 (same variable name, same default).

- [ ] **Step 1: Placeholder in the deploy config**

In `deploy/apisix/apisix_conf.yml` change the header comment `# Demo gateway 1. The admin port (9180) …` to `# Demo gateway config, shared by both gateways. The admin port (9180) …` and replace

```yaml
    prefix: /apisix
```

with

```yaml
    # Both demo gateways read this file and share the etcd; the compose file
    # gives the second one its own prefix (APISIX_ETCD_PREFIX=/apisix2).
    prefix: ${{APISIX_ETCD_PREFIX:=/apisix}}
```

Delete `deploy/apisix/apisix_conf_2.yml` (`git rm -q`).

- [ ] **Step 2: Compose**

In `deploy/docker-compose.yml`, service `apisix2`: change the volume to `./apisix/apisix_conf.yml:/usr/local/apisix/conf/config.yaml:ro` and add after `restart: unless-stopped`:

```yaml
    environment:
      APISIX_ETCD_PREFIX: /apisix2
```

- [ ] **Step 3: README**

In `deploy/README.md` line 38, `(see \`apisix/apisix_conf.yml\`)` already names the single file; make sure no sentence still says "each" config or mentions `apisix_conf_2.yml` (grep). If the README says "the demo admin key for each is", change to "the demo admin key for both is".

- [ ] **Step 4: Verify with the isolated demo stack**

Override file at `/tmp/claude-1001/-home-walidboudiche-working-multi-apisix-dashboard/82be96f4-d868-4520-a196-b58393069fa2/scratchpad/deploy-ports.override.yml`:

```yaml
services:
  dashboard:
    ports: !override
      - '18080:8080'
  apisix:
    ports: !override
      - '19080:9080'
  apisix2:
    ports: !override
      - '19081:9080'
```

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker/deploy
C=/usr/local/bin/docker-compose
OV=/tmp/claude-1001/-home-walidboudiche-working-multi-apisix-dashboard/82be96f4-d868-4520-a196-b58393069fa2/scratchpad/deploy-ports.override.yml
export JWT_SECRET=$(openssl rand -hex 32)
$C -p dashboard-demo -f docker-compose.yml -f "$OV" config | grep -nE 'apisix_conf|APISIX_ETCD_PREFIX'
$C -p dashboard-demo -f docker-compose.yml -f "$OV" up -d
for i in $(seq 1 30); do s=$(docker inspect --format '{{.State.Health.Status}}' dashboard-demo-dashboard-1 2>/dev/null); [ "$s" = healthy ] && break; sleep 3; done; echo "health=$s"
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' http://127.0.0.1:18080/api/v1/login | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
for n in apisix apisix2; do
  ID=$(curl -s -X POST http://127.0.0.1:18080/api/v1/instances -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"$n\",\"admin_api_url\":\"http://$n:9180\",\"admin_key\":\"edd1c9f034335f136f87ad84b625c8f1\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or d.get("data",{}).get("id"))')
  printf '%s routes -> ' "$n"; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/v1/apisix/admin/routes -H "Authorization: Bearer $TOKEN" -H "X-Instance-ID: $ID"
  printf ' stream_routes -> '; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/api/v1/apisix/admin/stream_routes -H "Authorization: Bearer $TOKEN" -H "X-Instance-ID: $ID"
done
docker exec dashboard-demo-etcd-1 etcdctl get --prefix /apisix2/ --keys-only | head -3
$C -p dashboard-demo -f docker-compose.yml -f "$OV" down -v
```

Expected: `config` shows two `apisix_conf.yml` mounts and one `APISIX_ETCD_PREFIX: /apisix2`; dashboard healthy; `200` ×4; keys under `/apisix2/`; clean teardown. Do not create `deploy/.env`; `JWT_SECRET` comes from the environment.

- [ ] **Step 5: Commit**

```bash
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
git add deploy/apisix/apisix_conf.yml deploy/docker-compose.yml deploy/README.md
git rm -q deploy/apisix/apisix_conf_2.yml
git commit -m "build(api): run both demo gateways from one APISIX config

The second config was a copy of the first with another etcd prefix, and a
copy is the file that drifts. APISIX expands \${{VAR:=default}} in
config.yaml, so the compose file passes the prefix instead."
```

---

### Task 4: A map of what remains

**Files:**
- Modify: `docs/en/development.md` (new section after "## Prerequisites")
- Modify: `README.md` (one link in the quick start)

- [ ] **Step 1: The map**

Insert after the prerequisites list in `docs/en/development.md`:

```markdown
## Docker in this repo

| Path | What it is | Used by |
|---|---|---|
| `Dockerfile` (+ `.dockerignore`) | The official image: Go backend + built UI, published to GHCR on `vX.Y.Z` tags by `.github/workflows/docker.yml`. | `deploy/`, anyone running the dashboard as a container |
| `deploy/` | A copyable compose that runs that image with etcd and two APISIX gateways. | People deploying or trying the dashboard |
| `e2e/server/` | The test stack: two stock APISIX gateways sharing one `apisix_conf.yml` (the second gets its etcd prefix from `APISIX_ETCD_PREFIX`) plus etcd. No image is built. | `pnpm e2e`, CI, the dev container |
| `.devcontainer/` | The VS Code dev container; it `include`s the e2e stack. | VS Code users |

Nothing in the e2e stack serves the dashboard: `:9180` and `:9181` are Admin APIs, the UI you test is the vite dev server on `:5173` (or the official image).
```

- [ ] **Step 2: README link**

In `README.md`, after the quick-start code block sentence `Open <http://localhost:5173/ui> …`, add:

```markdown
Wondering which Docker file does what? See [Docker in this repo](./docs/en/development.md#docker-in-this-repo).
```

- [ ] **Step 3: Check and commit**

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
grep -n 'docker-in-this-repo' README.md && grep -n '^## Docker in this repo' docs/en/development.md
pnpm lint --no-cache
git add docs/en/development.md README.md
git commit -m "docs(common): map the docker pieces that remain"
```

---

### Task 5: Push, PR, CI

**Files:** none.

- [ ] **Step 1: Full local verification on the final tree**

```sh
cd /home/walidboudiche/working/multi-apisix-dashboard-docker
pnpm lint --no-cache && pnpm test && pnpm build && go test -C api ./...
git status --short   # must be empty
git log --oneline origin/main..HEAD
```

- [ ] **Step 2: Push and open the PR** (controller does this through the finishing skill, with the user's go-ahead)

```sh
git push -u origin refactor/docker-cleanup
gh pr create --base main --title "build(common): fewer docker pieces" --body-file <body>
```

PR body: what was removed (e2e Dockerfile, two configs), the env-var mechanism, the CI probe change, the map; test plan: unit tests, isolated e2e and demo stacks, and the e2e workflow going green with a shorter "Run e2e server" step.

- [ ] **Step 3: Watch CI**

`gh pr checks <n>` (text output; gh 2.45 has no `--json`). All jobs green, and the e2e job's "Run e2e server" step no longer contains a build.

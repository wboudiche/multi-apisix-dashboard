# Deploy: demo stack

Runs the published dashboard image with one etcd and two APISIX gateways.
Only the dashboard and the gateways' traffic ports reach the host; the
APISIX Admin API is reachable solely from the dashboard container.

| Service | Host port | Inside the network |
|---|---|---|
| dashboard | 8080 | — |
| apisix (gateway 1) | 9080 | Admin API `http://apisix:9180` |
| apisix2 (gateway 2) | 9081 | Admin API `http://apisix2:9180` |
| etcd | — | `http://etcd:2379` |

## Start

The GHCR image only exists starting with the first `vX.Y.Z` release; until then,
or if the package is left private, `docker compose up -d --build` builds it
locally instead of pulling.

Host ports 8080, 9080 and 9081 must be free. The repo's own e2e stack
(`e2e/server/docker-compose.yml`) binds 9080 by default (plus 9180, 9181 and
2379); if it is running, start it with `E2E_GATEWAY_PORT` set elsewhere, stop
it, or remap this stack's ports first.

```sh
cp .env.example .env
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
docker compose up -d
```

Open <http://localhost:8080/ui> and log in with `admin` and the
`ADMIN_PASSWORD` from `.env` (default `admin`). Change it from the user menu.

## Register the gateways

Go to **Instances** and add both, using the internal Admin URLs above. The
demo admin key for both is `edd1c9f034335f136f87ad84b625c8f1` (see
`apisix/apisix_conf.yml`). Replace it before exposing anything.

Set each one's **Gateway URL** to its traffic port inside the network,
`http://apisix:9080` and `http://apisix2:9080`. The route tester sends its
request from the dashboard's container to that address: without it a test
answers "Instance has no gateway_url configured", and `localhost` there is
the dashboard itself. Not the Admin port 9180, which has no routes.

## Build the image from this checkout

```sh
docker compose up -d --build
```

The `build` context is the repository root, so the `Dockerfile` there is
used instead of pulling from GHCR.

The `Dockerfile` names no Go version and builds with `golang:alpine`, the
newest. Docker reuses the copy it already holds: if the build stops on
`go.mod requires go >= ...`, that copy is older than the code needs, and
`docker compose build --pull` fetches the current one.

## Reset

```sh
docker compose down -v
```

Removes the etcd volume, including every user, team and registered instance.

Keep `.env` in place until the stack is torn down, since the `JWT_SECRET`
check in the compose file runs on every compose command, including `down`.

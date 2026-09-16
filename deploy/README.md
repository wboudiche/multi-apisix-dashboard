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

Host ports 8080, 9080 and 9081 must be free (the repo's own e2e stack from
`e2e/server/docker-compose.yml` binds 9080, so stop it or remap first).

```sh
cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d
```

Open <http://localhost:8080/ui> and log in with `admin` and the
`ADMIN_PASSWORD` from `.env` (default `admin`). Change it from the user menu.

## Register the gateways

Go to **Instances** and add both, using the internal Admin URLs above. The
demo admin key for each is `edd1c9f034335f136f87ad84b625c8f1` (see
`apisix/apisix_conf.yml`). Replace it before exposing anything.

## Build the image from this checkout

```sh
docker compose up -d --build
```

The `build` context is the repository root, so the `Dockerfile` there is
used instead of pulling from GHCR.

## Reset

```sh
docker compose down -v
```

Keep `.env` in place until the stack is torn down, since the `JWT_SECRET`
check in the compose file runs on every compose command, including `down`.

Removes the etcd volume, including every user, team and registered instance.

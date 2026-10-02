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

# Official image: Go backend + built SPA in one container.
#
#   docker build -t ghcr.io/wboudiche/multi-apisix-dashboard:dev .
#   docker run -p 8080:8080 -e ETCD_ENDPOINTS=http://etcd:2379 \
#     -e JWT_SECRET="$(openssl rand -hex 32)" ghcr.io/wboudiche/multi-apisix-dashboard:dev
#
# JWT_SECRET is deliberately not defaulted: the backend refuses to start
# without a strong one.

# The golang image of the backend stage: see there.
ARG GO_TAG=alpine

# ---- 1. frontend --------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui
WORKDIR /app
# packageManager in package.json pins pnpm@10.10.0; corepack fetches it.
# unplugin-info stamps the build (sha, branch, date) into the account menu
# and shells out to git for it: without the binary `pnpm build` dies with
# "spawn git ENOENT", and without .git in the context every field is null and
# the page reports an unknown build (#237).
RUN apk add --no-cache git && corepack enable pnpm
# patches/ too: package.json points at it through pnpm.patchedDependencies, and
# without it `pnpm install --frozen-lockfile` fails before anything is built.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build

# ---- 2. backend ---------------------------------------------------------
# Both build stages run on the builder's own architecture (--platform=
# $BUILDPLATFORM) and the Go binary is cross-compiled for the target via
# GOOS/GOARCH, so a multi-arch build never emulates the pnpm/tsc/vite or Go
# toolchains under QEMU.
#
# Which golang image is not written here. The official image runs with
# GOTOOLCHAIN=local, so one older than the `go` directive in api/go.mod
# refuses to build, and a tag written here went stale each time a dependency
# raised the directive (#368). The workflows pass the minor the directive
# declares (GO_TAG=1.26-alpine): its latest patch, and the Go the tests ran
# with. A build that passes nothing - `docker build .`, the deploy compose -
# gets the newest Go there is, which builds any directive; if it is refused
# all the same, the local golang:alpine is an old one: build with --pull.
FROM --platform=$BUILDPLATFORM golang:${GO_TAG} AS api
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/api ./cmd

# ---- 3. runtime ---------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 -h /app app
WORKDIR /app
COPY --from=api /out/api /app/api
COPY --from=ui /app/dist /app/ui
ENV UI_DIR=/app/ui \
    PORT=8080 \
    HOST=0.0.0.0
EXPOSE 8080
USER app
# busybox wget is in the base image; the shell form lets $PORT expand.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["/app/api"]

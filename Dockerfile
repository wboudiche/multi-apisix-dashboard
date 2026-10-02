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
#   docker build --pull -t ghcr.io/wboudiche/multi-apisix-dashboard:dev .
#   docker run -p 8080:8080 -e ETCD_ENDPOINTS=http://etcd:2379 \
#     -e JWT_SECRET="$(openssl rand -hex 32)" ghcr.io/wboudiche/multi-apisix-dashboard:dev
#
# JWT_SECRET is deliberately not defaulted: the backend refuses to start
# without a strong one.

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
# No Go version is written here. The `go` line of api/go.mod is the least the
# code needs - and what its behaviour is held to, whatever compiles it - not
# the toolchain to use, and the official image runs with GOTOOLCHAIN=local:
# a tag written here refused to build the day a dependency raised that line,
# until the tag was moved by hand (#368). The newest Go builds any of them,
# and is the one with every fix. The workflows test with the same.
#
# Docker does not look for a newer golang:alpine than the one it already
# holds, and builds with that: with --pull it asks. A local copy older than
# the `go` line is refused in go's own words, "go.mod requires go >= ...";
# one that is merely not the latest is used without a word.
FROM --platform=$BUILDPLATFORM golang:alpine AS api
WORKDIR /src
COPY api/go.mod api/go.sum ./
RUN go mod download
COPY api/ ./
# With the Go that compiles what is published, whichever it is today: a tag
# builds this image and runs no other job, so the tests elsewhere may have
# last run under an older one. Natively, before the target is named.
RUN go vet ./... && go test ./...
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

# Data plane node supervision (decoupled APISIX) - design

**Version** 3.1 · **Date** 2026-11-25 · **Scope** backend (`api/`), frontend
(`src/`), tests, docs.

v3.1 is v3.0 "final" (2026-10-11, which settled the review of v2.1 dated
2026-10-09) checked against the code at `5e37bb62`, with these changes:

| # | Change | Why |
|---|---|---|
| 1 | **Node source** `static` or `dns`: nodes typed by hand, or found at each poll from a DNS name (a Kubernetes headless Service) | With a Deployment, pod addresses change at every rollout; a hand-kept list is wrong after each one. v3.0 wrote discovery off as "impossible in principle", which a headless Service disproves |
| 2 | **Read view for every role** through a new `GET /instances/:id/cluster`, behind the per-instance RBAC | v3.0 read it "through the existing `/instances/health`", which is super-admin only (`api/cmd/main.go:267`); the `/overview` payload is the same for everyone (#330), so putting clusters there would show every instance's cluster to every user |
| 3 | **Network guard shares the internal-address reading of `isBlockedAddr`** (`handlers/upstream.go`) with its own policy | A second, hand-written range list would reopen #308 (`169.254.169.254` written as NAT64, 6to4 or IPv4-compatible IPv6) |
| 4 | **Drift compares per-key revisions**, not one fingerprint per type; a key counts only if stable at the CP across two syncs | CP and nodes are not read at the same instant: with frequent writes, a fingerprint differs on every cycle and K=2 confirms a false drift; a node can even be ahead of the CP snapshot |
| 5 | **Routes compare `orig_modifiedIndex` when present** | The Control API gives routes both indexes; the merged `modifiedIndex` can differ from the Admin API's when a route uses a service. To confirm on a route with `service_id` |
| 6 | `control_api_url` of a node-supervised instance is **not read** (the v3.0 change table said it pointed at the CP; its §3.8 said unused) | Internal contradiction |
| 7 | **Nodes allowed on `standard` instances too**; `type` only drives the form help and a badge | Several traditional APISIX behind a load balancer on one etcd have the same need, with the same model |
| 8 | **Route test against one node open to whoever may test the route**; `all_nodes` stays super-admin | Today anyone who may write routes may test them (`main.go:228`); restricting the node target took propagation diagnosis away from developers |

## 1. Context and problem

The dashboard manages "instances": one Admin API and its key. In decoupled
mode only the control plane (CP) exposes an Admin API: the operator registers
the CP as the instance and manages configuration through it. The data planes
(DP):

- have **no Admin API**, so they cannot be registered as instances (the
  connection test expects an Admin API answer, `services/instance.go:400`);
- **register nowhere** (neither in etcd nor through the Admin API);
- expose a read **Control API** (port 9090, `enable_control: true`):
  `/v1/healthcheck`, `/v1/routes`, `/v1/services`, `/v1/upstreams`,
  `/v1/schema`.

**Consequence**: a dead, stale or degraded DP is invisible. The CP answers
"Connected" while traffic fails on part of the cluster.

**Goal**: let the operator give the DP of a cluster as supervised nodes of the
instance - declared by hand, or found through DNS - with strictly read-only
supervision, and (phase 4) diagnose a failed propagation by testing a route
node by node.

## 2. Goals and non-goals

### Goals

1. A `Node` model attached to an `Instance`, stored in etcd (static source), or
   computed at each poll (DNS source).
2. Manual CRUD with a connection test on save; or one DNS name per instance.
3. Read-only polling: Control API reachability, optional traffic probe,
   **configuration sync against the CP (Admin API)**, backend health, plugin
   fingerprint.
4. Explicit node states (`unknown`, `healthy`, `degraded`, `unreachable`,
   `disabled`) and a **separate cluster state** (`cluster_health`).
5. Nodes tab (super admin), read view for every role on the instance, three
   colour header dot.
6. Disable tracking: date stored, **server-computed reminder** when a node
   stays disabled too long.
7. Writes on nodes by `super_admin` only.
8. Phase 4: test a route on one node or on all nodes.

### Non-goals

- Discovery through the Kubernetes API, Docker, etcd or a service registry.
  DNS is the only discovery: it covers Kubernetes without a ServiceAccount or
  cluster rights.
- Any write to a Control API (`PUT /v1/plugins/reload`, `POST /v1/gc`, ...):
  it is unauthenticated, and the backend must never relay writes to it.
- Managing configuration on a DP (it belongs to the CP).
- History, long-term metrics, external alerting.
- Drift for resources the Control API does not list (consumers, SSL, global
  rules, plugin configs): v1 limit, documented.
- `config_provider: yaml` (standalone) data planes: etcd provider only.

## 3. Semantics

This section is the source of truth for backend, UI and documentation.

### 3.1 Node source

Each instance has a `node_source`:

| Value | Meaning |
|---|---|
| `none` (default, also for records without the field) | no node; today's behaviour |
| `static` | nodes declared one by one (§4) |
| `dns` | nodes resolved at each poll from `node_dns` |

DNS fields on the instance:

| Field | Rule |
|---|---|
| `node_dns` | `host:port`, e.g. `apisix-dp-control.apisix.svc.cluster.local:9090`. Required with `dns` |
| `node_dns_scheme` | `http` (default) or `https` |
| `node_dns_gateway_port` | optional, e.g. `9080`: enables the traffic channel at `http://<ip>:<port>` |

With `dns`, at each poll (`NODE_POLL_INTERVAL`) the backend resolves A and
AAAA records; each address is a node for that poll, with Control API
`<scheme>://<ip>:<port>`. Such nodes:

- are not stored; their `id` is the address, their `name` the PTR name when
  one resolves, the address otherwise;
- have no `enabled`, `disabled_at` or reminder: a pod that goes away leaves the
  list, it is not an unreachable node;
- keep their sync counters (§3.6) by address across polls, and lose them when
  the address leaves the list.

A resolution that fails gives `cluster_health = critical` with
`cluster_reason = dns_failed`; one that returns no address,
`dns_empty`. The previous list is not reused.

`static` and `dns` exclude each other. Switching from `static` drops the stored
nodes after a confirmation in the form (the API takes `drop_static_nodes:
true`, 409 `instance_has_nodes` without it).

### 3.2 Instance type: `standard` or `decoupled` (declared)

The dashboard cannot detect the architecture (the Admin API is the same in
both). The operator declares it:

- **`type`** on the instance: `standard` (default; also for records without
  the field) or `decoupled`.
- **Form**: "Deployment type: Standard / Decoupled". With `decoupled`, the help
  says `admin_api_url` must be the **control plane**, and the node source
  section is opened by default.
- **Instance list**: only the CP appears, with a "decoupled" badge. DP never
  appear as instances.
- The type changes nothing else: nodes may be given on both types (several
  traditional APISIX behind a load balancer on one etcd have the same need),
  and proxy and ownership are unchanged.

### 3.3 Existing instance fields

| Field | No node source | With a node source |
|---|---|---|
| `admin_api_url` | the gateway's Admin API | the CP's Admin API |
| `control_api_url` | upstream health (#281) | **not read**: health is aggregated from the nodes (§3.7). Kept, so that going back to `none` restores it; the form says so |
| `gateway_url` | route test target | the load balancer in front of the DP, or one DP; never the CP, which serves no traffic. Default route test target ("Instance gateway") |

### 3.4 Enabled or disabled (static nodes)

A static node with `enabled=false`:

- is **not polled** and its cached status is dropped;
- is **not counted** in `nodes_active_count` nor in any aggregate;
- is **left out** of sync comparison, plugin fingerprint and test targets
  (single or `all_nodes`): it must be enabled to be targeted;
- stays listed (greyed, state `disabled`), editable and deletable.

**Disable tracking**:

- `enabled: true -> false` sets `disabled_at`; back to `true` clears it.
- `node_disabled_count` is emitted whenever above 0, also when every node is
  disabled (`nodes_active_count = 0`). The instance shows them apart, e.g.
  "Connected - 3/4 nodes - 1 disabled". A healthy cluster with disabled nodes
  stays green: disabling is a declared act, not a failure.
- Past `NODE_DISABLED_REMINDER_DAYS` (default 7) the server returns
  `disabled_reminder: true` for that node. The UI shows an icon and "disabled
  for X days". Informative only: it changes neither the node state nor the
  cluster's, and sends nothing outside.

Use case: planned maintenance without turning the instance orange, while a node
forgotten in maintenance still stands out. When every node is disabled,
`cluster_health = absent` and the UI says "0 active nodes".

### 3.5 Node states

Each node has a **control channel** (Control API, always) and, when a traffic
address is set (`gateway_url`, or `node_dns_gateway_port`), a **traffic
channel**.

| State | Condition |
|---|---|
| `unknown` | no cycle finished since start, creation or an address change; or the last check is older than 3 x the interval |
| `healthy` | every configured channel answers |
| `degraded` | exactly one of two configured channels fails; reason `control_api_down`, `gateway_down` or `gateway_tls_error` |
| `unreachable` | every configured channel fails |
| `disabled` | `enabled=false` (static only) |

Backend health and plugin fingerprint do **not** change the node state: a
failing upstream is usually an application problem, not a DP one.

**What "reachable" means**:

- `control_api.reachable`: the Control API answers 2xx. It does **not** prove
  the DP serves traffic.
- `gateway.state = up`: the traffic address gives any HTTP response (an APISIX
  404 for an unknown path included). It proves the listener runs, not that
  routes work. Connection failure, timeout: `down`. Failed TLS handshake:
  `tls_error` (APISIX picks the certificate from the SNI, so an HTTPS address
  with no matching SSL fails there while the listener is fine; the form
  recommends the HTTP port).
- Only a per-node route test (phase 4) proves a given route is served.

These definitions are reused word for word in the UI tooltips and the docs.

### 3.6 Cluster state

`cluster_health`, separate from `InstanceHealth.Status`, computed on active
nodes (enabled static nodes, or resolved DNS nodes):

| `cluster_health` | Condition |
|---|---|
| `absent` | no node source, or no active static node |
| `unknown` | every active node is `unknown` |
| `critical` | no active node has its traffic channel `up`; a node with no traffic address counts by its state (`healthy` counts). Also `dns_failed` / `dns_empty` |
| `degraded` | at least one node `degraded` or `unreachable`, or at least one confirmed `drift` |
| `healthy` | otherwise |

`cluster_reason` carries the code for `critical` and `degraded`
(`no_traffic`, `dns_failed`, `dns_empty`, `node_down`, `drift`).

Displayed status - `Status` keeps its enum `Connected | Disconnected | Unknown`
and its codes (#340) unchanged:

| Situation | `Status` | `cluster_health` | Colour |
|---|---|---|---|
| no node source | as today | `absent` | as today |
| CP unreachable | `Disconnected` | computed anyway (nodes are still polled) | red |
| CP fine, cluster unknown | `Connected` | `unknown` | green + "checking" |
| CP fine, cluster healthy | `Connected` | `healthy` | green |
| CP fine, cluster degraded | `Connected` | `degraded` | **orange** |
| CP fine, cluster critical | `Connected` | `critical` | **red**, label distinct from Disconnected |

Colour never carries the information alone: each state has an icon and a text.
In the header and the overview, `Status` is labelled "Admin API" when the
instance has a node source.

### 3.7 Configuration sync - the CP is the reference

The backend does not read the cluster's etcd (security boundary kept). It
compares each node to the CP's Admin API.

Every DP and the Admin API read the same etcd, so a key's `modifiedIndex` is
the same everywhere (confirmed by the spike of 2026-10-09). The CP reference
catches a lag common to every node and works with a single node.

**What is kept**: per node and per type (`routes`, `services`, `upstreams`),
the map `id -> revision`; per type for the CP, the same map from the current
and the previous sync. Bodies are never kept. A map of 10 000 entries is a few
hundred KiB; it is bounded by `NODE_MAX_BODY_BYTES` on the response it comes
from.

**Revision**: `modifiedIndex`; for routes, `orig_modifiedIndex` when the
Control API gives it, since the merged `modifiedIndex` of a route that uses a
service may differ from the Admin API's. Phase 1 starts with a test on a route
with `service_id`, `upstream_id` and `plugin_config_id`, against a real CP and
DP.

**Comparison**, per type, at each sync (CP read first, then the nodes):

- a key **settled** at the CP: present with the same revision in the current
  and the previous CP read, or absent from both;
- a key differs on a node when the node lacks it, holds it with another
  revision, or holds a key the CP lacks;
- a key the node holds with a revision **above** the CP's current one is
  ignored (the node read after a write the CP read missed).

| `config.state[type]` | Condition |
|---|---|
| `unknown` | no successful sync for this type yet |
| `in_sync` | no differing key |
| `drift_pending` | differing keys, none of them settled, or settled ones differing for fewer than `NODE_DRIFT_CONFIRMATIONS` syncs |
| `drift` | at least one settled key differing for `NODE_DRIFT_CONFIRMATIONS` (default 2) consecutive syncs |
| `too_large` | the node's or the CP's listing exceeded `NODE_MAX_BODY_BYTES` |
| `na` | the node's fetch failed (unreachable, timeout) |

A pipeline writing continuously therefore shows at most `drift_pending` on the
keys it touches, never a false `drift`.

**Rollup** for the single state shown per node, worst first:

```
drift > drift_pending > too_large > unknown > na > in_sync
```

Example: `routes: in_sync`, `services: drift`, `upstreams: in_sync` -> `drift`.
The drawer shows the three types and the ids that differ (at most 20 per type).

**Fallback without CP**: when the CP read fails, nodes are compared to each
other: the reference is the largest group holding the same map. On a tie each
node gets a `behind` / `ahead` hint from its highest revision, shown as a
heuristic.

Only a confirmed `drift` degrades the cluster; `drift_pending` is visible in
the drawer only. A node's counters reset when a sync finds it in sync, or when
the node is edited.

**Parsing constraints from the spike**:

- empty listings are `{}`, not `[]` (`/v1/routes`, `/v1/services`,
  `/v1/upstreams`, `/v1/healthcheck`), and a checker with no traffic yet has
  `"nodes": {}`: the parser takes both forms at every level;
- JSON key order differs between nodes: never hash a raw body;
- CP -> DP propagation measured under 200 ms.

**Documented limits**: the indicator signals a divergence, not its cause; only
routes, services and upstreams are covered; etcd provider only.

### 3.8 Backend health and plugins

**Backends** - when the instance has a node source, the `__dashboard_health`
annotation of upstreams (#281, `upstream_health.go`) is built from every active
node's `/v1/healthcheck` (from the poller's cache) instead of
`control_api_url`. Three states, as in #281:

- `measured`: a checker with registered targets on at least one node; per
  target, the worst status any node reports, and the number of nodes that
  measured it (`2/3 nodes`);
- `not_measured`: a checker configured, no node has registered targets yet
  (`"nodes": {}` - a checker is created on a DP the first time that upstream
  serves a request there): "-" with "no traffic yet";
- `not_configured`: no checker: "-" with "no health check configured".

Never `0/0`. A node whose control channel is down is left out and named in the
tooltip.

**Plugins** - fingerprint of `/v1/schema`, canonicalised (sorted keys) before
hashing. State `same`, `different` (with groups), `na` (one node) or `unknown`.
A difference is an **informative warning** (normal during a rolling upgrade)
and does not change `cluster_health`.

## 4. Data model

### Instance (existing record, new fields)

| Field | Type | Rule |
|---|---|---|
| `type` | string | `standard` (default) or `decoupled`. Declared, never detected |
| `node_source` | string | `none` (default), `static`, `dns` (§3.1) |
| `node_dns`, `node_dns_scheme`, `node_dns_gateway_port` | string, string, int | with `dns` only |

### Node (static), `/apisix-dashboard/nodes/<instanceID>/<nodeID>`

| Field | Type | Rule |
|---|---|---|
| `id` | string | UUID from the backend |
| `instance_id` | string | parent instance |
| `name` | string | required, **unique per instance** (409 `duplicate_node_name`) |
| `description` | string | optional |
| `control_api_url` | string | required, http/https, **unique per instance after normalisation** (409 `duplicate_node_url`) |
| `gateway_url` | string | optional, http/https; enables the traffic channel and the phase 4 test |
| `enabled` | bool | default `true` (§3.4) |
| `disabled_at` | timestamp or null | set on `true -> false`, cleared on `false -> true`; not writable through the API |
| `created_at`, `updated_at` | timestamp | |

Constraints:

- At most `NODE_MAX_PER_INSTANCE` nodes (default 50, from `internal/config`),
  409 `node_limit_reached` with the current limit. Applies to DNS too: past it,
  the first N addresses in sorted order are polled and the cluster says how
  many were left out.
- No credentials in addresses (`user:pass@` refused), no query, no fragment;
  the path is kept as a prefix.
- Uniqueness and `disabled_at` are written in one etcd transaction (compare on
  the revision of the instance's node prefix), tested under concurrency.
- Deleting an instance deletes `/nodes/<instanceID>/*` and drops its cache.

### Status (in memory, not stored)

Same pattern as `upstreamHealthCache` / `instance_cache.go`. Per node:

- `state`, `degraded_reason`, `last_check_at`, `last_error` (restricted, §5.3);
- `control_api`: `reachable`, `latency_ms`;
- `gateway`: `state` (`up`, `down`, `tls_error`, `not_configured`, `unknown`),
  `http_status`, `latency_ms`;
- `config`: `routes_state`, `services_state`, `upstreams_state`, rollup
  `state`, differing ids per type, highest revision per type, `behind`/`ahead`;
- `health`: `backends_state`, `backends_healthy`, `backends_total`;
- `plugins`: `state`, `schema_fingerprint`;
- `disabled_reminder` (static).

Each backend replica keeps its own cache: acceptable in v1; two replicas may
briefly show different states.

### No "cluster" object

A cluster is an existing instance (the CP) and its nodes. Ownership and the
instance switcher are unchanged.

## 5. Backend (`api/`)

### 5.1 Files

- `internal/models/models.go`: `Node`, instance fields, `ClusterHealth`
- `internal/services/node.go`: CRUD, etcd, uniqueness, `disabled_at`, limit
- `internal/services/node_source.go`: static list or DNS resolution
- `internal/services/node_poll.go`: poller, cache, states, CP reference,
  `cluster_health`
- `internal/netguard/`: the internal-address reading moved out of
  `handlers/upstream.go`, with two policies (§5.4)
- `internal/handlers/node.go`, `internal/handlers/cluster.go`: HTTP

### 5.2 Endpoints (under `/api/v1`, JWT)

| Endpoint | Who | What |
|---|---|---|
| `GET /instances/:id/nodes` | super_admin | nodes with addresses and full status |
| `POST /instances/:id/nodes` | super_admin | create (static), with connection test |
| `GET /instances/:id/nodes/:nodeId` | super_admin | detail and status |
| `PUT /instances/:id/nodes/:nodeId` | super_admin | update; re-test and status reset when an address changes; `disabled_at` when `enabled` changes |
| `DELETE /instances/:id/nodes/:nodeId` | super_admin | delete, cache dropped |
| `POST /instances/:id/nodes/:nodeId/test` | super_admin | manual connection test |
| `POST /instances/:id/nodes/resolve` | super_admin | resolve a `node_dns` before saving it, return the addresses and a test of each |
| `GET /instances/:id/cluster` | any role on the instance (`rbac` middleware, as `/instances/:id/idps`) | `cluster_health`, `cluster_reason`, counters, and per node: name, state, reason, config rollup and per-type states, backends, plugins, `last_check_at`, `disabled_at`, `disabled_reminder`. No address, no `last_error` |

The node source and DNS fields are written through the existing
`PUT /instances/:id` (super admin). Every `nodeId` is checked against `:id`: a
node of another instance is a 404.

`GET /instances/health` (super admin) gains the same counters and
`cluster_health` per instance, for the instance list. Both read the poller's
cache: **no probe runs inside a request**, so the overview's 30 s refresh costs
nothing more.

### 5.3 Permissions and visibility

| Action | Role |
|---|---|
| Write nodes, the node source, DNS fields; read addresses and `last_error` | `super_admin` |
| Read cluster and node states of an instance | any role on that instance |
| Route test on one node (phase 4) | whoever may test that route today (`mayWriteRoutes`, `main.go:228`) |
| Route test on `all_nodes` | `super_admin` |

Addresses and `last_error` reveal the internal network, like the Admin API
address that probe errors no longer show to others (#309).

### 5.4 Network safety (not negotiable)

The Control API is **unauthenticated and not read-only**. Every outbound
request to a node goes through one client:

1. The address comes **only from the stored record** (or the stored DNS name),
   never from a parameter, header or body.
2. `http`/`https` only; host parsed; **fixed paths rebuilt** (`/v1/healthcheck`,
   `/v1/routes`, `/v1/services`, `/v1/upstreams`, `/v1/schema`); query and
   fragment dropped; credentials refused.
3. **GET only** to a Control API. No code path can send another method.
4. **Redirects not followed**; environment proxy variables ignored.
5. **Checked dialer**: the IP actually connected is checked in
   `net.Dialer.Control`, which defeats DNS rebinding. The check reuses the
   reading of `isBlockedAddr` (embedded IPv4 in NAT64, 6to4, IPv4-compatible,
   ISATAP forms, #308), moved to `internal/netguard`, with a **node policy**:
   - refused: link-local `169.254.0.0/16` and `fe80::/10` (cloud metadata),
     `fd00:ec2::254`, unspecified, multicast, broadcast, and those ranges
     hidden in an IPv6 address;
   - refused unless `NODE_ALLOW_LOOPBACK=true`: loopback (needed in e2e and
     local dev, where the Control API is on `127.0.0.1`);
   - allowed: RFC 1918 and `fc00::/7` (where DP live);
   - extra ranges from `NODE_BLOCKED_CIDRS`.

   The upstream "Test connection" keeps its own, stricter policy (private
   ranges refused) on the same code.
6. Dedicated short timeout (`NODE_POLL_TIMEOUT`, 3 s); bounded responses (§5.5).
7. The same client is used for traffic addresses (probe and phase 4).
8. HTTPS verified against the system CAs; no `skip verify` in v1. Handshake
   failure is `tls_error` with an explicit `last_error`.

The same checks run on write (400 with the reason) **and** at each connection.

### 5.5 Poller

- One goroutine per backend process; only instances with a node source.
  Immediate start with jitter; states stay `unknown` until the first cycle. A
  node created or whose address changed gets an immediate cycle.
- **Three rates**: reachability, traffic and health (`NODE_POLL_INTERVAL`,
  30 s; DNS is resolved at this rate), configuration sync
  (`NODE_SYNC_INTERVAL`, 60 s), plugin fingerprint (`NODE_SCHEMA_INTERVAL`,
  5 min).
- **Its own concurrency bound** (`NODE_POLL_CONCURRENCY`, 10). It takes **no
  slot from `probe.Acquire`**: node probes and the tests users start (#330)
  do not wait on each other.
- **Traffic probe**: `GET /` on the traffic address, 3 s; any HTTP response is
  `up`.
- **Response limit**: read through `LimitReader` at `NODE_MAX_BODY_BYTES` + 1
  (8 MiB). Past it the type is `too_large`, never a parse error on truncated
  JSON.
- **Streaming decode**: `json.Decoder` keeping only `id`, `modifiedIndex` and
  `orig_modifiedIndex` of each entry.
- **CP reference**: `GET /apisix/admin/{routes,services,upstreams}` with the
  instance's admin key, read **once per sync for all of the instance's nodes**.
  Past the limit, the type is `too_large` for every node (#288 is what an
  unbounded read costs).
- **Per-worker stability**: each APISIX worker syncs etcd on its own and a
  request lands on any of them. The two-sync rule absorbs it; the spike found
  two workers stable, so no sampling in v1 (kept as an option: three requests,
  majority).
- A failing node never fails the list; `last_error` is set. Nodes are polled
  when the CP is unreachable.
- Several replicas each poll every node: load on the DP multiplied by the
  number of replicas. Accepted in v1, documented.

### 5.6 Impact on existing code

- `InstanceHealth` (from `/instances/health`) gains `cluster_health`,
  `cluster_reason`, `nodes_active_count`, `nodes_healthy`, `nodes_degraded`,
  `nodes_unreachable`, `nodes_unknown` (emitted whenever the instance has a
  node source, even at 0), and `node_disabled_count` (whenever above 0).
- `Status` unchanged: no new value, so `healthReason` (#340) and the existing
  filters keep working.
- Upstream health (#281) reads the nodes when there is a node source (§3.8).
- Route test (`route_test_handler.go`) gains `target` (§7).
- `isBlockedAddr` moves to `internal/netguard`, behaviour unchanged for
  upstreams (its tests move with it).
- `internal/config`: the variables of §9.

## 6. Frontend (`src/`)

Files: `src/apis/nodes.ts`, `src/apis/cluster.ts`, a Nodes tab in the instance
drawer, `src/routes/nodes/index.tsx`, `src/components/NodeStatusBadge.tsx`.

1. **Instance form**: "Deployment type: Standard / Decoupled"; a **Nodes**
   section: source None / Static / DNS. With DNS: name, scheme, gateway port, a
   "Resolve" button that shows the addresses found and their test, and the
   warning "Use a headless Service: a ClusterIP Service sends each request to
   any pod". Going back to None or switching away from Static asks for
   confirmation.
2. **Instance list** (super admin): "decoupled" badge; connectivity column
   "Connected - 3/4 nodes", text from `cluster_health` ("Degraded - 2/3
   healthy", "Critical - 0/3"); "- 1 disabled" apart, a warning when
   `disabled_reminder`.
3. **Header dot**: `Status` dot as today, labelled "Admin API" when there is a
   node source; a second dot from `cluster_health` (green, orange, red, each
   with icon and text). The header reads `/instances/health` for the super
   admin and `/instances/:id/cluster` for the current instance otherwise.
4. **Nodes tab** (instance drawer, super admin): table Name, Control API,
   Gateway, State, Config, Backends, Plugins, Actions. With DNS, the table is
   read-only and lists the addresses of the last resolution.
   - State: healthy, degraded (reason), unreachable, unknown, disabled.
   - Config: the rollup; the drawer shows the three types and differing ids.
   - Backends: `4/4`, or "-" with the `not_measured` / `not_configured`
     tooltip.
   - Disabled node: greyed, "disabled on <date>", and "disabled for X days"
     when `disabled_reminder` (icon and text).
5. **Add / edit node**: name, description, Control API address (required),
   gateway address (optional), enabled. Connection test on save, a warning on
   failure as for instances.
6. **`/nodes` page** (every role, current instance, from
   `/instances/:id/cluster`): cluster line (state, `x/y healthy`, disabled
   count and reminder), one row per node with the states above and no address;
   "No nodes" otherwise, with a link to the instance drawer for the super
   admin. In the navigation of every role; `usePermission` lists it with the
   resources every role reaches.
7. **Overview**: for the super admin, instances with a node source show the
   nodes grouped under the CP (expandable row). For other roles, a "Cluster"
   card for the current instance, from `/instances/:id/cluster`. Nodes are
   never shown as instances.
8. **Tooltips**: "reachable" (§3.5) and the limits of `in_sync` (§3.7).
9. **Route test drawer**: §7.

### i18n

Keys in `en`, `de`, `es`, `tr`, `zh` in the same change
(`locale-keys.test.ts`). No literal (`i18next/no-literal-string`,
`local/no-prose-literal`). Keys written out at the call site, or a table of
literal keys with the `local/readable-key` disable comment. "Disabled for X
days" uses i18n plurals.

## 7. Route test against nodes (phase 4)

**Purpose**: diagnose a failed propagation. A route can answer 200 on two
nodes and 404 on a third.

**Contract**: the existing `POST /api/v1/test-route` takes an optional
`target`:

- no `target`: behaviour and response **unchanged**;
- `target.type = instance`: `gateway_url`;
- `target.type = node` with `node_id`: one node's traffic address;
- `target.type = all_nodes`: every active node with a traffic address.

With `target`, the response is **always** `{ results: [...] }`, one entry per
target: `target`, `node_id`, `node_name`, `status`, `latency_ms`, `headers`,
`body` (bounded, marked truncated), `error`, `skipped_reason`. A node in
timeout gives an entry with `error` and does not fail the others.

**Rules**:

1. `node_id` must belong to the route's instance: otherwise 404
   `node_not_found` (with DNS: an address not in the last resolution). A
   disabled node: 409 `node_disabled`. No traffic address: 422
   `node_has_no_gateway`.
2. `instance` and `node`: whoever may test the route today. `all_nodes`:
   `super_admin`.
3. `all_nodes` takes `GET`, `HEAD` and `OPTIONS` only: otherwise 400
   `unsafe_method_for_all_nodes` (a POST would run N times).
4. The base address comes from the stored record and goes through the node
   client (§5.4); the request itself (Host, headers, body) is built as today
   in `route_test_handler.go`.
5. Bounded parallel fan-out, timeout per node, bounded body. Nodes without a
   traffic address: `skipped_reason: no_gateway_url`.

**UI**: the target selector appears when the instance has active nodes with a
traffic address: Instance gateway (default), One node, All nodes (super admin,
safe methods). A "divergence" banner when statuses differ. From a node in
`drift`, "Test propagation" opens the drawer on that route with `all_nodes`.
When a test right after a save answers 404 and a node's `routes` state is not
`in_sync`, the result says the change may not have reached it yet.

## 8. Kubernetes deployment

One CP pod and N DP pods in a Deployment, scaled by hand or by an HPA:

| Dashboard field | Value |
|---|---|
| `type` | `decoupled` |
| `admin_api_url` | the CP's Service, `http://apisix-cp.<ns>.svc:9180` |
| `gateway_url` | the DP's Service, Ingress or LoadBalancer |
| `node_source` | `dns` |
| `node_dns` | `apisix-dp-control.<ns>.svc.cluster.local:9090` |
| `node_dns_gateway_port` | `9080` (optional) |

What the cluster needs:

- in the DP's configuration: `apisix.enable_control: true` and
  `apisix.control.ip: 0.0.0.0` (the Control API listens on loopback by
  default);
- a headless Service (`clusterIP: None`) selecting the DP pods, port 9090,
  with `publishNotReadyAddresses: true` so a pod that is not ready is shown as
  such rather than missing;
- a NetworkPolicy letting only the dashboard's pod reach port 9090: the
  Control API has no authentication and accepts writes;
- the dashboard running in the cluster, or wherever pod addresses route.

A ClusterIP Service on 9090 does not work: it sends each request to any pod,
and the dashboard would read a different DP each time while believing it read
one.

Kubernetes already restarts a dead pod and keeps it out of the Service while it
is not ready. On Kubernetes the value of this design is what Kubernetes does
not see: each pod's configuration against the CP, the upstream health each pod
measures, and a route test against one pod.

## 9. Configuration

| Variable | Default | Role |
|---|---|---|
| `NODE_POLL_INTERVAL` | `30s` | reachability, traffic, health, DNS resolution |
| `NODE_SYNC_INTERVAL` | `60s` | configuration sync |
| `NODE_SCHEMA_INTERVAL` | `5m` | plugin fingerprint |
| `NODE_POLL_TIMEOUT` | `3s` | per request |
| `NODE_POLL_CONCURRENCY` | `10` | nodes polled in parallel |
| `NODE_MAX_BODY_BYTES` | `8MiB` | response limit |
| `NODE_DRIFT_CONFIRMATIONS` | `2` | syncs before `drift` |
| `NODE_MAX_PER_INSTANCE` | `50` | nodes per instance, static or DNS |
| `NODE_DISABLED_REMINDER_DAYS` | `7` | reminder threshold |
| `NODE_ALLOW_LOOPBACK` | `false` | allow `127.0.0.0/8` and `::1` (e2e, local dev) |
| `NODE_BLOCKED_CIDRS` | empty | ranges refused on top of the node policy |

Read by `internal/config` (env-driven, `.env` on the `deploy/` side), checked
at start (positive values, parsable durations).

**Docs** (`CLAUDE.md`, `deploy/README.md`): `enable_control` and
`control.ip`; Control API on an internal network only, never public; what
"reachable" means; the limits of `in_sync` (etcd provider only); maintenance
(disabling a node, the reminder); the Kubernetes recipe of §8; the model, the
keyspace, the endpoints and the variables; `NODE_ALLOW_LOOPBACK=true` for e2e
and local dev.

## 10. Tests

| Layer | Tests |
|---|---|
| Go | CRUD; `type` and `node_source` defaults for old records; switching source (409 without `drop_static_nodes`); address validation; uniqueness under concurrency; `NODE_MAX_PER_INSTANCE` (static, and DNS truncation); `disabled_at` in the transaction; cascade delete; **DNS**: resolution to N nodes, an address leaving, `dns_failed`, `dns_empty`; **guard**: `169.254.169.254` refused, the same in NAT64 / 6to4 / IPv4-compatible form, a name resolving to a refused address (rebinding), loopback only with the flag, RFC 1918 allowed, redirect not followed, credentials refused, no non-GET method to a Control API; upstream test behaviour unchanged after the move; **poller**: `unknown` before the first cycle, CP reference in sync, `drift_pending` then `drift`, a key written between syncs never `drift`, a node ahead of the CP ignored, `orig_modifiedIndex` on a route with `service_id`, fallback between nodes without CP, `too_large`, `{}` listings, disabled node not polled; rollup per type; plugin fingerprint independent of key order; `cluster_health` table-driven (`critical` on traffic); **RBAC**: node endpoints super admin only, `/cluster` for a viewer without addresses, 403 without a role on the instance; **phase 4**: node of another instance 404, disabled 409, no gateway 422, POST on `all_nodes` 400, `all_nodes` by a developer 403, partial failure, response shape |
| Vitest | API clients, badges and states, cluster column ("1 disabled"), `disabled_reminder` from the server, colour with icon, rollup display, no address rendered from `/cluster` |
| Playwright | `nodes.spec.ts`: add, edit, delete, disable (greyed row, date), cluster dot, disabled counter, viewer sees `/nodes` and the overview card but no Nodes tab, DNS source on the e2e stack, route test target selector (phase 4). POM `e2e/pom/nodes.ts`, cells through `uiCell` |

**E2E stack**: a decoupled variant of `e2e/server/docker-compose.yml` (one CP,
two DP, Control API on loopback, `NODE_ALLOW_LOOPBACK=true`). Healthy and
unreachable on the real nodes (stop one DP); the DNS source through a compose
network alias shared by the two DP; drift and `too_large` against a small
mocked Control API. Targeted runs only: a full parallel run saturates the
machine.

## 11. Phases

| Phase | Content | Effort |
|---|---|---|
| 0 - Spike | Done (2026-10-09): healthcheck shape, `modifiedIndex` stable across workers and equal between Admin API and Control API, `{}` empty listings, key order, propagation < 200 ms | done |
| 1 - Backend CRUD | Revision check on routes with `service_id`; model, node source (static, DNS), service, handlers, `internal/netguard`, RBAC, connection test, uniqueness, limit, cascade, Go tests | ~4-5 d |
| 2 - Poller and status | `node_poll.go`, cache, states, per-key sync against the CP, `cluster_health`, upstream health from nodes, `disabled_reminder`, `/instances/:id/cluster`, `InstanceHealth`, tests | ~5-6 d |
| 3 - Frontend | API clients, form (type, source), Nodes tab, badges, header dot, `/nodes`, overview, disabled counter and reminder, drawer, i18n in 5 languages, Vitest, e2e and decoupled stack | ~5-6 d |
| 4 - Route test per node | `target`, fan-out, drawer, propagation hint, tests | ~3-4 d |

Total phases 1-3: ~14-17 days; phase 4: +3-4 days. Each phase ships on its own.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Control API not exposed by the operator | Connection test, docs, clear `unreachable` |
| The backend as a relay or SSRF vector | Stored address only, fixed paths, GET only, checked dialer sharing #308's reading, redirects cut, dedicated tests |
| False drift (propagation, workers, continuous writes) | Per-key comparison on keys settled at the CP, two-sync confirmation, node-ahead keys ignored |
| False negative (every node behind) | CP reference |
| Large listings | Separate rates, limit with `too_large`, bounded concurrency, streaming decode, CP read once per sync |
| "Reachable" read as "serves traffic" | §3.5 definitions, tooltips, traffic probe, per-node route test |
| Permanent orange from plugin differences | Plugins informative only |
| Node forgotten in maintenance | `disabled_at` and server reminder |
| Stale registry with autoscaling | DNS source |
| ClusterIP Service given as `node_dns` | Form warning, "Resolve" shows a single address, docs |
| Loopback refused in dev / e2e | `NODE_ALLOW_LOOPBACK=true`, documented |
| Load x N with several replicas | Documented, accepted in v1 |

## 13. Acceptance criteria

1. A super admin registers a CP as **Decoupled**, picks the **Static** source
   and adds 3 nodes from the Nodes tab. Only the super admin sees the tab.
2. The instance list shows only the CP, with its badge; DP never appear as
   instances; an existing instance with neither field behaves as today.
3. A viewer of the instance sees `/nodes` and the overview card with states and
   no address; a user with no role on the instance gets 403 from `/cluster`.
4. Before the first cycle nodes are `unknown` and `cluster_health = unknown`.
5. A stopped DP is `unreachable` within one cycle without breaking the list;
   the cluster is `degraded`, then `critical` when **no node has its traffic
   channel up**.
6. Traffic port closed with a live Control API: `degraded`, `gateway_down`;
   failed TLS handshake: `tls_error`.
7. A disabled node is not polled, not counted, does not lower
   `cluster_health`; its date is stored and shown; the instance shows "1
   disabled node"; past the threshold, `disabled_reminder` is true.
8. **DNS source**: with the two DP behind one name, scaling to one or three
   changes the node list at the next poll, with no edit in the dashboard; a name
   that does not resolve makes the cluster `critical` (`dns_failed`).
9. **CP reference**: a DP held on a stale configuration goes `drift_pending`
   then `drift`; a configuration written every few seconds during 5 minutes
   never shows `drift`; with the CP unreachable, nodes are compared to each
   other.
10. Per-type states roll up (`routes: drift` -> node `drift`); the drawer
    shows the three types and the differing ids.
11. A listing past the limit gives `too_large`, never a parse error.
12. Node `N+1` past `NODE_MAX_PER_INSTANCE` is refused with 409
    `node_limit_reached`; the limit is set by configuration.
13. No non-GET request reaches a Control API; `169.254.169.254`, its IPv6
    disguises and DNS rebinding are refused; loopback only with
    `NODE_ALLOW_LOOPBACK=true`; the upstream test connection refuses what it
    refused before.
14. Upstream health with nodes shows per-target status and the number of nodes
    that measured it; never `0/0`.
15. Phase 4: a developer tests a route on one node; `all_nodes` returns one
    result per node, refuses unsafe methods and is super admin only; a disabled
    node gives 409 `node_disabled`.
16. Green: `go test -C api ./...`, `pnpm test`, `pnpm lint`, targeted e2e
    `nodes.spec.ts`.

## 14. Open questions

1. **Traffic probe path**: is `/` enough, or is a `gateway_probe_path` needed
   for operators with a dedicated health route? Decide in phase 2.
2. **Internal TLS**: custom CA or `skip verify` per node? Out of v1.
3. **Shared state across replicas**: a cache per replica in v1; revisit if the
   load on DP shows.

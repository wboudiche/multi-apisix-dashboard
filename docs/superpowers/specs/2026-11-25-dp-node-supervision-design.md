# Data plane node supervision (decoupled APISIX) - design v3

v3 replaces v2.1 (2026-10), whose text is lost. It is rebuilt from the review
of v2.1 and from the code at `5e37bb62`; every point that review raised is
settled here (see the table at the end).

## Intent

In APISIX's decoupled mode one control plane (CP) holds the Admin API and
writes etcd; N data planes (DP) read etcd and serve the traffic. The dashboard
already works against such a cluster for everything it writes: an instance's
`admin_api_url` is the CP, and the DP pick the change up from etcd.

What stops being true is everything that assumes an instance is one APISIX
process:

- The instance status (`Connected` / `Disconnected` / `Unknown`) says the CP
  answers. Every DP can be down while it is green.
- Upstream health (#281) is read from one `control_api_url`. In decoupled mode
  the Control API that matters is on each DP, and each DP sees its own health
  checkers.
- Nothing tells an operator whether a DP is serving the configuration the CP
  holds, or a stale one.
- "Test route" targets `gateway_url`; that it must be a DP or the load balancer
  in front of them, never the CP, is written nowhere.

This design adds read-only supervision of the DP of an instance, declared by
hand, and makes the existing screens say what they measure.

## Goals

- A super admin gives the DP nodes of an instance, in one of two ways:
  declared one by one (a name, the node's Control API address, optionally its
  traffic address), or found through a DNS name that resolves to every DP, as
  a Kubernetes headless Service does.
- Everyone with a role on the instance sees, for its current instance, the
  state of each node and of the cluster: reachable or not, serving traffic or
  not, configuration in sync with the CP or not.
- The upstream health badge (#281) is read from the nodes when an instance has
  nodes.
- A route can be tested against one chosen node.
- The existing fields keep their meaning and the traditional mode (one APISIX,
  no nodes) works exactly as today.

## Non-goals

- Discovering nodes through the Kubernetes API, etcd or a service registry.
  DNS is the only discovery: it covers Kubernetes without giving the dashboard
  a ServiceAccount or cluster rights.
- Acting on a node: restart, reload, drain, configuration push. Read-only.
- `config_provider: yaml` (standalone) data planes: they hold no etcd revision
  to compare, and the dashboard cannot write their configuration. Only the etcd
  provider is supported.
- Alerting or history beyond the last readings. Metrics stay Prometheus' job.
- An IP-level outbound filter (see "Outbound addresses").
- Comparing plugin lists or `stream_proxy` between the CP and the DP (see
  "Open questions").

## Terms

- **Instance**: unchanged. One APISIX cluster, addressed by its Admin API.
- **Node**: one data plane of an instance, declared under it.
- **Control channel**: the node's Control API (`/v1/*`), usually `:9090`.
- **Traffic channel**: the node's proxy listener, optional.

Each DP must not be registered as an instance: they share the CP's etcd prefix,
so the same resources would appear twice, with two ownership trees.

## Existing fields

`models.Instance` has three addresses (`models.go:26-41`). Their meaning with
nodes:

| Field | Traditional (no node) | With nodes |
|---|---|---|
| `admin_api_url` | the gateway | the CP; unchanged |
| `gateway_url` | the gateway | the entry point of the cluster: the load balancer, or one DP. Never the CP, which serves no traffic. Used by "Test route" when no node is chosen (`route_test_handler.go:101`). |
| `control_api_url` | upstream health (#281) | **not read** while the instance has at least one enabled node: health is read from the nodes. Kept, so that disabling the last node falls back to it. The instance form says so. |

Instance status: `Status` keeps its meaning, "the Admin API answers", and its
values `Connected | Disconnected | Unknown` and codes (#340) do not change. The
cluster gets its own field, `cluster_state` (below), so `healthReason`, the
header badge and the existing filters stay correct. The header and the overview
label `Status` as "Admin API" when the instance has nodes.

## Model

```go
type Node struct {
    ID            string   `json:"id"`
    InstanceID    string   `json:"instance_id"`
    Name          string   `json:"name"`           // unique in the instance
    ControlAPIURL string   `json:"control_api_url"` // required
    GatewayURL    string   `json:"gateway_url"`     // optional
    Enabled       bool     `json:"enabled"`
    DisabledAt    NullTime `json:"disabled_at"`
    CreatedAt     NullTime `json:"created_at"`
    UpdatedAt     NullTime `json:"updated_at"`
}
```

etcd: `/apisix-dashboard/nodes/<instanceID>/<nodeID>`.

- `name` and `control_api_url` are unique within the instance. The check and
  the write, `disabled_at` included, are one etcd transaction (compare on the
  revision of the instance's node prefix), so two concurrent edits cannot both
  pass the check or lose the date.
- Disabling sets `disabled_at`; enabling clears it. A disabled node is not
  polled and counts in no state.
- Deleting an instance deletes its nodes (same cascade as its ownership
  records).
- Addresses: `http` or `https`, no user info, no query, no fragment; the path is
  kept as a prefix (same rule as `fetchUpstreamHealth`). At most 50 nodes per
  instance.

### Node source

An instance has a `node_source`:

- `none` (default): no node, the traditional mode.
- `static`: the nodes above, declared one by one.
- `dns`: the instance holds `node_dns` (`host:port`, e.g.
  `apisix-dp-control.apisix.svc.cluster.local:9090`), `node_dns_scheme`
  (`http` default) and an optional `node_dns_gateway_port` (e.g. `9080`). At
  each poll the backend resolves the name (A and AAAA) and each address is a
  node for that poll: its Control API is `<scheme>://<ip>:<port>`, its traffic
  address `http://<ip>:<gateway port>` when the port is set.

Nodes found by DNS are not stored: their id is the address, their name the
address (or the PTR name when one resolves), they have no enable/disable and no
reminder. A pod that goes away leaves the list; it is not an unreachable node.
A resolution that fails or returns nothing makes the cluster `critical` with the
code `dns_empty` or `dns_failed`, and the previous list is not kept.

`static` and `dns` exclude each other, and switching drops the static nodes
after a confirmation.

## Kubernetes deployment

One CP pod and N DP pods (a Deployment, scaled by hand or by an HPA):

| Field | Value |
|---|---|
| `admin_api_url` | the CP's Service, `http://apisix-cp.<ns>.svc:9180` |
| `gateway_url` | the DP's Service (or its Ingress/LoadBalancer) |
| `node_source` | `dns` |
| `node_dns` | a headless Service (`clusterIP: None`) selecting the DP pods on port 9090 |

What the cluster needs:

- The DP's Control API listening beyond loopback: `apisix.enable_control: true`
  and `apisix.control.ip: 0.0.0.0` in the DP's configuration.
- The headless Service with `publishNotReadyAddresses: true`, so a pod that is
  not ready is shown as such rather than missing.
- A NetworkPolicy letting only the dashboard's pod reach port 9090: the Control
  API has no authentication.
- The dashboard running in the cluster, or anywhere pod addresses are routable.

A ClusterIP Service on 9090 does not work: it sends each request to any pod,
and the dashboard would read a different DP each time while believing it read
one. The instance form says so next to `node_dns`.

Kubernetes already restarts a dead pod and keeps it out of the Service while it
is not ready. On Kubernetes the value of this design is less "is the pod up"
than what Kubernetes does not see: each pod's configuration against the CP, the
upstream health each pod measures, and a route test against one pod.

## Permissions

| Action | Who | Endpoint |
|---|---|---|
| Set the node source; create, update, enable/disable, delete a node | `super_admin` (same rule as `UpdateInstance`, `handlers/instance.go:343`) | `POST/PUT/DELETE /api/v1/instances/:id/nodes[/:nodeId]` |
| Read nodes and their state | any role on the instance (`viewer`+), through the RBAC middleware | `GET /api/v1/instances/:id/nodes` |

A node's addresses are shown to the super admin only. Everyone else reads the
name, the states and the codes: the addresses describe the internal network,
like the Admin API address the probe errors no longer show them (#309). Raw
probe errors follow the same rule (`error` for the super admin, `code` for
everyone).

UI placement, because `/instances` is `SUPER_ADMIN_ONLY` (`usePermission.ts:40`):

- **Managing** nodes: a "Nodes" tab in the instance edit drawer, `/instances`.
- **Reading** them: a new page `/nodes`, in the navigation of every role, for
  the current instance; and the cluster line on `/overview`. The `/nodes` page
  shows "No nodes declared" with, for a super admin, a link to the drawer.

## States

### Node

Each poll reads two channels.

**Control channel**: `GET <control_api_url>/v1/healthcheck` with
`Accept: application/json`.

- `up`: 200 with a JSON array.
- `down`: connection refused, timeout, non-200, or a body that is not that
  array.

**Traffic channel**, when `gateway_url` is set: `GET <gateway_url>/` with no
redirects followed.

- `up`: any HTTP response, a 404 included (APISIX answers 404 to a path no
  route matches; the listener is what is measured).
- `tls_error`: the TLS handshake failed. APISIX picks the certificate from the
  SNI, so an HTTPS address with no matching SSL fails here while the listener
  is fine. It is shown as its own state, and the form recommends the HTTP port.
- `down`: no response.
- `na`: no `gateway_url`.

**Node state**, from both:

| State | Rule |
|---|---|
| `healthy` | control `up`, traffic `up` or `na` |
| `degraded` | exactly one channel `down` or `tls_error`, or configuration `drift` |
| `unreachable` | control `down` and traffic `down` or `na` |
| `unknown` | not polled yet since start or since enabled |

### Configuration sync, per type

For each of `routes`, `services`, `upstreams`, a node's configuration state is
one of:

| State | Meaning |
|---|---|
| `in_sync` | the node holds the same `(id, revision)` set as the CP |
| `drift_pending` | a difference seen once; it may be propagation |
| `drift` | a difference on a key that was stable over two polls (below) |
| `too_large` | a listing exceeded the size limit; not compared |
| `na` | the node's Control API does not serve this listing (404) |
| `unknown` | not read: control `down`, or the CP read failed |

Rollup per node, worst first: `drift > drift_pending > too_large > unknown >
na > in_sync`. The table shows the rollup; the row expands to the three types.

**Reference is the CP.** The Admin API lists give each key's `modifiedIndex`,
the etcd revision of the key, which is also what each DP holds for it, since
the DP read the same etcd. Comparing to the CP (not node to node) catches a lag
common to all nodes and works with a single node. For routes, the Control API
returns `orig_modifiedIndex` as well as `modifiedIndex`, which a route's
service can change; the comparison uses `orig_modifiedIndex` when present.
Phase 0 confirms both points before anything is built on them.

**Moving configuration.** A key counts toward `drift` only if its CP revision
is the same at two consecutive polls and the node still differs at the second.
A key written between polls is at worst `drift_pending`. A pipeline that writes
every minute therefore never shows a false `drift`, only `drift_pending` on the
keys it touches.

**Size.** CP and node listings are decoded as a stream, keeping only the id and
the revisions of each entry, with a limit of 8 MiB per listing; past it the type
is `too_large`. The CP listing is read once per poll for all the instance's
nodes, not once per node (#288 is what an unbounded read costs).

### Cluster

Emitted on the instance health only when it has at least one enabled node:

```json
{
  "cluster_state": "healthy | degraded | critical | unknown",
  "nodes_active": 3,
  "nodes_healthy": 2,
  "nodes_disabled": 1,
  "disabled_reminder": true
}
```

- `critical`: no enabled node has traffic `up`; a node without `gateway_url`
  counts by its node state (`healthy` = serving). This is "nothing serves
  traffic", and a node `degraded` by its Control API alone still serves.
- `degraded`: not critical, and at least one node is not `healthy` or has a
  configuration state other than `in_sync` and `na`.
- `healthy`: every enabled node `healthy` and `in_sync`/`na`.
- `unknown`: no enabled node polled yet.

`nodes_disabled` is emitted whenever it is above 0, also when no node is
enabled, so the page can say "0 active nodes, 2 disabled". `disabled_reminder`
is computed by the server: some node has been disabled for more than
`NODE_DISABLED_REMINDER_DAYS` (default 14). The client does no date
arithmetic.

## Upstream health with nodes

When an instance has enabled nodes, the `__dashboard_health` annotation
(`upstream_health.go`) is built from every enabled node's `/v1/healthcheck`
instead of `control_api_url`:

- A checker only exists on a DP once that upstream has served a request there,
  so totals differ between nodes by construction. The badge keeps the three
  states of #281: not checked, checked but **not measured** (no node has
  registered targets), measured.
- Measured: one entry per target, with the worst status reported by any node
  and the number of nodes that measured it (`2/3 nodes`). Never `0/0`.
- A node whose control channel is down is left out and named in the tooltip.

## Test route against a node

`POST /api/v1/route-test` takes an optional `node_id`:

- absent: unchanged, the instance's `gateway_url`;
- a node of another instance, no node, or (DNS) an address not in the last
  resolution: `404 node_not_found`;
- a disabled node: `409 node_disabled`;
- a node without `gateway_url`: `422 node_has_no_gateway`.

The drawer offers the node list when the instance has nodes. When a test right
after a save answers 404 and the instance has nodes whose state for `routes` is
not `in_sync`, the result says the change may not have reached the node yet.

## Poller

- One background loop per backend process: control and traffic channels every
  `NODE_HEALTH_INTERVAL` (default 30s), configuration every
  `NODE_SYNC_INTERVAL` (default 60s). Timeouts 3s per request.
- Its own concurrency pool, `NODE_PROBE_CONCURRENCY` (default 8). It does not
  take slots from `probe.Acquire`: 50 nodes x several endpoints must not queue
  the tests users start (#330).
- Results are kept in memory, keyed by node, and read by the endpoints; a reader
  never triggers a probe. After a restart nodes are `unknown` until the first
  poll.
- Several backend replicas each poll every node, multiplying the load on the DP
  by the number of replicas. Accepted for this version (a few requests per node
  per minute); leader election is out of scope.

## Outbound addresses

Node addresses are entered by a super admin, who can already point an instance
anywhere, admin key included. They get the same treatment as `admin_api_url`
and `control_api_url`: syntax validation, no redirect followed, bodies capped,
errors shown to the super admin only.

They must not go through the internal-address filter of the upstream "Test
connection" (`isBlockedAddr`, `handlers/upstream.go`). That filter is there
because any developer types an upstream node; it refuses private ranges and
loopback, which is exactly where DP live (pod addresses, the e2e stack's
`127.0.0.1:${E2E_CONTROL_PORT}`). A filter for every super-admin-entered
address (instances, nodes, Keycloak connections) is a separate decision, not
taken here.

## UI

- `/instances`, edit drawer, tab **Nodes** (super admin): table name, control
  address, traffic address, enabled, state; add, edit, enable/disable, delete.
  A note when `control_api_url` is set and nodes exist: "Health is read from the
  nodes".
- `/nodes` (all roles, current instance): cluster line (state, `x/y healthy`,
  disabled count and reminder), then one row per node: name, node state,
  control, traffic, configuration rollup, last poll. A row expands to the three
  configuration types. Addresses only for the super admin.
- `/overview`: a cluster column next to the instance status, empty for an
  instance with no node.
- Header: unchanged badge for `Status`; when `cluster_state` is `degraded` or
  `critical`, a second dot with its tooltip.
- All text through `t()`, keys in the five languages.

## Testing

- Go: unit tests on state rules (node, rollup, cluster, drift over two polls),
  the streaming decoder and its limit, the transaction on uniqueness, the
  permission matrix (viewer reads without addresses, instance admin cannot
  write).
- Vitest: rendering of each state, no address for non super admins.
- E2E: a decoupled variant of the e2e stack (one CP, two DP on the same etcd
  prefix, Control API published on loopback). Healthy and unreachable are
  tested on the real nodes (stop one DP); drift and `too_large` against a
  mocked Control API. Targeted runs only (a full run saturates the machine).

## Phases

0. **Spike** (no product code): decoupled compose, and a kind/k3d cluster with
   a headless Service; confirm the CP's
   `modifiedIndex` equals the DP's for routes, services and upstreams, and
   which of `modifiedIndex`/`orig_modifiedIndex` to use for routes; measure
   propagation delay; check `/v1/healthcheck` and the `/v1/<type>` listings on
   a DP. Outcome written into this document.
1. **Decoupled-mode readiness**, no new model: docs (CP / LB / DP, one instance
   per cluster, etcd provider only), `gateway_url` help text, "Admin API" label,
   the decoupled e2e stack and a spec proving CRUD and route test through it,
   a `deploy/` variant.
2. **Nodes**: model, node source (`static`, `dns`), CRUD, permissions, drawer
   tab.
3. **Health**: poller, node and cluster states, `/nodes`, overview, header.
4. **Upstream health from nodes**.
5. **Configuration sync**: CP reference, drift, `too_large`.
6. **Test route against a node**, and the propagation hint.

Phases 1 to 3 are useful alone; 4, 5 and 6 depend on 2 and 3, not on each
other.

## Open questions

- Plugins and `stream_proxy`: the plugin forms offer what the CP's
  `config.yaml` enables. A DP with a different list accepts the configuration
  and fails at runtime. Comparing the lists needs an endpoint the DP's Control
  API may not give (`/v1/plugins` reloads, it does not list). To look at in
  phase 0; out of scope otherwise.
- Version skew between CP and DP: not read today. If a DP gives its version on
  the Control API, the `/nodes` page could show it.

## Review of v2.1: how each point is settled

| # | Point | Settled in |
|---|---|---|
| 1 | `gateway_url`, `control_api_url` ignored | Existing fields |
| 2 | Write right is `super_admin`; viewer cannot see `/instances` | Permissions, UI |
| 3 | IP-level guard | Outbound addresses (the upstream test's filter exists and must not apply to nodes) |
| 4 | Status enum is `Connected/Disconnected/Unknown` | Existing fields, Cluster (`cluster_state`) |
| 5 | `critical` contradicted `degraded` | Cluster |
| 6 | Configuration state per node vs per type | Configuration sync |
| 7 | Omitted fields vs "0 active nodes" | Cluster (`nodes_disabled`) |
| 8 | Reminder threshold on the server, computed on the client | Cluster (`disabled_reminder`) |
| 9 | 404 for a disabled node | Test route (409 `node_disabled`) |
| 10 | CP as reference | Configuration sync |
| 11 | etcd provider only | Non-goals |
| 12 | `/v1/healthcheck` unstable by construction | Upstream health ("not measured") |
| 13 | HTTPS probe false `down` | Node (`tls_error`) |
| 14 | Fast-moving configuration, false drift | Configuration sync (stable over two polls) |
| - | `node_count` naming | `nodes_active` |
| - | Streaming decode | Configuration sync (size) |
| - | E2E on real nodes | Testing |
| - | `disabled_at` in the transaction | Model |
| - | Several replicas | Poller |

# WSDL → Routes Import — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)
**Scope:** Single, self-contained feature. One implementation plan.

## 1. Summary

Add an "Import from WSDL" capability to the dashboard that scaffolds APISIX
route(s) from a SOAP service's WSDL — the SOAP analog of the existing OpenAPI
import (`ImportRoutesModal` + `src/utils/openapi-import.ts`).

This is about **route-creation convenience**, not SOAP↔REST mediation. We do not
transform request/response bodies. Generated routes proxy plain SOAP to the
backend; the gateway gains per-operation visibility, labels, and team ownership
without any mediation machinery.

### Comparison to WSO2 API Manager "Create API from WSDL"

WSO2 offers two outcomes: (a) a **SOAP pass-through** API (single wildcard
resource), and (b) **SOAP-to-REST** with auto-generated mediation sequences —
its headline value-add. We deliberately implement the equivalent of (a), plus a
**per-operation** mode that WSO2 only offers via the full (b) mediation path.
We are lighter than WSO2 on: SOAP-to-REST mediation (out of scope) and serving
a rewritten WSDL back to consumers (deferred — see §8). We match WSO2 on
multi-file WSDL import and endpoint extraction.

## 2. Decisions

| Decision | Choice |
|---|---|
| Output granularity | Toggle at import: **per-operation** (default) or **single passthrough** |
| Operation discrimination | `SOAPAction` HTTP header `vars` match; **warn** on SOAP 1.2 |
| Sources | Upload (file or ZIP) / paste **and** URL fetch |
| Multi-file WSDL | Full support: ZIP in-browser + recursive URL server-side. Follow `wsdl:import` only; **ignore** `xsd:import`/`xsd:include` (not needed without mediation) |
| Upstream binding | Select existing upstream/service **or** auto-create inline upstream from `<soap:address>` |
| Provenance | Stamp `wsdl-service`, `wsdl-source-hash` (and `wsdl-source-url` when fetched) labels on each generated route. Enables future re-import / drift detection. Full WSDL registry/serving deferred |

## 3. Architecture

All parsing is **client-side**, mirroring the OpenAPI flow. The only backend
addition is a WSDL fetch endpoint required by the URL source (browser CORS
prevents fetching arbitrary WSDL URLs directly).

```
Upload file/ZIP ──┐
Paste XML ────────┤
                  ├─▶ Map<filename, xml> ─▶ wsdl-import.parse(map, entry, opts)
URL ─▶ GET /api/v1/wsdl/fetch ─┘                       │   ┌─ services[]
        (auth + SSRF guard, recursive)                 ├──▶├─ routes[]
                                                        │   └─ warnings[]
                                                        ▼
                                        preview table + warnings panel
                                                        │  user confirms
                                                        ▼
                       for each route: req.post('/routes', route) ──▶ existing proxy
                                                        │              (RBAC + ownership
                                                        ▼               recording — unchanged)
                                            success / failure tally
```

Both delivery mechanisms (ZIP expansion and recursive URL fetch) produce a
`Map<filename, xml>` consumed by the **same** parser. One parser, two front doors.

## 4. Components

### Frontend

**`src/utils/wsdl-import.ts`** — pure parser/converter (no network, no DOM).
- Input: `Map<filename, xml>`, entry document name, `{ mode, upstreamBinding }`.
- Parses each WSDL doc with `fast-xml-parser`; merges `wsdl:import`ed WSDL docs
  into one logical definition, resolving `location` against the map.
- Walks `definitions → service → port`: reads `<soap:address>` /
  `<soap12:address>` `location` (→ endpoint URL → uri path + host:port), follows
  the port's `binding`, detects SOAP **1.1 vs 1.2** by binding namespace, and
  reads each operation's `soapAction`.
- Returns `{ services[], routes[], warnings[] }`.

**`src/utils/wsdl-zip.ts`** — expands an uploaded ZIP into the `Map` via `jszip`,
with zip-bomb guards (max file count, max total uncompressed size).

**`src/components/page/ImportWsdlModal.tsx`** — mirrors `ImportRoutesModal`:
- Source tabs: upload/paste | URL.
- Mode toggle: per-operation (default) | single passthrough.
- Upstream-binding selector: existing upstream/service dropdown | auto-create
  from WSDL address.
- Preview table of operations + a warnings panel.
- Per-route creation via the existing `req.post(API_ROUTES, route)` loop with the
  existing success/failure tally and per-route error list.
- Wired in next to the OpenAPI import entry point.

### Backend

**`api/internal/handlers/wsdl.go`** — `GET /api/v1/wsdl/fetch?url=…`, auth-required
(behind AuthMW via `apiClient`). Recursively fetches the WSDL and its
`wsdl:import` documents (resolving relative `location`s against each base URL)
and returns a JSON `{ filename: content }` map. Wired into the authed router
group in `api/cmd/main.go`. Subject to the SSRF guard in §6.

## 5. Generated route shape

The route schema is **unchanged** — generated routes are ordinary payloads, so
team-ownership recording and viewer write-gating already apply.

Per-operation mode:

```js
{
  uri: '/services/Billing',                 // path from <soap:address location>
  methods: ['POST'],
  name: 'BillingService.GetInvoice',
  desc: 'SOAP 1.1 operation GetInvoice',
  labels: {
    'soap-service': 'BillingService',
    'wsdl-source-hash': '9f2c…',            // provenance
    // 'wsdl-source-url': 'http://…?wsdl'   // present when fetched by URL
  },
  vars: [['http_soapaction', '==', '"urn:GetInvoice"']],  // quoted, as HTTP sends it
  upstream_id: 'billing-soap',              // selected existing, OR:
  // upstream: { nodes: { 'billing-soap:8080': 1 }, type: 'roundrobin', scheme: 'http' }
}
```

Passthrough mode: one route per service with the same uri/upstream but **no**
`vars`.

## 6. Error handling & warnings

Surfaced in the preview; non-blocking where possible.

| Condition | Behavior |
|---|---|
| Invalid XML / not a WSDL | Hard error — nothing imported |
| No `<service>` / `<soap:address>` | Hard error — "no SOAP endpoint found" |
| SOAP 1.2 binding | Warning — "SOAPAction may be absent; consider passthrough" |
| Empty/missing `soapAction` (per-op mode) | Skip that operation with a warning (cannot discriminate at gateway) |
| Duplicate `soapAction` across operations | Warning — routes would collide on same uri+var |
| Unresolved `wsdl:import` (missing ZIP file / fetch fail) | Warning; proceed with what resolved. Hard error only if no usable binding remains |
| Per-route create failure | Existing tally + per-route error list |

## 7. Security — the URL-fetch endpoint

The fetch endpoint takes a user-supplied URL and follows imports → SSRF surface.
Guards:

- Scheme allowlist (`http`/`https` only); reject credentials embedded in URL.
- Resolve DNS and **reject private/loopback/link-local/metadata ranges** on
  every fetched URL including imports: `10/8`, `172.16/12`, `192.168/16`,
  `127/8`, `169.254/16` (incl. `169.254.169.254`), `::1`, `fc00::/7`.
- Recursion limits: max depth, max document count, max bytes/doc + total cap,
  per-request timeout.
- Optional config-driven host allowlist (off by default).

## 8. Out of scope (deferred)

- **SOAP-to-REST mediation** — explicitly not this feature.
- **Serving a rewritten WSDL** back to consumers (WSO2 registry behavior). The
  provenance labels in §2 keep this cheap to add later.
- **XSD resolution** — not needed for route generation.

## 9. Testing

- **Parser unit tests (adds `vitest` dev-dependency)** — fixtures for: SOAP 1.1
  single-file → N routes with correct `vars`/uri/name; SOAP 1.2 → warning;
  multi-file `wsdl:import` merge; empty-`soapAction` skip; passthrough mode;
  existing vs auto-create upstream.
- **ZIP expansion** unit test including zip-bomb guard.
- **Go tests (`api/internal/handlers/wsdl_test.go`)** — SSRF guard table tests
  (reject private/metadata IPs, allow public), recursion/size limits,
  relative-`location` resolution.
- **One Playwright e2e** — import a fixture WSDL, assert routes created,
  mirroring existing import specs.

## 10. New dependencies

- `fast-xml-parser` (runtime) — pure-JS XML parsing, browser-safe.
- `jszip` (runtime) — ZIP expansion in-browser.
- `vitest` (dev) — parser unit tests; no runner currently exists in the repo.

## 11. Files touched

New:
- `src/utils/wsdl-import.ts`
- `src/utils/wsdl-zip.ts`
- `src/components/page/ImportWsdlModal.tsx`
- `api/internal/handlers/wsdl.go`
- `api/internal/handlers/wsdl_test.go`
- `src/utils/wsdl-import.test.ts` (+ vitest config)
- Playwright spec + WSDL fixtures under `e2e/`

Modified:
- OpenAPI-import entry point (add WSDL import action alongside it)
- `api/cmd/main.go` (register the fetch route in the authed group)
- `package.json` (new deps)

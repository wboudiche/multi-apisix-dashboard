# WSDL → Routes Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Import from WSDL" feature that scaffolds APISIX route(s) from a SOAP service's WSDL, mirroring the existing OpenAPI import.

**Architecture:** A pure client-side parser (`src/utils/wsdl-import.ts`) turns a WSDL bundle (one or many docs) into APISIX route payloads; a ZIP helper and an SSRF-guarded backend fetch endpoint feed it from uploads or URLs. A Mantine modal mirrors `ImportRoutesModal` and creates routes one-by-one through the existing proxy. No changes to the route schema, RBAC, proxy, or ownership.

**Tech Stack:** React 19 + Mantine + TanStack; Go/Gin backend; `fast-xml-parser`, `jszip` (runtime), `vitest` (dev/test).

## Global Constraints

- ASF license header required on every new `.ts`/`.tsx` file and Go file (copy verbatim from any existing source file in the same language; `pnpm lint:fix` inserts the JS/TS one).
- Single quotes only in JS/TS; no template literals as substitutes. `import type` for type-only imports (`verbatimModuleSyntax`).
- `pnpm lint --max-warnings=0` must pass — warnings fail the build. No hardcoded user-visible strings (use i18n keys in `src/locales/en/common.json`).
- Backend: package `handlers`; reuse existing `resolveAllowedIP` from `api/internal/handlers/upstream.go` — do NOT duplicate the CIDR list.
- APISIX route `vars` format is an array of `[var, op, value]` triples, e.g. `[['http_soapaction', '==', '"urn:GetInvoice"']]`.
- Provenance labels (`soap-service`, `wsdl-source-hash`, `wsdl-source-url`) are plain route labels. Label-validation middleware is NOT applied to the proxy create path (`api/cmd/main.go` proxy group uses only `RBACMiddleware`), so these keys need no catalog pre-registration.

---

## File Structure

New:
- `vitest.config.ts` — minimal node-env test runner config.
- `src/utils/wsdl-import.ts` — pure parser/converter (the core).
- `src/utils/wsdl-import.test.ts` — parser unit tests.
- `src/utils/wsdl-zip.ts` — ZIP→docs-map expansion via jszip, with guards.
- `src/utils/wsdl-zip.test.ts` — zip helper tests.
- `src/apis/wsdl.ts` — `fetchWsdl(url)` helper (apiClient).
- `src/components/page/ImportWsdlModal.tsx` — the modal.
- `api/internal/handlers/wsdl.go` — SSRF-guarded recursive fetch endpoint.
- `api/internal/handlers/wsdl_test.go` — backend tests.
- `e2e/fixtures/billing.wsdl` — SOAP 1.1 fixture.
- `e2e/tests/routes.import-wsdl.spec.ts` — e2e.

Modified:
- `package.json` — deps + `test` script.
- `src/locales/en/common.json` — `form.importWsdl.*` keys.
- `src/routes/routes/index.tsx` — button + modal wiring.
- `api/cmd/main.go` — register the fetch route.

---

## Task 1: Test infrastructure + dependencies

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/utils/__smoke__.test.ts` (temporary smoke test, deleted in Step 6)

**Interfaces:**
- Produces: a working `pnpm test` command running `vitest run` over `src/**/*.test.ts`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm add fast-xml-parser jszip
pnpm add -D vitest
```

- [ ] **Step 2: Add the test script to package.json**

In `package.json` `"scripts"`, add after the `"e2e"` line:

```json
    "test": "vitest run"
```

- [ ] **Step 3: Create `vitest.config.ts`** (include the ASF header — copy the `/** ... */` block from `src/utils/openapi-import.ts` lines 1-16)

```ts
/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * ... (full ASF header) ...
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create a smoke test to prove the runner works**

`src/utils/__smoke__.test.ts` (with ASF header):

```ts
/** ... ASF header ... */
import { describe, expect, it } from 'vitest';

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test`
Expected: PASS, 1 test passed.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm src/utils/__smoke__.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "build(route): add vitest runner and wsdl import deps

Adds fast-xml-parser + jszip (runtime) and vitest (dev) to support the
WSDL import feature. No frontend unit-test runner existed before."
```

---

## Task 2: WSDL parser — single-document SOAP 1.1, both modes

**Files:**
- Create: `src/utils/wsdl-import.ts`
- Test: `src/utils/wsdl-import.test.ts`

**Interfaces:**
- Produces:
  - `type WsdlImportMode = 'per-operation' | 'passthrough'`
  - `type UpstreamBinding = { kind: 'existing'; upstreamId?: string; serviceId?: string } | { kind: 'auto' }`
  - `type WsdlImportOptions = { mode: WsdlImportMode; upstream: UpstreamBinding; sourceUrl?: string }`
  - `type GeneratedRoute = { name?: string; desc?: string; uri: string; methods: string[]; labels?: Record<string, string>; vars?: unknown[]; upstream?: Record<string, unknown>; upstream_id?: string; service_id?: string; status: number }`
  - `type WsdlParseResult = { serviceCount: number; operationCount: number; soapVersion: '1.1' | '1.2' | 'mixed' | 'unknown'; routes: GeneratedRoute[]; warnings: string[] }`
  - `type WsdlBundle = { entry: string; docs: Record<string, string> }`
  - `parseWsdlString(xml: string, opts: WsdlImportOptions): WsdlParseResult`
  - `parseWsdlBundle(bundle: WsdlBundle, opts: WsdlImportOptions): WsdlParseResult`

- [ ] **Step 1: Write the failing test**

`src/utils/wsdl-import.test.ts` (ASF header + the following). The fixture is a minimal SOAP 1.1 WSDL with two operations.

```ts
/** ... ASF header ... */
import { describe, expect, it } from 'vitest';

import { parseWsdlString } from '@/utils/wsdl-import';

const SOAP11 = `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="BillingService">
  <wsdl:portType name="BillingPort">
    <wsdl:operation name="GetInvoice"/>
    <wsdl:operation name="PayInvoice"/>
  </wsdl:portType>
  <wsdl:binding name="BillingBinding" type="tns:BillingPort">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="GetInvoice">
      <soap:operation soapAction="urn:GetInvoice"/>
    </wsdl:operation>
    <wsdl:operation name="PayInvoice">
      <soap:operation soapAction="urn:PayInvoice"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="BillingService">
    <wsdl:port name="BillingPort" binding="tns:BillingBinding">
      <soap:address location="http://billing-soap:8080/services/Billing"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

describe('parseWsdlString — per-operation, SOAP 1.1', () => {
  it('creates one route per operation matched on SOAPAction', () => {
    const r = parseWsdlString(SOAP11, {
      mode: 'per-operation',
      upstream: { kind: 'existing', upstreamId: 'billing-soap' },
    });
    expect(r.soapVersion).toBe('1.1');
    expect(r.serviceCount).toBe(1);
    expect(r.operationCount).toBe(2);
    expect(r.routes).toHaveLength(2);
    const get = r.routes.find((x) => x.name === 'BillingService.GetInvoice')!;
    expect(get.uri).toBe('/services/Billing');
    expect(get.methods).toEqual(['POST']);
    expect(get.vars).toEqual([['http_soapaction', '==', '"urn:GetInvoice"']]);
    expect(get.upstream_id).toBe('billing-soap');
    expect(get.labels?.['soap-service']).toBe('BillingService');
    expect(get.status).toBe(1);
  });

  it('passthrough mode creates one route per service with no vars', () => {
    const r = parseWsdlString(SOAP11, {
      mode: 'passthrough',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].uri).toBe('/services/Billing');
    expect(r.routes[0].vars).toBeUndefined();
    expect(r.routes[0].upstream).toEqual({
      nodes: { 'billing-soap:8080': 1 },
      type: 'roundrobin',
      scheme: 'http',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: FAIL — cannot resolve `@/utils/wsdl-import`.

- [ ] **Step 3: Implement the parser**

`src/utils/wsdl-import.ts` (ASF header + the following):

```ts
/** ... ASF header ... */
import { XMLParser } from 'fast-xml-parser';

export type WsdlImportMode = 'per-operation' | 'passthrough';

export type UpstreamBinding =
  | { kind: 'existing'; upstreamId?: string; serviceId?: string }
  | { kind: 'auto' };

export type WsdlImportOptions = {
  mode: WsdlImportMode;
  upstream: UpstreamBinding;
  sourceUrl?: string;
};

export type GeneratedRoute = {
  name?: string;
  desc?: string;
  uri: string;
  methods: string[];
  labels?: Record<string, string>;
  vars?: unknown[];
  upstream?: Record<string, unknown>;
  upstream_id?: string;
  service_id?: string;
  status: number;
};

export type WsdlParseResult = {
  serviceCount: number;
  operationCount: number;
  soapVersion: '1.1' | '1.2' | 'mixed' | 'unknown';
  routes: GeneratedRoute[];
  warnings: string[];
};

export type WsdlBundle = { entry: string; docs: Record<string, string> };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

const asArray = <T>(x: T | T[] | undefined | null): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];

const localName = (qname: string): string =>
  qname.includes(':') ? qname.split(':').pop()! : qname;

// FNV-1a 32-bit hash → 8-char hex. Synchronous, browser-safe, good enough
// for provenance/drift detection (not a security hash).
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

type SoapVersion = '1.1' | '1.2' | 'mixed' | 'unknown';

const detectSoapVersion = (rawDocs: string[]): SoapVersion => {
  let has11 = false;
  let has12 = false;
  for (const xml of rawDocs) {
    if (xml.includes('wsdl/soap12')) has12 = true;
    if (xml.includes('wsdl/soap/')) has11 = true;
  }
  if (has11 && has12) return 'mixed';
  if (has12) return '1.2';
  if (has11) return '1.1';
  return 'unknown';
};

export const parseWsdlString = (
  xml: string,
  opts: WsdlImportOptions,
): WsdlParseResult => parseWsdlBundle({ entry: 'main', docs: { main: xml } }, opts);

export const parseWsdlBundle = (
  bundle: WsdlBundle,
  opts: WsdlImportOptions,
): WsdlParseResult => {
  const warnings: string[] = [];

  // Task 4 replaces this with import-following; for now merge every doc.
  const docKeys = Object.keys(bundle.docs);
  const rawDocs = docKeys.map((k) => bundle.docs[k]);
  const soapVersion = detectSoapVersion(rawDocs);

  // Gather bindings and services across all docs.
  const bindings = new Map<string, { operations: { name: string; soapAction: string }[] }>();
  const services: { name: string; bindingLocal: string; location: string }[] = [];

  for (const xmlDoc of rawDocs) {
    const root = parser.parse(xmlDoc) as Record<string, any>;
    const defs = root.definitions ?? {};

    for (const b of asArray<any>(defs.binding)) {
      const name = String(b['@_name'] ?? '');
      if (!name) continue;
      const operations = asArray<any>(b.operation).map((op) => ({
        name: String(op['@_name'] ?? ''),
        // child soap:operation is also named 'operation' after NS removal
        soapAction: String(asArray<any>(op.operation)[0]?.['@_soapAction'] ?? ''),
      }));
      bindings.set(name, { operations });
    }

    for (const svc of asArray<any>(defs.service)) {
      const svcName = String(svc['@_name'] ?? '');
      for (const port of asArray<any>(svc.port)) {
        const bindingLocal = localName(String(port['@_binding'] ?? ''));
        const addr = asArray<any>(port.address).find((a) => a?.['@_location']);
        const location = String(addr?.['@_location'] ?? '');
        if (svcName && bindingLocal && location) {
          services.push({ name: svcName, bindingLocal, location });
        }
      }
    }
  }

  if (services.length === 0) {
    throw new Error('No SOAP service endpoint (<service>/<soap:address>) found in the WSDL.');
  }

  if (soapVersion === '1.2' || soapVersion === 'mixed') {
    warnings.push(
      'WSDL uses SOAP 1.2; the SOAPAction header may be absent, so per-operation routing may not match. Consider passthrough mode.',
    );
  }

  const sourceHash = fnv1a(bundle.docs[bundle.entry] ?? rawDocs[0] ?? '');
  const routes: GeneratedRoute[] = [];
  let operationCount = 0;

  for (const svc of services) {
    const url = (() => {
      try {
        return new URL(svc.location);
      } catch {
        return null;
      }
    })();
    if (!url) {
      warnings.push(`Service '${svc.name}': could not parse endpoint URL '${svc.location}'.`);
      continue;
    }
    const uri = url.pathname || '/';

    const labels: Record<string, string> = {
      'soap-service': svc.name,
      'wsdl-source-hash': sourceHash,
    };
    if (opts.sourceUrl) labels['wsdl-source-url'] = opts.sourceUrl;

    const applyUpstream = (route: GeneratedRoute) => {
      if (opts.upstream.kind === 'existing') {
        if (opts.upstream.upstreamId) route.upstream_id = opts.upstream.upstreamId;
        if (opts.upstream.serviceId) route.service_id = opts.upstream.serviceId;
      } else {
        const scheme = url.protocol.replace(':', '') || 'http';
        const host = url.hostname;
        const port = url.port || (scheme === 'https' ? '443' : '80');
        route.upstream = {
          nodes: { [`${host}:${port}`]: 1 },
          type: 'roundrobin',
          scheme,
        };
      }
    };

    if (opts.mode === 'passthrough') {
      const route: GeneratedRoute = {
        name: svc.name,
        desc: `SOAP passthrough for ${svc.name}`,
        uri,
        methods: ['POST'],
        labels,
        status: 1,
      };
      applyUpstream(route);
      routes.push(route);
      operationCount += bindings.get(svc.bindingLocal)?.operations.length ?? 0;
      continue;
    }

    const binding = bindings.get(svc.bindingLocal);
    if (!binding) {
      warnings.push(`Service '${svc.name}': binding '${svc.bindingLocal}' not found.`);
      continue;
    }
    for (const op of binding.operations) {
      operationCount++;
      const versionLabel = soapVersion === 'unknown' ? '' : `SOAP ${soapVersion} `;
      const route: GeneratedRoute = {
        name: `${svc.name}.${op.name}`,
        desc: `${versionLabel}operation ${op.name}`,
        uri,
        methods: ['POST'],
        labels: { ...labels },
        vars: [['http_soapaction', '==', `"${op.soapAction}"`]],
        status: 1,
      };
      applyUpstream(route);
      routes.push(route);
    }
  }

  return {
    serviceCount: services.length,
    operationCount,
    soapVersion,
    routes,
    warnings,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/wsdl-import.ts src/utils/wsdl-import.test.ts
git commit -m "feat(route): WSDL parser for SOAP 1.1 per-operation and passthrough

Pure client-side parser converting a WSDL into APISIX route payloads.
Per-operation mode emits one SOAPAction-matched route per operation;
passthrough emits one route per service. Stamps provenance labels."
```

---

## Task 3: Warnings — empty and duplicate SOAPAction

**Files:**
- Modify: `src/utils/wsdl-import.ts`
- Test: `src/utils/wsdl-import.test.ts`

**Interfaces:**
- Consumes/Produces: same signatures as Task 2. Behavior change only: in `per-operation` mode, operations with an empty `soapAction` are skipped with a warning; duplicate `soapAction` values across emitted routes add a warning.

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
describe('parseWsdlString — soapAction edge cases', () => {
  const xml = (a1: string, a2: string) => `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="S">
  <wsdl:binding name="B" type="tns:P">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Op1"><soap:operation soapAction="${a1}"/></wsdl:operation>
    <wsdl:operation name="Op2"><soap:operation soapAction="${a2}"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="S">
    <wsdl:port name="P" binding="tns:B">
      <soap:address location="http://h:8080/svc"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

  it('skips operations with empty SOAPAction in per-operation mode', () => {
    const r = parseWsdlString(xml('urn:Op1', ''), {
      mode: 'per-operation',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].name).toBe('S.Op1');
    expect(r.warnings.some((w) => w.includes('Op2') && w.includes('SOAPAction'))).toBe(true);
  });

  it('warns on duplicate SOAPAction values', () => {
    const r = parseWsdlString(xml('urn:Dup', 'urn:Dup'), {
      mode: 'per-operation',
      upstream: { kind: 'auto' },
    });
    expect(r.routes).toHaveLength(2);
    expect(r.warnings.some((w) => w.toLowerCase().includes('duplicate'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: FAIL — empty-action route is currently emitted; no duplicate warning.

- [ ] **Step 3: Implement** — in the per-operation loop in `wsdl-import.ts`, replace the body of `for (const op of binding.operations)` with:

```ts
    const seenActions = new Set<string>();
    for (const op of binding.operations) {
      operationCount++;
      if (!op.soapAction) {
        warnings.push(
          `Service '${svc.name}': operation '${op.name}' has an empty SOAPAction and cannot be matched per-operation; it was skipped (use passthrough mode to include it).`,
        );
        continue;
      }
      if (seenActions.has(op.soapAction)) {
        warnings.push(
          `Service '${svc.name}': duplicate SOAPAction '${op.soapAction}' — generated routes will collide on the same URI.`,
        );
      }
      seenActions.add(op.soapAction);
      const versionLabel = soapVersion === 'unknown' ? '' : `SOAP ${soapVersion} `;
      const route: GeneratedRoute = {
        name: `${svc.name}.${op.name}`,
        desc: `${versionLabel}operation ${op.name}`,
        uri,
        methods: ['POST'],
        labels: { ...labels },
        vars: [['http_soapaction', '==', `"${op.soapAction}"`]],
        status: 1,
      };
      applyUpstream(route);
      routes.push(route);
    }
```

(`operationCount++` still counts every operation, including skipped ones.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/wsdl-import.ts src/utils/wsdl-import.test.ts
git commit -m "feat(route): warn on empty and duplicate SOAPAction in WSDL import

Empty-SOAPAction operations are skipped in per-operation mode (cannot be
matched at the gateway); duplicate actions emit a collision warning."
```

---

## Task 4: Multi-file merge — follow wsdl:import

**Files:**
- Modify: `src/utils/wsdl-import.ts`
- Test: `src/utils/wsdl-import.test.ts`

**Interfaces:**
- Consumes/Produces: same as Task 2. Behavior change: `parseWsdlBundle` now starts at `bundle.entry` and follows `<wsdl:import location=…>` to other docs in `bundle.docs`, resolving a location by exact key first, then by basename. XSD imports are ignored. Unresolved imports add a warning.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('parseWsdlBundle — multi-file', () => {
  const concrete = `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="S">
  <wsdl:import namespace="urn:abstract" location="abstract.wsdl"/>
  <wsdl:service name="S">
    <wsdl:port name="P" binding="tns:B">
      <soap:address location="http://h:8080/svc"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
  const abstract = `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="S">
  <wsdl:binding name="B" type="tns:P">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Op1"><soap:operation soapAction="urn:Op1"/></wsdl:operation>
  </wsdl:binding>
</wsdl:definitions>`;

  it('resolves binding from an imported document', () => {
    const r = parseWsdlBundle(
      { entry: 'service.wsdl', docs: { 'service.wsdl': concrete, 'abstract.wsdl': abstract } },
      { mode: 'per-operation', upstream: { kind: 'auto' } },
    );
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].name).toBe('S.Op1');
  });

  it('warns when an import cannot be resolved', () => {
    const r = parseWsdlBundle(
      { entry: 'service.wsdl', docs: { 'service.wsdl': concrete } },
      { mode: 'passthrough', upstream: { kind: 'auto' } },
    );
    expect(r.warnings.some((w) => w.includes('abstract.wsdl'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: FAIL — current code merges all docs regardless of import graph and emits no unresolved-import warning. (The first test may pass by accident because both docs are merged; the second will fail.)

- [ ] **Step 3: Implement import-following** — in `parseWsdlBundle`, replace the block:

```ts
  // Task 4 replaces this with import-following; for now merge every doc.
  const docKeys = Object.keys(bundle.docs);
  const rawDocs = docKeys.map((k) => bundle.docs[k]);
```

with:

```ts
  const basename = (k: string): string => k.split(/[\\/]/).pop() ?? k;
  const resolveImport = (location: string): string | undefined => {
    if (bundle.docs[location] !== undefined) return location;
    const base = basename(location);
    return Object.keys(bundle.docs).find((k) => basename(k) === base);
  };

  const visited = new Set<string>();
  const rawDocs: string[] = [];
  const queue: string[] = [bundle.entry];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const xmlDoc = bundle.docs[key];
    if (xmlDoc === undefined) continue;
    rawDocs.push(xmlDoc);
    const root = parser.parse(xmlDoc) as Record<string, any>;
    for (const imp of asArray<any>(root.definitions?.import)) {
      const location = String(imp['@_location'] ?? '');
      if (!location) continue;
      const resolved = resolveImport(location);
      if (resolved) queue.push(resolved);
      else warnings.push(`Unresolved wsdl:import '${location}' — supply it in the ZIP/URL bundle.`);
    }
  }
```

Note: `warnings` is declared above this block, so referencing it here is valid. The downstream `for (const xmlDoc of rawDocs)` loop is unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/utils/wsdl-import.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/wsdl-import.ts src/utils/wsdl-import.test.ts
git commit -m "feat(route): follow wsdl:import across multi-file WSDL bundles

Parser now walks from the entry document following wsdl:import (XSD imports
ignored), resolving by exact key then basename, warning on unresolved refs."
```

---

## Task 5: ZIP expansion helper

**Files:**
- Create: `src/utils/wsdl-zip.ts`
- Test: `src/utils/wsdl-zip.test.ts`

**Interfaces:**
- Produces:
  - `const WSDL_ZIP_MAX_FILES = 200`
  - `const WSDL_ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024`
  - `async function expandWsdlZip(data: ArrayBuffer | Uint8Array): Promise<{ entry: string; docs: Record<string, string> }>` — expands `.wsdl`/`.xml` text entries into a docs map; entry is the first `.wsdl` (else first `.xml`); throws on guard breach or when no WSDL/XML files are present.

- [ ] **Step 1: Write the failing test**

`src/utils/wsdl-zip.test.ts` (ASF header + the following). It builds a tiny ZIP in-memory with jszip.

```ts
/** ... ASF header ... */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { expandWsdlZip } from '@/utils/wsdl-zip';

const buildZip = async (files: Record<string, string>): Promise<Uint8Array> => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
};

describe('expandWsdlZip', () => {
  it('expands wsdl/xml entries and picks a .wsdl entry', async () => {
    const buf = await buildZip({
      'service.wsdl': '<definitions/>',
      'types.xsd': '<schema/>',
      'readme.txt': 'ignore me',
    });
    const out = await expandWsdlZip(buf);
    expect(out.entry).toBe('service.wsdl');
    expect(Object.keys(out.docs).sort()).toEqual(['service.wsdl', 'types.xsd']);
    expect(out.docs['readme.txt']).toBeUndefined();
  });

  it('throws when no wsdl/xml files are present', async () => {
    const buf = await buildZip({ 'readme.txt': 'nothing here' });
    await expect(expandWsdlZip(buf)).rejects.toThrow(/no WSDL/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/utils/wsdl-zip.test.ts`
Expected: FAIL — cannot resolve `@/utils/wsdl-zip`.

- [ ] **Step 3: Implement**

`src/utils/wsdl-zip.ts` (ASF header + the following):

```ts
/** ... ASF header ... */
import JSZip from 'jszip';

export const WSDL_ZIP_MAX_FILES = 200;
export const WSDL_ZIP_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const isWsdlLike = (name: string): boolean =>
  /\.(wsdl|xml|xsd)$/i.test(name);

export const expandWsdlZip = async (
  data: ArrayBuffer | Uint8Array,
): Promise<{ entry: string; docs: Record<string, string> }> => {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((f) => !f.dir && isWsdlLike(f.name));

  if (entries.length === 0) {
    throw new Error('No WSDL/XML files found in the ZIP archive.');
  }
  if (entries.length > WSDL_ZIP_MAX_FILES) {
    throw new Error(`ZIP contains too many files (>${WSDL_ZIP_MAX_FILES}).`);
  }

  const docs: Record<string, string> = {};
  let total = 0;
  for (const f of entries) {
    const text = await f.async('string');
    total += text.length;
    if (total > WSDL_ZIP_MAX_TOTAL_BYTES) {
      throw new Error('ZIP expands to too much data; aborting to avoid a zip bomb.');
    }
    docs[f.name] = text;
  }

  const entry =
    entries.find((f) => /\.wsdl$/i.test(f.name))?.name ??
    entries.find((f) => /\.xml$/i.test(f.name))?.name ??
    entries[0].name;

  return { entry, docs };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/utils/wsdl-zip.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/utils/wsdl-zip.ts src/utils/wsdl-zip.test.ts
git commit -m "feat(route): expand multi-file WSDL ZIP bundles in-browser

jszip-based expander with file-count and total-size guards against zip
bombs; picks a .wsdl entry and keeps wsdl/xml/xsd docs for the parser."
```

---

## Task 6: Backend WSDL fetch endpoint (SSRF-guarded, recursive)

**Files:**
- Create: `api/internal/handlers/wsdl.go`
- Test: `api/internal/handlers/wsdl_test.go`
- Modify: `api/cmd/main.go`

**Interfaces:**
- Consumes: `resolveAllowedIP(host string) (net.IP, error)` from `handlers/upstream.go`.
- Produces:
  - `type WsdlHandler struct { ... }` with `func NewWsdlHandler() *WsdlHandler`.
  - `func (h *WsdlHandler) Fetch(c *gin.Context)` serving `GET /api/v1/wsdl/fetch?url=<url>`, returning JSON `{ "entry": <url>, "docs": { <absURL>: <content> }, "warnings": [..] }`.
  - `func parseWsdlImportLocations(xml []byte) []string` (unexported) — returns `location` attrs of `<*:import>` elements.

- [ ] **Step 1: Write the failing tests**

`api/internal/handlers/wsdl_test.go` (Go ASF header + the following):

```go
// ... ASF header ...
package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseWsdlImportLocations(t *testing.T) {
	xml := []byte(`<definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
	  <wsdl:import location="abstract.wsdl"/>
	  <xsd:import schemaLocation="types.xsd"/>
	  <wsdl:import location="http://example.com/other.wsdl"/>
	</definitions>`)
	got := parseWsdlImportLocations(xml)
	if len(got) != 2 || got[0] != "abstract.wsdl" || got[1] != "http://example.com/other.wsdl" {
		t.Fatalf("unexpected locations: %#v", got)
	}
}

func TestFetchRejectsBlockedHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewWsdlHandler()
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url=http://169.254.169.254/latest", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway && w.Code != http.StatusBadRequest {
		t.Fatalf("expected blocked host to fail, got %d", w.Code)
	}
}

func TestFetchRejectsBadScheme(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewWsdlHandler()
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url=file:///etc/passwd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for file scheme, got %d", w.Code)
	}
}

func TestFetchRecursiveHappyPath(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mux := http.NewServeMux()
	mux.HandleFunc("/service.wsdl", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"><wsdl:import location="abstract.wsdl"/></definitions>`))
	})
	mux.HandleFunc("/abstract.wsdl", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<definitions/>`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Test-only handler whose client trusts the loopback test server.
	h := newWsdlHandlerWithClient(srv.Client())
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url="+srv.URL+"/service.wsdl", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Entry string            `json:"entry"`
		Docs  map[string]string `json:"docs"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Docs) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(resp.Docs))
	}
	if !strings.Contains(resp.Docs[resp.Entry], "wsdl:import") {
		t.Fatalf("entry doc missing")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test -C api ./internal/handlers/ -run Wsdl -v` and `... -run Fetch -v`
Expected: FAIL — `wsdl.go` does not exist (compile error).

- [ ] **Step 3: Implement**

`api/internal/handlers/wsdl.go` (Go ASF header + the following):

```go
// ... ASF header ...
package handlers

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	wsdlMaxDocs      = 20
	wsdlMaxDepth     = 5
	wsdlMaxDocBytes  = 5 << 20
	wsdlMaxTotalByte = 20 << 20
	wsdlHTTPTimeout  = 10 * time.Second
)

type WsdlHandler struct {
	client *http.Client
}

// guardedClient dials only IPs that pass resolveAllowedIP, re-checking on every
// connection (including redirects), which also defeats DNS rebinding.
func guardedClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	return &http.Client{
		Timeout: wsdlHTTPTimeout,
		Transport: &http.Transport{
			TLSHandshakeTimeout: 5 * time.Second,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ip, err := resolveAllowedIP(host)
				if err != nil {
					return nil, err
				}
				return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			},
		},
	}
}

func NewWsdlHandler() *WsdlHandler {
	return &WsdlHandler{client: guardedClient()}
}

// newWsdlHandlerWithClient is for tests that target a loopback httptest server.
func newWsdlHandlerWithClient(client *http.Client) *WsdlHandler {
	return &WsdlHandler{client: client}
}

func parseWsdlImportLocations(body []byte) []string {
	var out []string
	dec := xml.NewDecoder(strings.NewReader(string(body)))
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		se, ok := tok.(xml.StartElement)
		if !ok || se.Name.Local != "import" {
			continue
		}
		for _, a := range se.Attr {
			if a.Name.Local == "location" && a.Value != "" {
				out = append(out, a.Value)
			}
		}
	}
	return out
}

func validateWsdlURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("only http and https urls are allowed")
	}
	if u.User != nil {
		return nil, fmt.Errorf("credentials in url are not allowed")
	}
	if u.Host == "" {
		return nil, fmt.Errorf("url has no host")
	}
	return u, nil
}

func (h *WsdlHandler) fetchOne(ctx context.Context, raw string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, wsdlMaxDocBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > wsdlMaxDocBytes {
		return nil, fmt.Errorf("document exceeds %d bytes", wsdlMaxDocBytes)
	}
	return body, nil
}

func (h *WsdlHandler) Fetch(c *gin.Context) {
	raw := c.Query("url")
	entry, err := validateWsdlURL(raw)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	docs := map[string]string{}
	warnings := []string{}
	total := 0

	type item struct {
		u     *url.URL
		depth int
	}
	queue := []item{{u: entry, depth: 0}}
	seen := map[string]bool{}

	for len(queue) > 0 {
		if len(docs) >= wsdlMaxDocs {
			warnings = append(warnings, "import graph truncated: too many documents")
			break
		}
		cur := queue[0]
		queue = queue[1:]
		key := cur.u.String()
		if seen[key] {
			continue
		}
		seen[key] = true

		if _, blockErr := validateWsdlURL(key); blockErr != nil {
			warnings = append(warnings, fmt.Sprintf("skipped %s: %v", key, blockErr))
			continue
		}

		body, fErr := h.fetchOne(ctx, key)
		if fErr != nil {
			if len(docs) == 0 {
				c.JSON(http.StatusBadGateway, gin.H{"error": fErr.Error()})
				return
			}
			warnings = append(warnings, fmt.Sprintf("failed to fetch %s: %v", key, fErr))
			continue
		}

		total += len(body)
		if total > wsdlMaxTotalByte {
			warnings = append(warnings, "import graph truncated: total size limit reached")
			break
		}
		docs[key] = string(body)

		if cur.depth >= wsdlMaxDepth {
			continue
		}
		for _, loc := range parseWsdlImportLocations(body) {
			ref, pErr := url.Parse(loc)
			if pErr != nil {
				continue
			}
			abs := cur.u.ResolveReference(ref)
			if !seen[abs.String()] {
				queue = append(queue, item{u: abs, depth: cur.depth + 1})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"entry":    entry.String(),
		"docs":     docs,
		"warnings": warnings,
	})
}
```

- [ ] **Step 4: Wire the route in `api/cmd/main.go`**

Add the handler constructor next to the others (after line 73, `labelHandler := ...`):

```go
	wsdlHandler := handlers.NewWsdlHandler()
```

Add `wsdlHandler *handlers.WsdlHandler` to the `setupRouter(...)` signature (line 97) and to the call on line 83. Then register the route inside the `protected` group (after the `/test-route` line, ~line 145):

```go
		// WSDL fetch (server-side, SSRF-guarded) for the WSDL importer
		protected.GET("/wsdl/fetch", wsdlHandler.Fetch)
```

- [ ] **Step 5: Run tests + build**

Run: `go test -C api ./internal/handlers/ -run 'Wsdl|Fetch' -v`
Expected: PASS (all 4 tests).

Run: `go build -C api -o ../bin/api ./cmd`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add api/internal/handlers/wsdl.go api/internal/handlers/wsdl_test.go api/cmd/main.go
git commit -m "feat(api): SSRF-guarded recursive WSDL fetch endpoint

Adds GET /api/v1/wsdl/fetch which recursively resolves wsdl:import via a
dial-time IP guard (reuses resolveAllowedIP, defeats DNS rebinding), with
depth/count/size caps. Feeds the client-side WSDL importer for URL sources."
```

---

## Task 7: Frontend fetch helper

**Files:**
- Create: `src/apis/wsdl.ts`

**Interfaces:**
- Consumes: `apiClient` from `@/apis/client`.
- Produces:
  - `type WsdlFetchResponse = { entry: string; docs: Record<string, string>; warnings?: string[] }`
  - `const fetchWsdl = (url: string) => Promise<WsdlFetchResponse>`

- [ ] **Step 1: Write the failing test**

`src/apis/wsdl.test.ts` (ASF header + the following) — verifies the helper calls the right path/params using a stubbed client.

```ts
/** ... ASF header ... */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/apis/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { entry: 'e', docs: { e: '<x/>' } } }),
  },
}));

import { apiClient } from '@/apis/client';
import { fetchWsdl } from '@/apis/wsdl';

describe('fetchWsdl', () => {
  it('GETs the fetch endpoint with the url param', async () => {
    const out = await fetchWsdl('http://h/s?wsdl');
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/wsdl/fetch', {
      params: { url: 'http://h/s?wsdl' },
    });
    expect(out.entry).toBe('e');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/apis/wsdl.test.ts`
Expected: FAIL — `@/apis/wsdl` not found.

- [ ] **Step 3: Implement**

`src/apis/wsdl.ts` (ASF header + the following):

```ts
/** ... ASF header ... */
import { apiClient } from '@/apis/client';

export type WsdlFetchResponse = {
  entry: string;
  docs: Record<string, string>;
  warnings?: string[];
};

export const fetchWsdl = (url: string) =>
  apiClient
    .get<WsdlFetchResponse>('/api/v1/wsdl/fetch', { params: { url } })
    .then((r) => r.data);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/apis/wsdl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apis/wsdl.ts src/apis/wsdl.test.ts
git commit -m "feat(api): fetchWsdl client helper for the WSDL importer"
```

---

## Task 8: i18n strings

**Files:**
- Modify: `src/locales/en/common.json`

**Interfaces:**
- Produces the `form.importWsdl.*` keys consumed by Task 9. `en/common.json` is the source of truth; other locales may stay English for now (ESLint enforces keys exist in `en`).

- [ ] **Step 1: Add the keys** — in `src/locales/en/common.json`, locate the `"form"` object's `"import"` key (around line 118) and add a sibling `"importWsdl"` object immediately after it:

```json
    "importWsdl": {
      "title": "Import from WSDL",
      "description": "Upload a WSDL/ZIP, paste WSDL XML, or fetch from a URL",
      "tabUpload": "Upload / Paste",
      "tabUrl": "From URL",
      "urlPlaceholder": "http://host/service?wsdl",
      "urlLabel": "WSDL URL",
      "fetch": "Fetch",
      "placeholder": "Paste WSDL XML here…",
      "mode": "Output",
      "modePerOperation": "One route per operation",
      "modePassthrough": "Single passthrough route",
      "upstream": "Backend",
      "upstreamExisting": "Use existing upstream ID",
      "upstreamExistingPlaceholder": "upstream id",
      "upstreamAuto": "Auto-create from WSDL address",
      "parse": "Parse",
      "noServices": "No SOAP services found in the WSDL",
      "servicesFound": "{{services}} service(s), {{operations}} operation(s)",
      "warningsTitle": "Warnings",
      "import": "Create {{count}} route(s)",
      "successCount": "{{count}} route(s) created from WSDL",
      "failedCount": "{{count}} route(s) failed to create"
    },
```

- [ ] **Step 2: Verify JSON validity + lint**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/common.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en/common.json
git commit -m "feat(route): i18n strings for the WSDL importer"
```

---

## Task 9: ImportWsdlModal component + wiring

**Files:**
- Create: `src/components/page/ImportWsdlModal.tsx`
- Modify: `src/routes/routes/index.tsx`

**Interfaces:**
- Consumes: `parseWsdlBundle`, `parseWsdlString`, types from `@/utils/wsdl-import`; `expandWsdlZip` from `@/utils/wsdl-zip`; `fetchWsdl` from `@/apis/wsdl`; `req` from `@/config/req`; `API_ROUTES` from `@/config/constant`.
- Produces: `export const ImportWsdlModal: (props: { opened: boolean; onClose: () => void; onSuccess: () => void }) => JSX.Element`.

This task has no unit test (no component-test runner); it is verified by `pnpm lint`, `pnpm build`, and the Task 10 e2e. Keep the structure parallel to `ImportRoutesModal.tsx`.

- [ ] **Step 1: Create the modal**

`src/components/page/ImportWsdlModal.tsx` (ASF header + the following):

```tsx
/** ... ASF header ... */
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  List,
  Modal,
  Radio,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchWsdl } from '@/apis/wsdl';
import { API_ROUTES } from '@/config/constant';
import { req } from '@/config/req';
import {
  parseWsdlBundle,
  type WsdlImportMode,
  type WsdlParseResult,
} from '@/utils/wsdl-import';
import { expandWsdlZip } from '@/utils/wsdl-zip';
import IconError from '~icons/material-symbols/error-outline';
import IconUpload from '~icons/material-symbols/upload';

type ImportWsdlModalProps = {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type Bundle = { entry: string; docs: Record<string, string> };

export const ImportWsdlModal = ({ opened, onClose, onSuccess }: ImportWsdlModalProps) => {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<WsdlImportMode>('per-operation');
  const [upstreamKind, setUpstreamKind] = useState<'existing' | 'auto'>('existing');
  const [upstreamId, setUpstreamId] = useState('');
  const [parseResult, setParseResult] = useState<WsdlParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setContent('');
    setUrlValue('');
    setBundle(null);
    setSourceUrl(undefined);
    setMode('per-operation');
    setUpstreamKind('existing');
    setUpstreamId('');
    setParseResult(null);
    setParseError(null);
    setImporting(false);
    setImportResults(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const clearDerived = () => {
    setParseResult(null);
    setParseError(null);
    setImportResults(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    clearDerived();
    setSourceUrl(undefined);
    try {
      if (/\.zip$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const out = await expandWsdlZip(buf);
        setBundle(out);
        setContent(`[ZIP] ${file.name} — ${Object.keys(out.docs).length} document(s)`);
      } else {
        const text = await file.text();
        setContent(text);
        setBundle({ entry: 'main', docs: { main: text } });
      }
    } catch (err: unknown) {
      setParseError((err as { message?: string })?.message ?? 'Failed to read file');
    }
  };

  const handleFetchUrl = useCallback(async () => {
    clearDerived();
    setBundle(null);
    try {
      const out = await fetchWsdl(urlValue.trim());
      setBundle({ entry: out.entry, docs: out.docs });
      setSourceUrl(urlValue.trim());
      setContent(`[URL] ${urlValue.trim()} — ${Object.keys(out.docs).length} document(s)`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setParseError(e?.response?.data?.error ?? e?.message ?? 'Failed to fetch WSDL');
    }
  }, [urlValue]);

  const effectiveBundle = (): Bundle | null => {
    if (bundle) return bundle;
    if (content.trim() && !content.startsWith('[')) return { entry: 'main', docs: { main: content } };
    return null;
  };

  const handleParse = useCallback(() => {
    clearDerived();
    const b = effectiveBundle();
    if (!b) {
      setParseError(t('form.importWsdl.noServices'));
      return;
    }
    try {
      const result = parseWsdlBundle(b, {
        mode,
        sourceUrl,
        upstream:
          upstreamKind === 'existing'
            ? { kind: 'existing', upstreamId: upstreamId.trim() || undefined }
            : { kind: 'auto' },
      });
      if (result.routes.length === 0) {
        setParseError(t('form.importWsdl.noServices'));
        return;
      }
      setParseResult(result);
    } catch (err: unknown) {
      setParseError((err as { message?: string })?.message ?? t('form.json.parseError'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, content, mode, sourceUrl, upstreamKind, upstreamId, t]);

  const handleImport = useCallback(async () => {
    if (!parseResult) return;
    setImporting(true);
    setImportResults(null);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const route of parseResult.routes) {
      try {
        await req.post(API_ROUTES, route);
        success++;
      } catch (err: unknown) {
        failed++;
        const e = err as { response?: { data?: { error_msg?: string } }; message?: string };
        errors.push(`${route.name ?? route.uri}: ${e?.response?.data?.error_msg ?? e?.message ?? 'Unknown error'}`);
      }
    }
    setImportResults({ success, failed, errors });
    setImporting(false);
    if (success > 0) onSuccess();
  }, [parseResult, onSuccess]);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={<Text fw={600}>{t('form.importWsdl.title')}</Text>}
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">{t('form.importWsdl.description')}</Text>

        <Tabs defaultValue="upload">
          <Tabs.List>
            <Tabs.Tab value="upload">{t('form.importWsdl.tabUpload')}</Tabs.Tab>
            <Tabs.Tab value="url">{t('form.importWsdl.tabUrl')}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="upload" pt="sm">
            <Stack gap="xs">
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<IconUpload width="14" height="14" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('form.btn.upload')}
                </Button>
                <input
                  type="file"
                  accept=".wsdl,.xml,.zip"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  ref={fileInputRef}
                />
              </Group>
              <Textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setBundle(null);
                  setSourceUrl(undefined);
                  clearDerived();
                }}
                placeholder={t('form.importWsdl.placeholder')}
                minRows={8}
                maxRows={14}
                autosize
                styles={{ input: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } }}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="url" pt="sm">
            <Group align="flex-end" gap="sm">
              <TextInput
                style={{ flex: 1 }}
                label={t('form.importWsdl.urlLabel')}
                placeholder={t('form.importWsdl.urlPlaceholder')}
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
              />
              <Button onClick={handleFetchUrl} disabled={!urlValue.trim()}>
                {t('form.importWsdl.fetch')}
              </Button>
            </Group>
          </Tabs.Panel>
        </Tabs>

        <Group gap="lg" align="flex-start">
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t('form.importWsdl.mode')}</Text>
            <SegmentedControl
              value={mode}
              onChange={(v) => {
                setMode(v as WsdlImportMode);
                clearDerived();
              }}
              data={[
                { label: t('form.importWsdl.modePerOperation'), value: 'per-operation' },
                { label: t('form.importWsdl.modePassthrough'), value: 'passthrough' },
              ]}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>{t('form.importWsdl.upstream')}</Text>
            <Radio.Group value={upstreamKind} onChange={(v) => { setUpstreamKind(v as 'existing' | 'auto'); clearDerived(); }}>
              <Group gap="md">
                <Radio value="existing" label={t('form.importWsdl.upstreamExisting')} />
                <Radio value="auto" label={t('form.importWsdl.upstreamAuto')} />
              </Group>
            </Radio.Group>
            {upstreamKind === 'existing' && (
              <TextInput
                placeholder={t('form.importWsdl.upstreamExistingPlaceholder')}
                value={upstreamId}
                onChange={(e) => setUpstreamId(e.target.value)}
              />
            )}
          </Stack>
        </Group>

        {parseError && (
          <Alert variant="light" color="red" icon={<IconError width="16" height="16" />}>
            <Text size="sm">{parseError}</Text>
          </Alert>
        )}

        {parseResult && !importResults && (
          <Stack gap="sm">
            <Group gap="sm">
              <Badge variant="light">{parseResult.soapVersion}</Badge>
              <Text size="sm" fw={500}>
                {t('form.importWsdl.servicesFound', {
                  services: parseResult.serviceCount,
                  operations: parseResult.operationCount,
                })}
              </Text>
            </Group>
            {parseResult.warnings.length > 0 && (
              <Alert variant="light" color="yellow">
                <Text size="sm" fw={500}>{t('form.importWsdl.warningsTitle')}</Text>
                <List size="xs">
                  {parseResult.warnings.map((w, i) => (
                    <List.Item key={i}>{w}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
            <ScrollArea.Autosize mah={200}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('form.basic.name')}</Table.Th>
                    <Table.Th>{t('form.routes.uri')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parseResult.routes.map((route, i) => (
                    <Table.Tr key={i}>
                      <Table.Td><Text size="xs">{route.name ?? '-'}</Text></Table.Td>
                      <Table.Td><Code>{route.uri}</Code></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </Stack>
        )}

        {importResults && (
          <Stack gap="xs">
            {importResults.success > 0 && (
              <Alert variant="light" color="green">
                <Text size="sm">{t('form.importWsdl.successCount', { count: importResults.success })}</Text>
              </Alert>
            )}
            {importResults.failed > 0 && (
              <Alert variant="light" color="red">
                <Stack gap={4}>
                  <Text size="sm">{t('form.importWsdl.failedCount', { count: importResults.failed })}</Text>
                  {importResults.errors.map((err, i) => (
                    <Text key={i} size="xs" c="red">{err}</Text>
                  ))}
                </Stack>
              </Alert>
            )}
          </Stack>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" color="gray" onClick={handleClose}>
            {importResults?.success ? t('form.btn.back') : t('form.btn.cancel')}
          </Button>
          {!importResults && (
            <Button onClick={handleParse} disabled={!content.trim()}>
              {t('form.importWsdl.parse')}
            </Button>
          )}
          {parseResult && !importResults && (
            <Button onClick={handleImport} loading={importing}>
              {t('form.importWsdl.import', { count: parseResult.routes.length })}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
```

- [ ] **Step 2: Wire it into `src/routes/routes/index.tsx`**

Add the import near the `ImportRoutesModal` import:

```tsx
import { ImportWsdlModal } from '@/components/page/ImportWsdlModal';
```

Add state next to `importModalOpen` (~line 540):

```tsx
  const [wsdlModalOpen, setWsdlModalOpen] = useState(false);
```

Add a button next to the existing Import button (~line 628-636 block), guarded by the same `canEdit`:

```tsx
        {canEdit && (
          <Button
            variant="default"
            size="sm"
            leftSection={<IconUpload width="16" height="16" />}
            onClick={() => setWsdlModalOpen(true)}
          >
            {t('form.importWsdl.title')}
          </Button>
        )}
```

Render the modal next to `<ImportRoutesModal ... />` (~line 694):

```tsx
      <ImportWsdlModal
        opened={wsdlModalOpen}
        onClose={() => setWsdlModalOpen(false)}
        onSuccess={refetch}
      />
```

(If `IconUpload` is not already imported in this file, reuse the existing upload icon import used by the OpenAPI import button.)

- [ ] **Step 3: Lint + typecheck/build**

Run: `pnpm lint`
Expected: no errors (fix any import-sort/header issues with `pnpm lint:fix`).

Run: `pnpm build`
Expected: `tsc -b && vite build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/page/ImportWsdlModal.tsx src/routes/routes/index.tsx
git commit -m "feat(route): ImportWsdlModal with mode, source, and upstream controls

Mantine modal mirroring ImportRoutesModal: upload/paste/ZIP or URL source,
per-operation vs passthrough toggle, existing-upstream-id vs auto-create
binding, a preview table with warnings, and per-route creation via the proxy."
```

---

## Task 10: End-to-end test

**Files:**
- Create: `e2e/fixtures/billing.wsdl`
- Create: `e2e/tests/routes.import-wsdl.spec.ts`

**Interfaces:**
- Consumes the running dashboard + backend stack (see CLAUDE.md "Stack bring-up"). Uses the worker-scoped auth fixture in `e2e/utils/test.ts`.

This test requires the full stack (APISIX + etcd + Go backend on :8086 + frontend). It is the behavioral verification for Tasks 9's UI and the parser end-to-end (paste path, no backend fetch needed).

- [ ] **Step 1: Create the fixture**

`e2e/fixtures/billing.wsdl`:

```xml
<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" name="BillingService">
  <wsdl:binding name="BillingBinding" type="tns:BillingPort">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="GetInvoice">
      <soap:operation soapAction="urn:GetInvoice"/>
    </wsdl:operation>
    <wsdl:operation name="PayInvoice">
      <soap:operation soapAction="urn:PayInvoice"/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="BillingService">
    <wsdl:port name="BillingPort" binding="tns:BillingBinding">
      <soap:address location="http://billing-soap:8080/services/Billing"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>
```

- [ ] **Step 2: Write the e2e spec**

`e2e/tests/routes.import-wsdl.spec.ts` (ASF header + the following). Follow the existing spec conventions in `e2e/tests/` for navigation and the auth fixture import path (`@e2e/utils/test`).

```ts
/** ... ASF header ... */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@e2e/utils/test';

const wsdl = readFileSync(
  fileURLToPath(new URL('../fixtures/billing.wsdl', import.meta.url)),
  'utf8',
);

test('imports per-operation routes from pasted WSDL', async ({ page }) => {
  await page.goto('/ui/routes');

  await page.getByRole('button', { name: 'Import from WSDL' }).click();

  // Paste mode, per-operation (default), auto-create upstream.
  await page.getByPlaceholder('Paste WSDL XML here…').fill(wsdl);
  await page.getByLabel('Auto-create from WSDL address').check();
  await page.getByRole('button', { name: 'Parse' }).click();

  // Preview shows 1 service / 2 operations.
  await expect(page.getByText('1 service(s), 2 operation(s)')).toBeVisible();

  await page.getByRole('button', { name: /Create 2 route\(s\)/ }).click();
  await expect(page.getByText('2 route(s) created from WSDL')).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e (requires the stack up)**

Bring the stack up per CLAUDE.md, then:

Run: `pnpm e2e e2e/tests/routes.import-wsdl.spec.ts`
Expected: PASS (1 test).

If selectors differ from the rendered DOM, adjust them to match the actual labels/roles — the assertion targets (service/operation count text, success text) come from the i18n keys in Task 8.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/billing.wsdl e2e/tests/routes.import-wsdl.spec.ts
git commit -m "test(e2e): import per-operation routes from a pasted WSDL"
```

---

## Self-Review Notes

- **Spec coverage:** all spec sections map to tasks — parser/modes (T2-3), multi-file (T4-5), URL fetch + SSRF (T6), provenance labels (T2), error/warnings (T3-4), upstream binding (T2/T9), testing (T1, parser/zip/go/e2e throughout). Deferred items (SOAP-to-REST, WSDL serving, XSD resolution) remain deferred.
- **Provenance label registration:** the spec assumed labels are validated; investigation showed label validation is NOT wired to the proxy create path, so no catalog registration task is needed. Labels pass through. If label validation is later applied to the proxy, register `soap-service` / `wsdl-source-hash` / `wsdl-source-url` per-instance.
- **Upstream binding simplification:** v1 uses a TextInput for an existing upstream ID rather than a populated Select, to avoid a fragile dependency on the upstream-list hook. Functionally equivalent; a Select is a follow-up enhancement.
- **Type consistency:** `parseWsdlBundle`/`parseWsdlString`, `WsdlImportMode`, `UpstreamBinding`, `WsdlParseResult`, `GeneratedRoute`, `expandWsdlZip`, `fetchWsdl`, `WsdlFetchResponse` are used identically across tasks.
```

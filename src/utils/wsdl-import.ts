/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
    const root = parser.parse(xmlDoc) as Record<string, unknown>;
    const defs = (root.definitions ?? {}) as Record<string, unknown>;
    for (const imp of asArray<Record<string, unknown>>(
      defs['import'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
    )) {
      const location = String(imp['@_location'] ?? '');
      if (!location) continue;
      const resolved = resolveImport(location);
      if (resolved) queue.push(resolved);
      else warnings.push(`Unresolved wsdl:import '${location}' — supply it in the ZIP/URL bundle.`);
    }
  }
  const soapVersion = detectSoapVersion(rawDocs);

  // Gather bindings and services across all docs.
  const bindings = new Map<string, { operations: { name: string; soapAction: string }[] }>();
  const services: { name: string; bindingLocal: string; location: string }[] = [];

  for (const xmlDoc of rawDocs) {
    const root = parser.parse(xmlDoc) as Record<string, unknown>;
    const defs = (root.definitions ?? {}) as Record<string, unknown>;

    for (const b of asArray<Record<string, unknown>>(
      defs.binding as Record<string, unknown> | Record<string, unknown>[] | undefined,
    )) {
      const name = String(b['@_name'] ?? '');
      if (!name) continue;
      const operations = asArray<Record<string, unknown>>(
        b.operation as Record<string, unknown> | Record<string, unknown>[] | undefined,
      ).map((op) => ({
        name: String(op['@_name'] ?? ''),
        // child soap:operation is also named 'operation' after NS removal
        soapAction: String(
          asArray<Record<string, unknown>>(
            op.operation as Record<string, unknown> | Record<string, unknown>[] | undefined,
          )[0]?.['@_soapAction'] ?? '',
        ),
      }));
      bindings.set(name, { operations });
    }

    for (const svc of asArray<Record<string, unknown>>(
      defs.service as Record<string, unknown> | Record<string, unknown>[] | undefined,
    )) {
      const svcName = String(svc['@_name'] ?? '');
      for (const port of asArray<Record<string, unknown>>(
        svc.port as Record<string, unknown> | Record<string, unknown>[] | undefined,
      )) {
        const bindingLocal = localName(String(port['@_binding'] ?? ''));
        const addr = asArray<Record<string, unknown>>(
          port.address as Record<string, unknown> | Record<string, unknown>[] | undefined,
        ).find((a) => a?.['@_location']);
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
  }

  return {
    serviceCount: services.length,
    operationCount,
    soapVersion,
    routes,
    warnings,
  };
};

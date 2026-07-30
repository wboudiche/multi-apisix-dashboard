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
import { describe, expect, it } from 'vitest';

import { StreamRoutePostSchema } from '@/components/form-slice/FormPartStreamRoute/schema';

import {
  type ComparableStreamRoute,
  findStreamRouteDuplicates,
} from './stream-route-duplicates';

describe('findStreamRouteDuplicates', () => {
  const existing: ComparableStreamRoute[] = [
    { id: '1', server_addr: '0.0.0.0', server_port: 9100 },
    { id: '2', server_addr: '0.0.0.0', server_port: 9200, sni: 'api.example.com' },
    { id: '3', remote_addr: '10.0.0.0/8' },
  ];

  it('finds a route matching the same address and port', () => {
    const found = findStreamRouteDuplicates(existing, {
      server_addr: '0.0.0.0',
      server_port: 9100,
    });
    expect(found.map((d) => d.id)).toEqual(['1']);
  });

  it('does not match when the port differs', () => {
    expect(
      findStreamRouteDuplicates(existing, {
        server_addr: '0.0.0.0',
        server_port: 9999,
      })
    ).toEqual([]);
  });

  it('treats SNI as part of what makes a route distinct', () => {
    // Same address and port as id 2, but no SNI — a different match condition,
    // so not a duplicate.
    expect(
      findStreamRouteDuplicates(existing, {
        server_addr: '0.0.0.0',
        server_port: 9200,
      })
    ).toEqual([]);
  });

  it('compares SNI case-insensitively, since hostnames are', () => {
    const found = findStreamRouteDuplicates(existing, {
      server_addr: '0.0.0.0',
      server_port: 9200,
      sni: 'API.Example.COM',
    });
    expect(found.map((d) => d.id)).toEqual(['2']);
  });

  it('treats a blank condition the same as an absent one', () => {
    // A form sends "" where the Admin API omits the field; both mean "no
    // constraint", so they have to compare equal.
    const found = findStreamRouteDuplicates(existing, {
      server_addr: '0.0.0.0',
      server_port: 9100,
      sni: '   ',
      remote_addr: '',
    });
    expect(found.map((d) => d.id)).toEqual(['1']);
  });

  it('matches a route whose only condition is a remote address', () => {
    const found = findStreamRouteDuplicates(existing, { remote_addr: '10.0.0.0/8' });
    expect(found.map((d) => d.id)).toEqual(['3']);
  });

  it('reports a wholly unconstrained route as a duplicate of another', () => {
    // Two catch-alls are as indistinguishable as two identical matchers.
    const catchAlls: ComparableStreamRoute[] = [{ id: 'a' }, { id: 'b' }];
    expect(findStreamRouteDuplicates(catchAlls, {}).map((d) => d.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('does not report the route being edited as its own duplicate', () => {
    const found = findStreamRouteDuplicates(
      existing,
      { server_addr: '0.0.0.0', server_port: 9100 },
      '1'
    );
    expect(found).toEqual([]);
  });
});

/**
 * The schema is what the form actually enforces, so these go through it rather
 * than through a helper: APISIX itself accepts an entirely empty stream route
 * with a 201, so this rule is the only thing standing between an empty form and
 * a row of dashes that can never forward traffic.
 */
describe('StreamRoutePostSchema destination rule', () => {
  const destinationError = (value: unknown) => {
    const result = StreamRoutePostSchema.safeParse(value);
    if (result.success) return null;
    return result.error.issues.find((i) => i.path.join('.') === 'upstream_id') ?? null;
  };

  it('rejects an entirely empty stream route', () => {
    expect(destinationError({})).not.toBeNull();
  });

  it('rejects match conditions with nowhere to send the traffic', () => {
    expect(destinationError({ server_addr: '0.0.0.0', server_port: 9100 })).not.toBeNull();
  });

  it('accepts a bound service', () => {
    expect(destinationError({ service_id: 'svc-1' })).toBeNull();
  });

  it('accepts a named upstream', () => {
    expect(destinationError({ upstream_id: 'ups-1' })).toBeNull();
  });

  it('accepts a custom upstream carrying nodes', () => {
    expect(
      destinationError({
        upstream_id: 'custom',
        upstream: { type: 'roundrobin', nodes: [{ host: '127.0.0.1', port: 80, weight: 1 }] },
      })
    ).toBeNull();
  });

  it('rejects the form sentinels on their own', () => {
    // "none" is the service select's empty choice, and "custom" only announces
    // that an inline upstream follows — neither names a destination.
    expect(destinationError({ service_id: 'none', upstream_id: 'custom' })).not.toBeNull();
  });

  it('rejects a custom upstream with no nodes', () => {
    expect(
      destinationError({ upstream_id: 'custom', upstream: { type: 'roundrobin', nodes: [] } })
    ).not.toBeNull();
  });
});

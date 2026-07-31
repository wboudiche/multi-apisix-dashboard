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

/**
 * Finding routes that clash with one being created.
 *
 * A clash is deliberately *not* an error. APISIX happily serves many routes on
 * one path and picks between them by priority and `vars` — a gateway can quite
 * legitimately hold a dozen routes on the same uri and method. So this reports
 * what looks unintended and leaves the decision to the operator; it never
 * decides on its own.
 */

/** The parts of an existing route this comparison needs. */
export type ComparableRoute = {
  id?: string;
  name?: string;
  uri?: string;
  uris?: string[];
  methods?: string[];
};

/** Why a route was flagged. Both can apply at once. */
export type DuplicateReason = 'name' | 'path';

export type RouteDuplicate = {
  id: string;
  name: string;
  uri: string;
  methods?: string[];
  reasons: DuplicateReason[];
};

const normalizeName = (name: string | undefined) => (name ?? '').trim().toLowerCase();

/** Every path a route answers on, whether it uses `uri` or `uris`. */
const pathsOf = (route: ComparableRoute): string[] => {
  const paths = [route.uri, ...(route.uris ?? [])];
  return paths.filter((p): p is string => !!p);
};

/**
 * Two routes share a path when any of their paths match. Methods narrow that:
 * they only clash if they overlap, and a route with no methods answers all of
 * them, so it clashes with everything on that path.
 */
const sharesPath = (a: ComparableRoute, b: ComparableRoute): boolean => {
  const aPaths = pathsOf(a);
  const bPaths = pathsOf(b);
  if (!aPaths.some((p) => bPaths.includes(p))) return false;

  const aMethods = a.methods ?? [];
  const bMethods = b.methods ?? [];
  if (aMethods.length === 0 || bMethods.length === 0) return true;
  return aMethods.some((m) => bMethods.includes(m));
};

/**
 * Routes among `existing` that clash with `candidate`, by name or by path.
 *
 * `excludeID` lets an edit ignore the route being edited. Comparison of names is
 * case-insensitive and trims, because two routes called `Test` and `test ` are
 * indistinguishable in a list.
 */
export const findRouteDuplicates = (
  existing: ComparableRoute[],
  candidate: ComparableRoute,
  excludeID?: string
): RouteDuplicate[] => {
  const candidateName = normalizeName(candidate.name);
  const duplicates: RouteDuplicate[] = [];

  for (const route of existing) {
    if (!route || (excludeID && route.id === excludeID)) continue;

    const reasons: DuplicateReason[] = [];
    if (candidateName && normalizeName(route.name) === candidateName) reasons.push('name');
    if (sharesPath(route, candidate)) reasons.push('path');
    if (reasons.length === 0) continue;

    duplicates.push({
      id: route.id ?? '',
      name: route.name || route.id || '',
      uri: route.uri ?? pathsOf(route)[0] ?? '',
      methods: route.methods,
      reasons,
    });
  }

  return duplicates;
};

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
 * Duplicate detection for stream routes.
 *
 * A stream route has no name and no path — it is identified by the traffic it
 * matches. Two stream routes matching on exactly the same conditions are
 * indistinguishable in effect: only one of them can ever win, and which one
 * does is not something the operator controls. Creating a second is almost
 * always a mistake.
 */

export type ComparableStreamRoute = {
  id?: string;
  server_addr?: string;
  server_port?: number;
  remote_addr?: string;
  sni?: string;
};

export type StreamRouteDuplicate = {
  id?: string;
  server_addr?: string;
  server_port?: number;
  remote_addr?: string;
  sni?: string;
};

/**
 * The match conditions, normalised for comparison.
 *
 * An absent condition and a blank one mean the same thing to APISIX — no
 * constraint — so they have to compare equal, otherwise a route saved from a
 * form (which sends "") would never look like a duplicate of one created
 * through the Admin API (which omits the field).
 */
const conditionsOf = (route: ComparableStreamRoute) => ({
  serverAddr: (route.server_addr || '').trim(),
  serverPort: route.server_port ?? null,
  remoteAddr: (route.remote_addr || '').trim(),
  // SNI is a hostname, and hostnames are case-insensitive.
  sni: (route.sni || '').trim().toLowerCase(),
});

/**
 * Reports whether two stream routes match exactly the same traffic.
 */
const sameConditions = (
  a: ComparableStreamRoute,
  b: ComparableStreamRoute
): boolean => {
  const x = conditionsOf(a);
  const y = conditionsOf(b);
  return (
    x.serverAddr === y.serverAddr &&
    x.serverPort === y.serverPort &&
    x.remoteAddr === y.remoteAddr &&
    x.sni === y.sni
  );
};

/**
 * Finds existing stream routes that match the same traffic as `candidate`.
 *
 * `excludeID` keeps an edit from reporting the route being edited as its own
 * duplicate.
 */
export const findStreamRouteDuplicates = (
  existing: ComparableStreamRoute[],
  candidate: ComparableStreamRoute,
  excludeID?: string
): StreamRouteDuplicate[] =>
  existing
    .filter((route) => !excludeID || route.id !== excludeID)
    .filter((route) => sameConditions(route, candidate))
    .map((route) => ({
      id: route.id,
      server_addr: route.server_addr,
      server_port: route.server_port,
      remote_addr: route.remote_addr,
      sni: route.sni,
    }));

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
 * Where the e2e stack answers, in one place.
 *
 * Each address was written out where it was needed - global-setup, the etcd
 * client, four specs - so moving a published port meant finding every copy. One
 * of them was missed: routes.proxy-e2e.spec.ts asked 9181 whatever was set
 * (#344).
 *
 * An address is built from the port the compose file publishes, so setting
 * E2E_ADMIN_PORT alone is enough. The URL variables stay, and still win, for a
 * run whose stack is not on this host at all - a docker-network run reaches the
 * gateway by service name rather than by 127.0.0.1.
 */

/** The defaults the compose file publishes; e2e/utils/compose-ports.test.ts holds it to them. */
export const PORT_DEFAULTS = {
  E2E_GATEWAY_PORT: 9080,
  E2E_ADMIN_PORT: 9180,
  E2E_CONTROL_PORT: 9090,
  E2E_ADMIN2_PORT: 9181,
  E2E_ETCD_PORT: 2379,
} as const;

type PortVar = keyof typeof PORT_DEFAULTS;

const at = (urlVar: string, portVar: PortVar) => {
  const url = process.env[urlVar];
  if (url) return url;
  const port = process.env[portVar] ?? PORT_DEFAULTS[portVar];
  return `http://127.0.0.1:${port}`;
};

export const stack = {
  /** The first gateway's Admin API. */
  adminApi: at('E2E_LOCAL_APISIX_URL', 'E2E_ADMIN_PORT'),
  /** The second gateway's Admin API - "Staging APISIX" to the dashboard. */
  stagingAdminApi: at('E2E_STAGING_APISIX_URL', 'E2E_ADMIN2_PORT'),
  /** The first gateway itself, which a route test sends its request through. */
  gateway: at('E2E_LOCAL_GATEWAY_URL', 'E2E_GATEWAY_PORT'),
  /** The first gateway's Control API. The second publishes none, on purpose. */
  controlApi: at('E2E_LOCAL_CONTROL_URL', 'E2E_CONTROL_PORT'),
  /** The dashboard's etcd, for specs that write what the API no longer can. */
  etcd: at('E2E_ETCD_URL', 'E2E_ETCD_PORT'),
} as const;

/** The admin key both gateways in the e2e stack share (e2e/server/apisix_conf.yml). */
export const APISIX_ADMIN_KEY = 'edd1c9f034335f136f87ad84b625c8f1';

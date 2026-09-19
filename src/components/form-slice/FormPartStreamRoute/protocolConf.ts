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
 * What a stream route's `protocol.conf` takes, per protocol (#141).
 *
 * The Admin API's own schema for a stream route describes `conf` as
 * `{"type": "object", "description": "protocol-specific configuration"}` and
 * stops there - no properties, nothing to build fields from. The shapes are in
 * each protocol's own schema inside APISIX
 * (`apisix/stream/xrpc/protocols/<name>/schema.lua`), which the gateway does
 * not serve.
 *
 * So these are examples, not a contract, and the page says so. The gateway
 * remains the judge: it validates `conf` against its own build, which may be a
 * newer APISIX than the one these were read from (3.x, where redis takes
 * `faults` and dubbo takes nothing at all).
 *
 * A protocol with no entry gets no example, which is the honest answer for one
 * this dashboard has never heard of - including anything reached through the
 * form's "custom" option.
 */
export type ProtocolConfHelp = {
  /**
   * The i18n key for what this protocol's `conf` is for. Spelled out as a
   * union rather than a string, because the catalogue is typed: a key built at
   * runtime is one the compiler cannot check, and a typo would surface as a
   * missing string rather than a build failure - the same reason
   * ListWarningBanner names its codes one by one.
   */
  noteKey:
    | 'form.streamRoutes.protocol.confHelp.redis'
    | 'form.streamRoutes.protocol.confHelp.dubbo';
  /**
   * A configuration that this protocol accepts, offered for the operator to
   * start from. Absent when the protocol takes no configuration of its own:
   * there is nothing to insert, and an empty object would suggest otherwise.
   */
  example?: Record<string, unknown>;
};

export const PROTOCOL_CONF_HELP: Record<string, ProtocolConfHelp> = {
  // faults: a list of delays to inject, each naming the commands it applies to
  // and how long in seconds. `commands` and `delay` are required; `key`
  // narrows it to one key.
  redis: {
    noteKey: 'form.streamRoutes.protocol.confHelp.redis',
    example: {
      faults: [{ commands: ['GET', 'MGET'], key: 'hello', delay: 5 }],
    },
  },
  // An empty object in the gateway's schema: dubbo's xRPC takes no
  // configuration of its own, so the field is left empty rather than filled
  // with something that only looks like configuration.
  dubbo: {
    noteKey: 'form.streamRoutes.protocol.confHelp.dubbo',
  },
};

/** What to say about a protocol's `conf`, or nothing for one we do not know. */
// An own-property check rather than a plain lookup: a custom protocol named
// "constructor" or "toString" would otherwise find something on the prototype
// chain and render a note with no text in it. (Object.hasOwn needs a newer lib
// than this tsconfig targets.)
export const protocolConfHelp = (name: string): ProtocolConfHelp | undefined =>
  Object.prototype.hasOwnProperty.call(PROTOCOL_CONF_HELP, name)
    ? PROTOCOL_CONF_HELP[name]
    : undefined;

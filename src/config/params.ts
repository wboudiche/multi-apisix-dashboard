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
import { stringify } from 'qs';

/**
 * The query string for a resource request.
 *
 * Two quirks it owes the gateway: APISIX takes `filter` as a string of its own
 * encoding rather than as nested params, and repeatable filters have to be
 * repeated (`?label=a&label=b`) rather than bracketed.
 *
 * Pure, and that is the point rather than a nicety. axios hands the serializer
 * the same `config.params` object every time it sends a request, and a retry
 * reuses `err.config` — so writing the encoded filter back into it meant the
 * second call saw a `filter` that was already a string, and `qs.stringify` of a
 * string is ''. The retry dropped the filter and the caller was shown an
 * unfiltered list as if it were the filtered one: a service's page listing
 * every route on the gateway as its own.
 */
export const serializeParams = (params: Record<string, unknown>): string => {
  const encoded = params.filter
    ? { ...params, filter: stringify(params.filter) }
    : params;

  return stringify(encoded, { arrayFormat: 'repeat' });
};

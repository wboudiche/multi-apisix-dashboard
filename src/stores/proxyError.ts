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

import { atom } from 'jotai';

export type ProxyError = {
  instanceId: string;
  status: number;
  message: string;
} | null;

// Set by the axios response interceptor in src/config/req.ts when a proxy
// call to an APISIX instance returns 502/504 (the dashboard backend reached
// us but couldn't reach the gateway). Cleared on retry/dismiss and on the
// next successful proxy response.
export const proxyErrorAtom = atom<ProxyError>(null);

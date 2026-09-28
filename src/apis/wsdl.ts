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

import { apiClient } from '@/apis/client';

export type WsdlFetchResponse = {
  entry: string;
  docs: Record<string, string>;
  warnings?: string[];
};

/**
 * Follows the WSDL's imports on the dashboard's side.
 *
 * The signal is how a caller that has given up says so: the graph can run to
 * twenty documents at ten seconds apiece, and the request holds one of the
 * dashboard's outbound slots for all of it (#310, #331). Abandoned rather than
 * aborted, it spends them for an answer nobody will read - and can refuse the
 * same operator's next attempt (#336).
 */
export const fetchWsdl = (url: string, signal?: AbortSignal) =>
  apiClient
    .get<WsdlFetchResponse>('/api/v1/wsdl/fetch', { params: { url }, signal })
    .then((r) => r.data);

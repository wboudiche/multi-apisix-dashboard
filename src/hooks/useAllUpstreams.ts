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
import { useQuery } from '@tanstack/react-query';

import { getUpstreamListReq } from '@/apis/upstreams';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';

/**
 * The whole upstream list for an instance, fetched once.
 *
 * Both the routes table (which resolves upstream ids to names) and its filter
 * bar (which offers them) need it. Declared in one place so there is one query
 * key rather than two to keep in step — upstreams live on the gateway, so the
 * key carries the instance or switching instance would resolve ids against the
 * names of the one just left.
 *
 * `enabled` exists because the column can be switched off, and is off entirely
 * on the routes list nested under a service.
 */
export const useAllUpstreams = (instanceId: string, enabled = true) =>
  useQuery({
    queryKey: ['upstreams', instanceId, 'all'],
    queryFn: () => getUpstreamListReq(req, { page: 1, page_size: PAGE_SIZE_MAX }),
    staleTime: 60_000,
    enabled,
  });

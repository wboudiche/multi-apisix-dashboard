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

import { getServiceListReq } from '@/apis/services';
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

/**
 * The whole service list for an instance, on the same terms.
 *
 * The routes table needs it to tell which upstream a route reaches through its
 * service. Declared beside its sibling for the reason that one exists: written
 * inline, the key shape and staleTime were repeated by hand and the next
 * consumer would have copied them again.
 */
export const useAllServices = (instanceId: string, enabled = true) =>
  useQuery({
    queryKey: ['services', instanceId, 'all'],
    queryFn: () => getServiceListReq(req, { page: 1, page_size: PAGE_SIZE_MAX }),
    staleTime: 60_000,
    enabled,
  });

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
import { MutationCache, QueryClient } from '@tanstack/react-query';

/**
 * Who holds a credential of each auth plugin, as the plugin forms list it.
 * Read with one request per consumer, it is kept a minute rather than read
 * again each time a form opens. A write that changes who holds what marks it
 * stale: a mutation carrying `meta: CHANGES_CLIENTS` - a consumer or a
 * credential made or changed - and, today, every delete, since those
 * invalidate every query. A change made outside this tab shows within the
 * minute, and the form that makes a client reads the gateway, not this list.
 */
export const AUTH_CLIENTS_QUERY = 'auth-clients';
export const AUTH_CLIENTS_STALE_MS = 60 * 1000;
export const CHANGES_CLIENTS = { changesClients: true } as const;

// Kept apart from the router (src/config/global.ts), so that the session store
// can empty it at logout without importing every route.
export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Not awaited: an open form reads its clients again, and the write that
    // made it so is not to wait for that.
    onSuccess: (_data, _vars, _ctx, mutation) => {
      if (mutation.meta?.changesClients) {
        void queryClient.invalidateQueries({ queryKey: [AUTH_CLIENTS_QUERY] });
      }
    },
  }),
});

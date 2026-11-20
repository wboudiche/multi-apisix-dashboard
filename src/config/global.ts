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
import { createRouter } from '@tanstack/react-router';

import { routeTree } from '@/routeTree.gen';

import { BASE_PATH } from './constant';

export const router = createRouter({ routeTree, basepath: BASE_PATH });

export type Router = typeof router;

/**
 * Who holds a credential of each auth plugin, as the plugin forms list it.
 * Read with one request per consumer, it is kept rather than read again each
 * time a form opens, and marked stale after every write that succeeds - a
 * consumer or a credential made, changed or removed anywhere in the app.
 */
export const AUTH_CLIENTS_QUERY = 'auth-clients';
export const AUTH_CLIENTS_STALE_MS = 5 * 60 * 1000;

export const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Not awaited: an open form reads its clients again, and the write that
    // made it so is not to wait for that.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [AUTH_CLIENTS_QUERY] });
    },
  }),
});

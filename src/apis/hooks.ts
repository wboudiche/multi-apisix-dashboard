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
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { getDefaultStore, useAtomValue } from 'jotai';

import { getRouteListReq, getRouteReq } from '@/apis/routes';
import { getUpstreamListReq, getUpstreamReq } from '@/apis/upstreams';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { reqFor } from '@/config/req';
import { currentInstanceIdAtom } from '@/stores/instance';
import type {
  APISIXDetailResponse,
  APISIXListResponse,
} from '@/types/schema/apisix/type';
import { type PageSearchType } from '@/types/schema/pageSearch';
import { useSearchParams } from '@/utils/useSearchParams';
import {
  type ListPageKeys,
  useTablePagination,
} from '@/utils/useTablePagination';

import {
  getConsumerGroupListReq,
  getConsumerGroupReq,
} from './consumer_groups';
import { getConsumerListReq, getConsumerReq } from './consumers';
import { getCredentialListReq, getCredentialReq } from './credentials';
import { getGlobalRuleListReq, getGlobalRuleReq } from './global_rules';
import { getPluginConfigListReq, getPluginConfigReq } from './plugin_configs';
import { getProtoListReq, getProtoReq } from './protos';
import { getSecretListReq, getSecretReq } from './secrets';
import { getServiceListReq, getServiceReq } from './services';
import { getSSLListReq, getSSLReq } from './ssls';
import { getStreamRouteListReq, getStreamRouteReq } from './stream_routes';

// Treat proxy-unreachable errors (the dashboard backend couldn't reach the
// gateway) as "empty data" at the query layer so route loaders don't throw
// into the router's error boundary. The axios interceptor in src/config/req.ts
// has already set the proxyErrorAtom, so the persistent banner renders
// above the page while the page itself shows an empty list/detail.
// A gateway the dashboard cannot currently use, as opposed to a request that
// failed. The list resolves empty and ProxyErrorBanner explains why — an empty
// table under a banner naming the instance, rather than a dashboard-wide error
// screen that says nothing about which gateway or what to do.
//
// 401 is here because the proxy relays APISIX's status verbatim: it means the
// instance's admin key was refused. The dashboard's own session rejections are
// marked and handled in req.ts long before this, so a 401 arriving here is
// always the gateway's.
export const isProxyUnreachable = (err: unknown) => {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 502 || status === 504 || status === 401;
};

/** The instance has no such record. */
export const isNotFound = (err: unknown) =>
  (err as { response?: { status?: number } })?.response?.status === 404;

// This tab's selected instance, read as the request interceptor reads it: the
// atom, which is this tab's own, and localStorage only before the atom has
// one. localStorage alone is every tab's — another tab switching writes it and
// nothing here listens — so keying on it gave this tab another tab's instance,
// while this tab's saves, addressed from the atom, went to its own.
export const selectedInstance = () =>
  getDefaultStore().get(currentInstanceIdAtom)
  || localStorage.getItem('instance:current_id')
  || '';

const genDetailQueryOptions =
  <T extends unknown[], R>(
    key: string,
    getDetailReq: (
      req: AxiosInstance,
      ...args: T
    ) => Promise<APISIXDetailResponse<R>>
  ) =>
    (...args: T) => {
      // A record is one instance's, so the instance is in the key and the
      // request goes to it: a refetch that runs after a switch — a save's, on
      // a page already unmounted — must still ask that instance (#187). Read
      // when the options are built; DetailGate remounts a detail page on a
      // switch, so that build already sees the instance switched to.
      const instanceId = selectedInstance();
      return queryOptions({
        queryKey: [key, instanceId, ...args],
        queryFn: async () => {
          try {
            // A 404 is DetailGate's to explain, not a toast's.
            return await getDetailReq(
              reqFor(instanceId, { [SKIP_INTERCEPTOR_HEADER]: ['404'] }),
              ...args
            );
          } catch (err) {
            if (isProxyUnreachable(err)) {
              return { value: {} } as APISIXDetailResponse<R>;
            }
            throw err;
          }
        },
        // Not there is not a failure that heals: retrying only holds the page
        // on a skeleton for seven seconds before saying so.
        retry: (failureCount, err) => !isNotFound(err) && failureCount < 3,
      });
    };
/** simple factory func for list query options which support extends PageSearchType */
const genListQueryOptions =
  <P extends PageSearchType, R>(
    key: string,
    listReq: (req: AxiosInstance, props: P) => Promise<APISIXListResponse<R>>
  ) =>
    (props: P, instanceIdOverride?: string) => {
      // The hook passes the instance it reads reactively; loaders pass none and
      // get this tab's selected instance.
      const instanceId = instanceIdOverride ?? selectedInstance();
      return queryOptions({
        queryKey: [key, instanceId, props],
        queryFn: async () => {
          // Skip the API call when no APISIX instance is selected yet.
          // This prevents the route loader from throwing before the Header mounts.
          if (!instanceId) {
            return { list: [], total: 0 } as APISIXListResponse<R>;
          }
          try {
            // Answered by the instance in the key, whichever is selected when
            // the query runs (#187).
            return await listReq(reqFor(instanceId), props);
          } catch (err) {
            if (isProxyUnreachable(err)) {
              return { list: [], total: 0 } as APISIXListResponse<R>;
            }
            throw err;
          }
        },
      });
    };

/** simple hook factory func for list hooks which support extends PageSearchType */
export const genUseList = <
  T extends ListPageKeys,
  U extends ListPageKeys,
  P extends PageSearchType,
  R
>(
  routeKey: T,
  listQueryOptions: ReturnType<typeof genListQueryOptions<P, R>>
) => {
  return (replaceKey?: U, defaultParams?: Partial<P>) => {
    const key = replaceKey || routeKey;
    const { params, setParams } = useSearchParams<T | U, P>(key);
    // Reactively read instance ID — triggers a query key change when the user
    // switches instances in the Header, causing an automatic data refetch.
    const currentInstanceId = useAtomValue(currentInstanceIdAtom);
    const listQuery = useSuspenseQuery(
      listQueryOptions({ ...defaultParams, ...params } as P, currentInstanceId)
    );
    const { data, isLoading, refetch } = listQuery;
    const opts = { data, setParams, params };
    const pagination = useTablePagination(opts);
    return { data, isLoading, refetch, pagination, setParams };
  };
};

export type UseListReturn<
  T extends ListPageKeys,
  U extends ListPageKeys,
  P extends PageSearchType,
  R
> = ReturnType<ReturnType<typeof genUseList<T, U, P, R>>>;

export const getUpstreamQueryOptions = genDetailQueryOptions(
  'upstream',
  getUpstreamReq
);
export const getUpstreamListQueryOptions = genListQueryOptions(
  'upstreams',
  getUpstreamListReq
);
export const useUpstreamList = genUseList(
  '/upstreams/',
  getUpstreamListQueryOptions
);

export const getRouteQueryOptions = genDetailQueryOptions('route', getRouteReq);
export const getRouteListQueryOptions = genListQueryOptions(
  'routes',
  getRouteListReq
);
export const useRouteList = genUseList('/routes/', getRouteListQueryOptions);

export const getConsumerGroupQueryOptions = genDetailQueryOptions(
  'consumer_group',
  getConsumerGroupReq
);
export const getConsumerGroupListQueryOptions = genListQueryOptions(
  'consumer_groups',
  getConsumerGroupListReq
);
export const useConsumerGroupList = genUseList(
  '/consumer_groups/',
  getConsumerGroupListQueryOptions
);

export const getStreamRouteQueryOptions = genDetailQueryOptions(
  'stream_route',
  getStreamRouteReq
);
export const getStreamRouteListQueryOptions = genListQueryOptions(
  'stream_routes',
  getStreamRouteListReq
);
export const useStreamRouteList = genUseList(
  '/stream_routes/',
  getStreamRouteListQueryOptions
);

export const getServiceQueryOptions = genDetailQueryOptions(
  'service',
  getServiceReq
);
export const getServiceListQueryOptions = genListQueryOptions(
  'services',
  getServiceListReq
);
export const useServiceList = genUseList(
  '/services/',
  getServiceListQueryOptions
);

export const getGlobalRuleQueryOptions = genDetailQueryOptions(
  'global_rule',
  getGlobalRuleReq
);
export const getGlobalRuleListQueryOptions = genListQueryOptions(
  'global_rules',
  getGlobalRuleListReq
);
export const useGlobalRuleList = genUseList(
  '/global_rules/',
  getGlobalRuleListQueryOptions
);

export const getPluginConfigQueryOptions = genDetailQueryOptions(
  'plugin_config',
  getPluginConfigReq
);
export const getPluginConfigListQueryOptions = genListQueryOptions(
  'plugin_configs',
  getPluginConfigListReq
);
export const usePluginConfigList = genUseList(
  '/plugin_configs/',
  getPluginConfigListQueryOptions
);

export const getSSLQueryOptions = genDetailQueryOptions('ssl', getSSLReq);
export const getSSLListQueryOptions = genListQueryOptions('ssls', getSSLListReq);
export const useSSLList = genUseList('/ssls/', getSSLListQueryOptions);

export const getConsumerQueryOptions = genDetailQueryOptions(
  'consumer',
  getConsumerReq
);
export const getConsumerListQueryOptions = genListQueryOptions(
  'consumers',
  getConsumerListReq
);
export const useConsumerList = genUseList(
  '/consumers/',
  getConsumerListQueryOptions
);

export const getCredentialQueryOptions = genDetailQueryOptions(
  'credential',
  getCredentialReq
);
export const getCredentialListQueryOptions = (username: string) => {
  // A consumer's credentials are one instance's, like the consumer (#187).
  const instanceId = selectedInstance();
  return queryOptions({
    queryKey: ['credentials', instanceId, username],
    queryFn: () => getCredentialListReq(reqFor(instanceId), { username }),
  });
};
export const useCredentialsList = (username: string) => {
  const credentialQuery = useSuspenseQuery(
    getCredentialListQueryOptions(username)
  );
  const { data, isLoading, refetch } = credentialQuery;
  return { data, isLoading, refetch };
};

export const getProtoQueryOptions = genDetailQueryOptions('proto', getProtoReq);
export const getProtoListQueryOptions = genListQueryOptions('protos', getProtoListReq);
export const useProtoList = genUseList('/protos/', getProtoListQueryOptions);

export const getSecretQueryOptions = genDetailQueryOptions(
  'secret',
  getSecretReq
);
export const getSecretListQueryOptions = genListQueryOptions(
  'secrets',
  getSecretListReq
);
export const useSecretList = genUseList('/secrets/', getSecretListQueryOptions);

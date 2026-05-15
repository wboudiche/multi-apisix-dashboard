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

import { notifications } from '@mantine/notifications';
import axios, { AxiosError, type AxiosResponse, HttpStatusCode } from 'axios';
import { getDefaultStore } from 'jotai';
import { stringify } from 'qs';

import {
  API_PREFIX,
  SKIP_INTERCEPTOR_HEADER,
} from '@/config/constant';
import { currentInstanceIdAtom } from '@/stores/instance';
import { proxyErrorAtom } from '@/stores/proxyError';

export const req = axios.create();

req.interceptors.request.use((conf) => {
  conf.paramsSerializer = (p) => {
    // from { filter: { service_id: 1 } }
    // to `filter=service_id%3D1`
    if (p.filter) {
      p.filter = stringify(p.filter);
    }
    return stringify(p, {
      arrayFormat: 'repeat',
    });
  };
  if (!conf.baseURL) {
    conf.baseURL = API_PREFIX;
  }

  // Get JWT token and add Authorization header for backend auth
  const token = localStorage.getItem('auth:access_token');
  if (token) {
    conf.headers.set('Authorization', `Bearer ${token}`);
  }

  // Get current instance ID and add it as header for proxy requests
  // Fall back to localStorage directly in case the atom hasn't been hydrated yet
  // (e.g. when TanStack Router loaders fire before the Header component mounts)
  const instanceId = getDefaultStore().get(currentInstanceIdAtom)
    || localStorage.getItem('instance:current_id')
    || '';
  if (instanceId) {
    conf.headers.set('X-Instance-ID', instanceId);
  }

  // Get current team ID for admin team switching
  const teamId = localStorage.getItem(`team:current_id:${instanceId}`) || '';
  if (teamId) {
    conf.headers.set('X-Team-ID', teamId);
  }

  return conf;
});

export type APISIXRespErr = {
  error_msg?: string;
  message?: string;
};

/**
 * use request header `[SKIP_INTERCEPTOR_HEADER]: ['404', ...]` to skip interceptor for specific status code.
 */
const matchSkipInterceptor = (err: AxiosError) => {
  const interceptors = err.config?.headers?.[SKIP_INTERCEPTOR_HEADER] || [];
  const status = err.response?.status;
  return interceptors.some((v: string) => v === String(status));
};

// A proxy path is one that the Go backend forwards to a specific APISIX
// instance — those are the only requests whose failure means "the gateway
// is unreachable" rather than "the dashboard is broken". The `req` axios
// instance is configured with baseURL = '/api/v1/apisix/admin', so we
// check baseURL (typed `url` here is the relative path like `/routes`).
const isProxyRequest = (config?: { url?: string; baseURL?: string }) => {
  const full = `${config?.baseURL || ''}${config?.url || ''}`;
  return full.includes('/apisix/admin');
};

req.interceptors.response.use(
  (res) => {
    // it's a apisix design
    // when list is empty, it will be a object
    // but we need a array
    if (
      res.data?.list &&
      !Array.isArray(res.data.list) &&
      Object.keys(res.data.list).length === 0
    ) {
      res.data.list = [];
    }
    // A successful proxy response means the gateway is reachable again;
    // clear any stale banner state.
    if (isProxyRequest(res.config)) {
      const store = getDefaultStore();
      if (store.get(proxyErrorAtom)) store.set(proxyErrorAtom, null);
    }
    return res;
  },
  (err) => {
    if (err.response) {
      if (matchSkipInterceptor(err)) return Promise.reject(err);
      const res = err.response as AxiosResponse<APISIXRespErr>;
      const status = res.status;
      const proxy = isProxyRequest(err.config);

      // Proxy 502/504 = the dashboard backend couldn't reach the configured
      // APISIX. Route this through the persistent banner instead of a toast
      // so the user has retry/edit affordances; suppress the toast to avoid
      // a duplicate signal.
      if (proxy && (status === HttpStatusCode.BadGateway || status === HttpStatusCode.GatewayTimeout)) {
        const store = getDefaultStore();
        const instanceId = store.get(currentInstanceIdAtom)
          || localStorage.getItem('instance:current_id')
          || '';
        store.set(proxyErrorAtom, {
          instanceId,
          status,
          message: res.data?.error_msg || res.data?.message || '',
        });
        return Promise.reject(err);
      }

      const d = res.data;
      notifications.show({
        id: d?.error_msg || d?.message,
        message: d?.error_msg || d?.message,
        color: 'red',
      });
      if (status === HttpStatusCode.Unauthorized) {
        return Promise.resolve({ data: {} });
      }
    }
    return Promise.reject(err);
  }
);

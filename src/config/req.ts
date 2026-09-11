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
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  HttpStatusCode,
} from 'axios';
import { getDefaultStore } from 'jotai';

import {
  endSession,
  isSessionInvalid,
  refreshSession,
  SessionOverError,
} from '@/apis/session';
import {
  API_PREFIX,
  SKIP_INTERCEPTOR_HEADER,
} from '@/config/constant';
import i18n from '@/config/i18n';
import { serializeParams } from '@/config/params';
import { currentInstanceIdAtom } from '@/stores/instance';
import { proxyErrorAtom } from '@/stores/proxyError';
import {
  assertJsonBody,
  MalformedResponseError,
} from '@/utils/response-shape';

/**
 * Marks a PUT as a create that must not overwrite anything.
 *
 * APISIX's PUT is an upsert, so an Add form submitting an id that already exists
 * silently replaces that record and still reports success. Add flows pass this;
 * Edit flows do not, because overwriting is what editing is. The Go proxy
 * enforces it — see createOnlyRequested in handlers/proxy.go.
 */
export const CREATE_ONLY = { headers: { 'If-None-Match': '*' } } as const;

export const req = axios.create();

req.interceptors.request.use((conf) => {
  conf.paramsSerializer = serializeParams;
  if (!conf.baseURL) {
    conf.baseURL = API_PREFIX;
  }

  // Get JWT token and add Authorization header for backend auth
  const token = localStorage.getItem('auth:access_token');
  if (token) {
    conf.headers.set('Authorization', `Bearer ${token}`);
  }

  // The instance a caller names wins; otherwise the one selected now. A query
  // keyed on an instance has to be answered by that instance even when it runs
  // after a switch — a retry, or a refetch from a page already unmounted — or
  // it writes one instance's answer under the other's key (#180).
  // Fall back to localStorage directly in case the atom hasn't been hydrated yet
  // (e.g. when TanStack Router loaders fire before the Header component mounts)
  const named = conf.headers.get('X-Instance-ID');
  const instanceId = (typeof named === 'string' && named)
    || getDefaultStore().get(currentInstanceIdAtom)
    || localStorage.getItem('instance:current_id')
    || '';
  if (instanceId) {
    conf.headers.set('X-Instance-ID', instanceId);
  }

  // The team selected on that instance, for admin team switching
  const teamId = localStorage.getItem(`team:current_id:${instanceId}`) || '';
  if (teamId) {
    conf.headers.set('X-Team-ID', teamId);
  }

  return conf;
});

type Headers = Record<string, unknown>;
type Read = (url: string, config?: AxiosRequestConfig) => Promise<unknown>;
type Write = (
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
) => Promise<unknown>;

/**
 * `req`, with every request addressed to `instanceId` rather than to whichever
 * instance is selected when it runs.
 *
 * A query keyed on an instance has to be answered by that instance. A retry,
 * or a refetch from a page already unmounted, runs after a switch; addressed
 * to the instance selected by then, it would store one instance's answer under
 * the other's key, to be shown there later (#187). The resource request
 * functions take their client as an argument, so a query hands them this one.
 * `headers` go along — a query that expects a 404 can skip its toast.
 *
 * An empty id names no instance: those requests go to the selected one.
 */
export const reqFor = (
  instanceId: string,
  headers: Headers = {}
): AxiosInstance => {
  const named: Headers = instanceId
    ? { ...headers, 'X-Instance-ID': instanceId }
    : headers;
  if (Object.keys(named).length === 0) return req;

  const withNamed = (config?: AxiosRequestConfig): AxiosRequestConfig => ({
    ...config,
    headers: {
      ...(config?.headers as Headers | undefined),
      ...named,
    } as AxiosRequestConfig['headers'],
  });

  return new Proxy(req, {
    get(target, prop, receiver) {
      switch (prop) {
        case 'request':
          return (config: AxiosRequestConfig) =>
            target.request(withNamed(config));
        case 'get':
        case 'delete':
        case 'head':
        case 'options':
          return (url: string, config?: AxiosRequestConfig) =>
            (target[prop] as Read)(url, withNamed(config));
        case 'post':
        case 'put':
        case 'patch':
        case 'postForm':
        case 'putForm':
        case 'patchForm':
          return (url: string, data?: unknown, config?: AxiosRequestConfig) =>
            (target[prop] as Write)(url, data, withNamed(config));
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
    apply: (target, _this, [config]: [AxiosRequestConfig]) =>
      target.request(withNamed(config)),
  });
};

/**
 * The instance a request was addressed to. The request interceptor above
 * always writes it into the headers when there is one.
 */
const addressedTo = (config?: { headers?: unknown }): string => {
  const { headers } = config ?? {};
  const named =
    headers instanceof AxiosHeaders
      ? headers.get('X-Instance-ID')
      : (headers as Headers | undefined)?.['X-Instance-ID'];
  if (typeof named === 'string' && named) return named;
  return getDefaultStore().get(currentInstanceIdAtom)
    || localStorage.getItem('instance:current_id')
    || '';
};

export type APISIXRespErr = {
  error_msg?: string;
  message?: string;
  /**
   * The dashboard's own refusals (RBAC, ownership) carry `error`. Reading only
   * the APISIX-shaped fields left every such response with nothing to show.
   */
  error?: string;
};

/**
 * The text to show when a response carries no message of its own.
 *
 * A notification with no message renders as an empty box, and an empty box
 * explains nothing — worse, it looks like a rendering fault. Every failure gets
 * something readable, even if only the status.
 */
const fallbackMessage = (status?: number): string => {
  switch (status) {
    case HttpStatusCode.Forbidden:
      return i18n.t('error.forbidden');
    case HttpStatusCode.Unauthorized:
      return i18n.t('error.unauthorized');
    case HttpStatusCode.NotFound:
      return i18n.t('error.notFound');
    default:
      return i18n.t('error.generic', { status: status ?? '?' });
  }
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

/**
 * The response boundary, registered as its own pair and before the one below.
 *
 * axios chains interceptors as `then(onFulfilled, onRejected)` **per
 * registered pair**, so a throw from a success handler is not seen by the
 * error handler beside it — only by the next pair's. Putting this check inside
 * the pair below would mean the interceptor that owns every red toast in the
 * dashboard never hears about it, and 23 of the 26 useMutation call sites have
 * no onError of their own: a misrouted write would go from a lying green toast
 * to nothing at all.
 *
 * A 2xx carrying text is the dashboard's own index.html coming back from a
 * misrouted proxy, not a resource. Checked here as well as on the other two
 * axios instances: they are independent clients over independent paths, and
 * hardening them one at a time is what #150, #153 and #162 each did — see
 * src/utils/response-shape.ts.
 */
req.interceptors.response.use((res) => {
  assertJsonBody(res.data, `${res.config.baseURL ?? ''}${res.config.url ?? ''}`);
  return res;
});

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
    // A successful proxy response means that gateway is reachable again, so
    // its banner goes. Only its own: a request can be addressed to an
    // instance other than the selected one (reqFor), and an answer from one
    // says nothing about another (#187).
    if (isProxyRequest(res.config)) {
      const store = getDefaultStore();
      const banner = store.get(proxyErrorAtom);
      if (
        banner &&
        (!banner.instanceId || banner.instanceId === addressedTo(res.config))
      ) {
        store.set(proxyErrorAtom, null);
      }
    }
    return res;
  },
  (err) => {
    // Raised by the boundary above, so it has no `response` and would fall
    // straight past the block below without a word. It is the only failure
    // here whose message names the request rather than quoting the server.
    if (err instanceof MalformedResponseError) {
      notifications.show({
        id: `req-error-malformed-${err.url ?? ''}`,
        message: i18n.t('error.malformedResponse', { url: err.url ?? '' }),
        color: 'red',
      });
      return Promise.reject(err);
    }

    if (err.response) {
      if (matchSkipInterceptor(err)) return Promise.reject(err);
      const res = err.response as AxiosResponse<APISIXRespErr>;
      const status = res.status;
      const proxy = isProxyRequest(err.config);

      // A 401 the dashboard raised about this session, as opposed to one
      // APISIX raised about an admin key the proxy relayed untouched. Only the
      // first is worth ending a session over; treating them alike would sign
      // someone out because a gateway is misconfigured, which logging in again
      // cannot fix.
      if (status === HttpStatusCode.Unauthorized && isSessionInvalid(res.data)) {
        const original = err.config as (typeof err.config & { _retry?: boolean });
        if (original && !original._retry) {
          original._retry = true;
          // The request interceptor reads the token from localStorage, so the
          // retry picks up whatever the refresh wrote.
          return refreshSession().then(
            () => req(original),
            (refreshError: unknown) => {
              // Only the backend refusing the refresh token ends the session.
              // A dropped connection or a restarting backend says try again,
              // and signing someone out for one would cost them whatever they
              // were in the middle of to recover from something already fixed.
              if (refreshError instanceof SessionOverError) {
                endSession();
                return Promise.reject(err);
              }
              notifications.show({
                id: 'session-refresh-failed',
                message: i18n.t('error.refreshFailed', {
                  reason:
                    refreshError instanceof Error
                      ? refreshError.message
                      : String(refreshError),
                }),
                color: 'red',
              });
              return Promise.reject(refreshError);
            }
          );
        }
        endSession();
        return Promise.reject(err);
      }

      // Proxy 502/504 = the dashboard backend couldn't reach the configured
      // APISIX. Route this through the persistent banner instead of a toast
      // so the user has retry/edit affordances; suppress the toast to avoid
      // a duplicate signal.
      // An unmarked 401 on a proxy path is APISIX refusing the admin key —
      // the session is fine and the instance is not usable until someone edits
      // it. That is the same situation as a 502: the banner names the gateway,
      // says the admin key may be wrong, and offers Retry and Edit instance,
      // and it stays on screen. A toast would be gone five seconds later,
      // while the loader is still retrying.
      if (proxy && (status === HttpStatusCode.BadGateway
        || status === HttpStatusCode.GatewayTimeout
        || status === HttpStatusCode.Unauthorized)) {
        // The instance that failed, which is not always the one selected.
        const store = getDefaultStore();
        const instanceId = addressedTo(err.config);
        store.set(proxyErrorAtom, {
          instanceId,
          status,
          message: res.data?.error_msg || res.data?.message || '',
        });
        return Promise.reject(err);
      }


      const d = res.data;
      const message =
        d?.error_msg || d?.message || d?.error || fallbackMessage(status);
      notifications.show({
        // A stable id is what makes repeats collapse into one notification.
        // Deriving it from the message left it undefined whenever the payload
        // had none, so Mantine treated each as new — and a screen that fires
        // one request per plugin stacked a tower of empty boxes over the page.
        id: `req-error-${status}-${message}`,
        message,
        color: 'red',
      });
    }
    return Promise.reject(err);
  }
);

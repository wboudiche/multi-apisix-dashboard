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
import { queryOptions, skipToken } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { isProxyUnreachable, selectedInstance } from '@/apis/hooks';
import type { PluginConfig } from '@/components/form-slice/FormItemPlugins/PluginEditorDrawer';
import {
  API_PLUGIN_METADATA,
  API_PLUGINS,
  API_PLUGINS_LIST,
} from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';


export type NeedPluginSchema = {
  schema: APISIXType['PluginSchemaKeys'];
};

// Every key here names the instance its answer came from. `req` addresses
// each request to the instance selected at the time, and switching instance
// in the header does not remount every page — so a key without the instance
// served one gateway's plugins and metadata on another's page, while a save
// from that page went to the instance now selected (#180). Hooks pass the
// atom's value, so a switch re-renders them onto the new key; callers outside
// React get this tab's selected instance, as genListQueryOptions does.
const keyInstance = (instanceId?: string) => instanceId ?? selectedInstance();

// And every request goes to the instance its key names, not to whichever is
// selected when it runs. A retry, or a refetch landing after a switch — a
// save's onSuccess refetching a page already unmounted — would otherwise write
// one instance's answer under the other's key, to be shown there later
// (#180). req keeps an X-Instance-ID it is given.
const toInstance = (instanceId: string) =>
  instanceId ? { 'X-Instance-ID': instanceId } : {};

export const getPluginsListQueryOptions = (instanceId?: string) => {
  const instance = keyInstance(instanceId);
  return queryOptions({
    queryKey: ['plugins-list', instance],
    queryFn: () =>
      req
        .get<unknown, APISIXType['RespPluginList']>(API_PLUGINS_LIST, {
          headers: toInstance(instance),
        })
        .then((v) => v.data),
  });
};

export const getPluginsListWithSchemaQueryOptions = (
  props: APISIXType['PluginsQuery'] & NeedPluginSchema = { schema: 'schema' },
  instanceId?: string
) => {
  const { subsystem, schema } = props;
  const instance = keyInstance(instanceId);
  return queryOptions({
    queryKey: ['plugins-list-with-schema', instance, subsystem, schema],
    queryFn: () =>
      req
        .get<unknown, APISIXType['RespPlugins']>(API_PLUGINS, {
          params: { subsystem, all: true },
          headers: toInstance(instance),
        })
        .then((v) => {
          const data = Object.entries(v.data);
          const names = [];
          for (const [name, config] of data) {
            if (config[schema]) {
              names.push(name);
            }
          }
          return { names, originObj: v.data };
        })
        // A gateway the proxy cannot reach reads as one with no plugins, the
        // way genListQueryOptions reads its lists as empty. This query
        // suspends, and it now runs again on every instance switch: thrown,
        // its error reached the root route's error boundary and replaced the
        // whole app — and any half-filled form — with the error page.
        .catch((err) => {
          if (isProxyUnreachable(err)) {
            return {
              names: [] as string[],
              originObj: {} as APISIXType['RespPlugins']['data'],
            };
          }
          throw err;
        }),
  });
};

export const getPluginSchemaQueryOptions = (
  name: string,
  enabled: boolean = true,
  instanceId?: string
) => {
  const instance = keyInstance(instanceId);
  return queryOptions({
    queryKey: ['plugin-schema', instance, name],
    queryFn: name
      ? () =>
          req
            .get<unknown, APISIXType['RespPluginSchema']>(
              `${API_PLUGINS}/${name}`,
              { headers: toInstance(instance) }
            )
            .then((v) => v.data)
      : skipToken,
    enabled,
  });
};

export const putPluginMetadataReq = (props: PluginConfig) => {
  const { name, config } = props;
  return req.put<
    APISIXType['PluginMetadataPut'],
    APISIXType['RespPluginMetadataDetail']
  >(`${API_PLUGIN_METADATA}/${name}`, config);
};

export const deletePluginMetadataReq = (name: string) => {
  return req.delete<unknown, APISIXType['RespPluginMetadataDetail']>(
    `${API_PLUGIN_METADATA}/${name}`
  );
};

export const getPluginMetadataQueryOptions = (
  plugin_name: string,
  headers?: AxiosRequestConfig<unknown>['headers'],
  instanceId?: string
) => {
  const instance = keyInstance(instanceId);
  return queryOptions({
    queryKey: ['plugin_metadata', instance, plugin_name],
    queryFn: () =>
      req
        .get<unknown, APISIXType['RespPluginMetadataDetail']>(
          `${API_PLUGIN_METADATA}/${plugin_name}`,
          { headers: { ...headers, ...toInstance(instance) } }
        )
        .then((v) => v.data),
  });
};

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
import type { Resources } from '@/config/i18n';
import type { FileRouteTypes } from '@/routeTree.gen';

export type NavRoute = {
  to: FileRouteTypes['to'];
  label: keyof Resources['en']['common']['sources'];
  icon: string;
};
export const navRoutes: NavRoute[] = [
  {
    to: '/overview',
    label: 'overview',
    icon: 'dashboard',
  },
  {
    to: '/instances',
    label: 'instances',
    icon: 'cloud',
  },
  {
    to: '/users',
    label: 'users',
    icon: 'person',
  },
  {
    to: '/teams',
    label: 'teams',
    icon: 'group',
  },
  {
    to: '/services',
    label: 'services',
    icon: 'layers',
  },
  {
    to: '/routes',
    label: 'routes',
    icon: 'alt-route',
  },
  {
    to: '/stream_routes',
    label: 'streamRoutes',
    icon: 'settings-input-component',
  },
  {
    to: '/upstreams',
    label: 'upstreams',
    icon: 'dns',
  },
  {
    to: '/consumers',
    label: 'consumers',
    icon: 'group',
  },
  {
    to: '/consumer_groups',
    label: 'consumerGroups',
    icon: 'groups',
  },
  {
    to: '/ssls',
    label: 'ssls',
    icon: 'vpn-key',
  },
  {
    to: '/global_rules',
    label: 'globalRules',
    icon: 'rule',
  },
  {
    to: '/plugin_metadata',
    label: 'pluginMetadata',
    icon: 'extension',
  },
  {
    to: '/plugin_configs',
    label: 'pluginConfigs',
    icon: 'settings',
  },
  {
    to: '/secrets',
    label: 'secrets',
    icon: 'password',
  },
  {
    to: '/protos',
    label: 'protos',
    icon: 'api',
  },
  {
    to: '/settings',
    label: 'settings',
    icon: 'settings',
  },
];

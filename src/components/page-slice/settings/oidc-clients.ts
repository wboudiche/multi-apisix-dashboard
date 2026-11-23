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
import type { OidcClientItem } from '@/apis/idps';

const NONE = '—';

type StatusView = {
  color: string;
  labelKey: `settings.oidcClients.status.${'ok' | 'noRoute' | 'missing' | 'changed' | 'unknown'}`;
  helpKey?: 'settings.oidcClients.status.unknownHelp';
};

/**
 * Colour and sentence of a client's status. Absent or unforeseen reads as
 * unknown, the state that claims nothing.
 */
export const oidcStatusView = (status: OidcClientItem['status']): StatusView => {
  switch (status) {
    case 'ok':
      return { color: 'green', labelKey: 'settings.oidcClients.status.ok' };
    case 'no_route':
      return { color: 'orange', labelKey: 'settings.oidcClients.status.noRoute' };
    case 'missing':
      return { color: 'red', labelKey: 'settings.oidcClients.status.missing' };
    case 'changed':
      return { color: 'yellow', labelKey: 'settings.oidcClients.status.changed' };
    default:
      return {
        color: 'gray',
        labelKey: 'settings.oidcClients.status.unknown',
        helpKey: 'settings.oidcClients.status.unknownHelp',
      };
  }
};

/** A delete that leaves routes behind says which ones. */
export const deleteConfirmKey = (
  routes: string[] | undefined
): 'settings.oidcClients.deleteConfirmRoutes' | 'settings.oidcClients.deleteConfirm' =>
  routes && routes.length > 0
    ? 'settings.oidcClients.deleteConfirmRoutes'
    : 'settings.oidcClients.deleteConfirm';

export const routesLabel = (routes: string[] | undefined): string =>
  routes && routes.length > 0 ? routes.join(', ') : NONE;

/** The team's name, its id when the name is not known, a dash when there is none. */
export const teamLabel = (teamId: string | undefined, names: Map<string, string>): string =>
  teamId ? (names.get(teamId) ?? teamId) : NONE;

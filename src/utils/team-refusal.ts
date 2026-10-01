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
import { AxiosHeaders } from 'axios';
import { getDefaultStore } from 'jotai';

import i18n from '@/config/i18n';
import { selectedInstanceId } from '@/stores/instance';
import { ownTeamsAtom } from '@/stores/team';

/**
 * The proxy's refusals about teams, said in the reader's language.
 *
 * They come with a code and an English sentence. One of them is something
 * the reader can act on, in the header, if they can read it (#301) - so it is
 * rendered from its code, here, for the toast and for every form that shows
 * the reason of its own failed save.
 *
 * `team_required` is two situations to the reader, and one to the backend: a
 * developer or a viewer with several teams who has not said which one a new
 * resource is for, and an account with no team at all, which has none to
 * give. Told to choose a team in the header, the second finds no team there.
 *
 * Undefined for any other code, or none: the caller shows what it has.
 */
export const teamRefusal = (
  code: string | undefined,
  instanceId: string = selectedInstanceId()
): string | undefined => {
  if (code === 'team_not_assigned') return i18n.t('error.teamNotAssigned');
  if (code !== 'team_required') return undefined;
  const own = getDefaultStore().get(ownTeamsAtom)[instanceId];
  // Known to have none. Not yet read - the access list has not arrived - is
  // not that.
  return own && own.teams.length === 0
    ? i18n.t('error.teamMissing')
    : i18n.t('error.teamRequired');
};

type ProxyFailure = {
  response?: { data?: { code?: string; error_msg?: string } };
  config?: { headers?: unknown };
  message?: string;
};

/**
 * The instance a failed request was addressed to: the one it named, which the
 * request interceptor always writes, or the selected one. The reason is about
 * that instance's teams, whichever the tab has moved on to since.
 */
const addressedTo = (failure: ProxyFailure | undefined): string => {
  const headers = failure?.config?.headers;
  const named =
    headers instanceof AxiosHeaders
      ? headers.get('X-Instance-ID')
      : (headers as Record<string, unknown> | undefined)?.['X-Instance-ID'];
  return typeof named === 'string' && named ? named : selectedInstanceId();
};

/**
 * The reason a proxied write failed, as a form shows it beside its own
 * button: a team refusal in the reader's language, else the gateway's
 * sentence, else whatever the request itself says. Undefined when there is
 * nothing, for the caller's own fallback.
 */
export const proxyFailureText = (error: unknown): string | undefined => {
  const failure = error as ProxyFailure | undefined;
  return (
    teamRefusal(failure?.response?.data?.code, addressedTo(failure)) ||
    failure?.response?.data?.error_msg ||
    failure?.message ||
    undefined
  );
};

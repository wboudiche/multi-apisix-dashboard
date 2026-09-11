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
import { createFileRoute } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/page/PageHeader';
import { PluginMetadata } from '@/components/page-slice/plugin_metadata/PluginMetadata';
import { currentInstanceIdAtom } from '@/stores/instance';

function RouteComponent() {
  const { t } = useTranslation();
  // One page per instance. The page builds its cards, and the drawer's
  // contents, from its queries through effects that wait while the queries
  // load — so without a remount a switch in the header left the previous
  // instance's cards on screen until the new instance answered, and Edit
  // there opened the previous instance's configuration for a Save addressed
  // to the new one (#180). The keyed queries make the fresh page fetch; the
  // key here makes sure nothing of the old one is offered meanwhile.
  const instanceId = useAtomValue(currentInstanceIdAtom);

  return (
    <>
      <PageHeader title={t('sources.pluginMetadata')} />
      <PluginMetadata key={instanceId} />
    </>
  );
}

export const Route = createFileRoute('/plugin_metadata/')({
  component: RouteComponent,
});

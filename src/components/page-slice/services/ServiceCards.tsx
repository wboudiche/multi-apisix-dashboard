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
import { Badge, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DeleteResourceBtn } from '@/components/page/DeleteResourceBtn';
import { ToDetailPageBtn } from '@/components/page/ToAddPageBtn';
import { API_SERVICES } from '@/config/constant';
import { useAllUpstreams } from '@/hooks/useAllUpstreams';
import { currentInstanceIdAtom } from '@/stores/instance';
import type { APISIXType } from '@/types/schema/apisix';
import IconUpstream from '~icons/material-symbols/hub-outline';

type ServiceCardsProps = {
  services: APISIXType['RespServiceItem'][];
  onDeleted: () => void;
};

/**
 * The services as cards: what the table cannot show without becoming unreadable.
 *
 * A service's description is truncated to a column width in the table, and the
 * upstream it sends to is not there at all (#143).
 *
 * How many routes lean on a service - the other question #143 asks for - is
 * not here. Counted from the route list this page could read, it would be
 * counted from a list the proxy narrows to the caller's team: a developer
 * would read "no routes" for a service five of another team's routes depend
 * on, which is the wrong direction for a number that decides whether deleting
 * one is safe. A count worth showing has to be made where the whole list is,
 * the way #161 moved the routes table's upstream resolution into the proxy.
 */
export const ServiceCards = ({ services, onDeleted }: ServiceCardsProps) => {
  const { t } = useTranslation();
  const instanceId = useAtomValue(currentInstanceIdAtom);
  const { data: upstreams } = useAllUpstreams(instanceId);

  const upstreamNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of upstreams?.list ?? []) {
      if (item.value.name) names.set(item.value.id, item.value.name);
    }
    return names;
  }, [upstreams]);

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {services.length === 0 && (
        <Text c="dimmed" size="sm">
          {t('noData')}
        </Text>
      )}
      {services.map((item) => {
        const service = item.value;
        const upstreamId = service.upstream_id;

        return (
          <Card key={service.id} withBorder padding="md" radius="md">
            <Stack gap="xs" h="100%">
              <Text fw={600}>{service.name || service.id}</Text>

              <Group gap="xs">
                <Badge
                  variant="light"
                  color={upstreamId || service.upstream ? 'blue' : 'gray'}
                  leftSection={<IconUpstream width="12" height="12" />}
                >
                  {upstreamId
                    ? // An upstream this account cannot list is one whose name
                      // it cannot resolve; its id still says which backend the
                      // service reaches.
                      (upstreamNames.get(upstreamId) ?? upstreamId)
                    : service.upstream
                      ? t('services.upstreamInline')
                      : t('services.noUpstream')}
                </Badge>
              </Group>

              {/* Whole, not truncated: the description is why a service is
                  named what it is, and the table cut it at a column. */}
              <Text size="sm" c="dimmed" style={{ flexGrow: 1 }}>
                {service.desc || '—'}
              </Text>

              <Group gap="xs" justify="flex-end">
                <ToDetailPageBtn
                  resource="services"
                  mode="button"
                  to="/services/detail/$id"
                  params={{ id: service.id }}
                />
                <DeleteResourceBtn
                  name={t('services.singular')}
                  target={service.id}
                  api={`${API_SERVICES}/${service.id}`}
                  onSuccess={onDeleted}
                  size="compact-xs"
                  variant="light"
                />
              </Group>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
};

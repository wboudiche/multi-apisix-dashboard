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
import type { ProColumns } from '@ant-design/pro-components';
import { Badge, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { teamsQueryOptions } from '@/apis/queries';
import { currentUserAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';
import { ownTeamsAtom } from '@/stores/team';
import { ownerOf } from '@/utils/owner';

/**
 * The team filter's value for the resources that belong to no team: the
 * proxy's reserved token (`unassignedTeamFilter`, list_filter.go). Those are
 * an admin's alone to see, and after #455 every plugin config, SSL and proto
 * that existed before starts out as one of them.
 */
export const UNASSIGNED_TEAM = '__none__';

const TEAM_BADGE = { maxWidth: 200, minWidth: 0 };

/**
 * Team id to name. The catalogue is an admin's to read; a developer or a
 * viewer gets the names of their own teams, as the header read them, so the
 * column shows a name to them too rather than an id.
 */
export const useTeamNames = () => {
  const currentUser = useAtomValue(currentUserAtom);
  const currentInstanceId = useAtomValue(currentInstanceIdAtom);
  const { data: teams } = useQuery(teamsQueryOptions(currentUser?.id));
  const ownTeams = useAtomValue(ownTeamsAtom)[currentInstanceId]?.teams;
  return useMemo(() => {
    const names = new Map<string, string>();
    ownTeams?.forEach((tm) => names.set(tm.id, tm.name));
    teams?.forEach((tm) => names.set(tm.id, tm.name));
    return names;
  }, [teams, ownTeams]);
};

/** The Team column of a list of what a team can own, as the routes list has it. */
export const useTeamColumn = <T extends { value: unknown }>(): ProColumns<T> => {
  const { t } = useTranslation();
  const names = useTeamNames();
  return useMemo<ProColumns<T>>(
    () => ({
      title: t('routes.list.headerTeam'),
      key: 'team',
      render: (_, record) => {
        const team = ownerOf(record.value);
        if (!team) {
          return (
            <Text size="xs" c="dimmed" fs="italic">
              {t('noData')}
            </Text>
          );
        }
        const label = names.get(team) ?? team;
        return (
          <Badge variant="light" color="teal" size="sm" title={label} style={TEAM_BADGE}>
            {label}
          </Badge>
        );
      },
    }),
    [t, names]
  );
};

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
import { Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { teamsQueryOptions } from '@/apis/queries';
import { usePermission } from '@/hooks/usePermission';
import { UNASSIGNED_TEAM } from '@/hooks/useTeamColumn';
import { currentUserAtom } from '@/stores/auth';

type TeamListFilterProps = {
  /** The list's `team_id` search parameter, as the router parsed it. */
  value: unknown;
  onChange: (teamId: string | undefined) => void;
};

/**
 * Narrows a list to one team, or to the resources of none. An admin's alone:
 * a non-admin's list is already their teams', and holds nothing unassigned.
 */
export const TeamListFilter = ({ value, onChange }: TeamListFilterProps) => {
  const { t } = useTranslation();
  const { isAdmin } = usePermission();
  const currentUser = useAtomValue(currentUserAtom);
  const { data: teams } = useQuery({ ...teamsQueryOptions(currentUser?.id), enabled: isAdmin });
  const options = useMemo(
    () => [
      { value: UNASSIGNED_TEAM, label: t('routes.list.filterTeamUnassigned') },
      ...(teams ?? []).map((tm) => ({ value: tm.id, label: tm.name })),
    ],
    [teams, t]
  );
  if (!isAdmin) return null;

  // Repeatable in the search schema, for the routes bar: the first is the one.
  const first: unknown = Array.isArray(value) ? value[0] : value;
  const selected = first === undefined || first === null || first === '' ? null : String(first);
  return (
    <Select
      aria-label={t('table.filterByTeam')}
      placeholder={t('routes.list.filterTeamPlaceholder')}
      data={options}
      value={selected}
      onChange={(team) => onChange(team ?? undefined)}
      clearable
      searchable
      size="xs"
      w={200}
    />
  );
};

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
import { Alert, Button, Group, Modal, Select, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoolean } from 'react-use';

import { teamsQueryOptions } from '@/apis/queries';
import { teamApi } from '@/apis/teams';
import { usePermission } from '@/hooks/usePermission';
import { currentUserAtom } from '@/stores/auth';
import IconGroup from '~icons/material-symbols/group';

export type ReassignTeamModalProps = {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  resourceType: string;
  resourceId: string;
  currentTeamId?: string;
};

// Sentinel for the "belongs to no team" choice. A Select option needs a value,
// and the empty string is not usable as one, so the intent is carried by this
// constant and translated back to the empty team_id the API expects on save.
const NO_TEAM = '__no_team__';

export const ReassignTeamModal = (props: ReassignTeamModalProps) => {
  const { opened, onClose, onSaved, resourceType, resourceId, currentTeamId } = props;
  const { t } = useTranslation();
  const [selectedTeamId, setSelectedTeamId] = useState<string>(currentTeamId || NO_TEAM);
  const [saving, setSaving] = useState(false);

  const currentUser = useAtomValue(currentUserAtom);
  const { data: teams = [] } = useQuery({
    ...teamsQueryOptions(currentUser?.id),
    enabled: opened,
  });

  // Each opening starts from the resource's current team. Adjusted while
  // rendering when `opened` or the team changes — React's replacement for
  // setting state from an effect, which rendered the stale choice first.
  const [shownFor, setShownFor] = useState({ opened, currentTeamId });
  if (shownFor.opened !== opened || shownFor.currentTeamId !== currentTeamId) {
    setShownFor({ opened, currentTeamId });
    if (opened) setSelectedTeamId(currentTeamId || NO_TEAM);
  }

  // "No team" is offered as an ordinary option rather than hidden behind a
  // clear icon: detaching is a deliberate choice with consequences, so it
  // should be as visible and as reachable by keyboard as picking a team.
  const teamOptions = useMemo(
    () => [
      { value: NO_TEAM, label: t('form.reassignTeam.noTeam') },
      ...teams.map((tm) => ({ value: tm.id, label: tm.name })),
    ],
    [teams, t]
  );

  const currentTeamName = teams.find((tm) => tm.id === currentTeamId)?.name;

  const isUnassigning = selectedTeamId === NO_TEAM;
  const unchanged = selectedTeamId === (currentTeamId || NO_TEAM);

  const handleSave = async () => {
    if (unchanged) return;
    setSaving(true);
    try {
      // An empty team_id is what the API reads as a detach.
      await teamApi.reassignOwnership(
        resourceType,
        resourceId,
        isUnassigning ? '' : selectedTeamId
      );
      notifications.show({
        message: isUnassigning
          ? t('form.reassignTeam.unassignSuccess')
          : t('form.reassignTeam.success'),
        color: 'green',
      });
      onSaved();
      onClose();
    } catch {
      notifications.show({
        message: isUnassigning
          ? t('form.reassignTeam.unassignError')
          : t('form.reassignTeam.error'),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('form.reassignTeam.title')} centered size="sm">
      {currentTeamName && (
        <Text size="sm" c="dimmed" mb="sm">
          {t('form.reassignTeam.current')}: <Text component="span" fw={600}>{currentTeamName}</Text>
        </Text>
      )}
      <Select
        label={t('form.reassignTeam.selectTeam')}
        data={teamOptions}
        value={selectedTeamId}
        onChange={(value) => setSelectedTeamId(value ?? NO_TEAM)}
        allowDeselect={false}
        searchable
      />
      {isUnassigning && currentTeamId && (
        <Alert color="yellow" mt="sm" variant="light">
          {t('form.reassignTeam.unassignWarning')}
        </Alert>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="outline" color="gray" onClick={onClose}>{t('form.btn.cancel')}</Button>
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={unchanged}
          color={isUnassigning ? 'yellow' : undefined}
        >
          {isUnassigning
            ? t('form.reassignTeam.unassignConfirm')
            : t('form.reassignTeam.confirm')}
        </Button>
      </Group>
    </Modal>
  );
};

type ReassignTeamActionProps = {
  resourceType: string;
  resourceId: string;
  /** The resource's `__team_id`, as the proxy put it on the detail response. */
  currentTeamId?: string;
  onSaved: () => void;
};

/**
 * The detail page's "Reassign Team" button and its dialog, for an admin only:
 * the backend refuses anyone else. Shared by the pages of every resource a team
 * owns that offers it (#455).
 */
export const ReassignTeamAction = (props: ReassignTeamActionProps) => {
  const { resourceType, resourceId, currentTeamId, onSaved } = props;
  const { t } = useTranslation();
  const { isAdmin } = usePermission();
  const [opened, setOpened] = useBoolean(false);
  if (!isAdmin) return null;
  return (
    <>
      <Button
        onClick={() => setOpened(true)}
        size="compact-sm"
        variant="light"
        color="teal"
        leftSection={<IconGroup width="16" height="16" />}
      >
        {t('form.reassignTeam.title')}
      </Button>
      <ReassignTeamModal
        opened={opened}
        onClose={() => setOpened(false)}
        onSaved={onSaved}
        resourceType={resourceType}
        resourceId={resourceId}
        currentTeamId={currentTeamId}
      />
    </>
  );
};

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
import {
  Box,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Team,teamApi } from '@/apis/teams';
import PageHeader from '@/components/page/PageHeader';
import { usePermission } from '@/hooks/usePermission';
import IconPlus from '~icons/material-symbols/add';
import IconEdit from '~icons/material-symbols/edit-outline';
import IconGroup from '~icons/material-symbols/group-outline';

const TeamsPage = () => {
  const { t } = useTranslation();
  const { isSuperAdmin } = usePermission();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // null while adding; the team's id while editing it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Team>>({
    name: '',
    description: '',
  });

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teamApi.list();
      setTeams(data);
    } catch {
      notifications.show({
        title: t('teams.errorTitle'),
        message: t('teams.loadFailed'),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder ta="center">
          <Title order={2} mt="md">{t('teams.accessDenied')}</Title>
          <Text c="dimmed" mt="sm">
            {t('teams.accessDeniedMessage')}
          </Text>
        </Paper>
      </Container>
    );
  }

  const handleSubmit = async () => {
    if (!formData.name?.trim()) {
      notifications.show({
        title: t('teams.errorTitle'),
        message: t('teams.nameRequired'),
        color: 'red',
      });
      return;
    }
    const isEdit = editingId !== null;
    try {
      if (isEdit) {
        await teamApi.update(editingId, {
          name: formData.name,
          description: formData.description ?? '',
        });
      } else {
        await teamApi.create(formData);
      }
      notifications.show({
        title: t('teams.successTitle'),
        message: isEdit ? t('teams.updated') : t('teams.created'),
        color: 'green',
      });
      setModalOpen(false);
      resetForm();
      loadTeams();
    } catch {
      notifications.show({
        title: t('teams.errorTitle'),
        message: isEdit ? t('teams.updateFailed') : t('teams.createFailed'),
        color: 'red',
      });
    }
  };

  const openEdit = (team: Team) => {
    setEditingId(team.id);
    setFormData({ name: team.name, description: team.description });
    setModalOpen(true);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('teams.confirmDelete'))) return;
    try {
      await teamApi.delete(id);
      notifications.show({
        title: t('teams.successTitle'),
        message: t('teams.deleted'),
        color: 'green',
      });
      loadTeams();
    } catch {
      notifications.show({
        title: t('teams.errorTitle'),
        message: t('teams.deleteFailed'),
        color: 'red',
      });
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      description: '',
    });
  };

  return (
    <>
      <PageHeader
        title={t('teams.title')}
        extra={
          <Button
            leftSection={<IconPlus width="18" height="18" />}
            onClick={openCreate}
          >
            {t('teams.add')}
          </Button>
        }
      />

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('teams.headerName')}</Table.Th>
              <Table.Th>{t('teams.headerDescription')}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{t('teams.headerActions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {teams.map((team, index) => (
              <Table.Tr key={team.id} className={`stagger-${(index % 5) + 1}`}>
                <Table.Td>
                  <Group gap="sm">
                    <ThemeIcon variant="light" color="apisix-red" size="lg" radius="md">
                      <IconGroup width="18" height="18" />
                    </ThemeIcon>
                    <Text fw={600} size="sm">{team.name}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">{team.description || t('teams.noDescription')}</Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap="xs" justify="flex-end">
                    <Button
                      size="xs"
                      variant="light"
                      radius="sm"
                      leftSection={<IconEdit width="14" height="14" />}
                      styles={{ root: { padding: '0 12px' } }}
                      onClick={() => openEdit(team)}
                    >
                      {t('teams.edit')}
                    </Button>
                    <Button size="xs" variant="filled" color="red" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => handleDelete(team.id)}>
                      {t('teams.delete')}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {teams.length === 0 && !loading && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Box className="EmptyState-root" ta="center">
                    <IconGroup width="48" height="48" color="var(--text-tertiary)" />
                    <Text fw={600} size="lg" mt="md">{t('teams.emptyTitle')}</Text>
                    <Text c="dimmed" size="sm">{t('teams.emptyMessage')}</Text>
                  </Box>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editingId ? t('teams.editTitle') : t('teams.addTitle')}
        size="md"
      >
        <Stack gap="md" mt="md">
          <TextInput
            label={t('teams.nameLabel')}
            placeholder={t('teams.namePlaceholder')}
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            data-autofocus
          />
          <Textarea
            label={t('teams.descriptionLabel')}
            placeholder={t('teams.descriptionPlaceholder')}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />
          
          <Group justify="flex-end" mt="xl">
            <Button variant="subtle" color="gray" onClick={closeModal}>
              {t('teams.cancel')}
            </Button>
            <Button onClick={handleSubmit}>
              {editingId ? t('teams.saveSubmit') : t('teams.createSubmit')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export const Route = createFileRoute('/teams/')({
  component: TeamsPage,
});
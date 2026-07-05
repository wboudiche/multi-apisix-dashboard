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
import { useEffect, useState } from 'react';

import { type Team,teamApi } from '@/apis/teams';
import PageHeader from '@/components/page/PageHeader';
import { usePermission } from '@/hooks/usePermission';
import IconPlus from '~icons/material-symbols/add';
import IconGroup from '~icons/material-symbols/group-outline';

const TeamsPage = () => {
  const { isSuperAdmin } = usePermission();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Team>>({
    name: '',
    description: '',
  });

  const loadTeams = async () => {
    setLoading(true);
    try {
      const data = await teamApi.list();
      setTeams(data);
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to load teams',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeams();
  }, []);

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder ta="center">
          <Title order={2} mt="md">Access Denied</Title>
          <Text c="dimmed" mt="sm">
            Only Super Admins can manage teams.
          </Text>
        </Paper>
      </Container>
    );
  }

  const handleSubmit = async () => {
    if (!formData.name?.trim()) {
      notifications.show({
        title: 'Error',
        message: 'Team name is required',
        color: 'red',
      });
      return;
    }
    try {
      await teamApi.create(formData);
      notifications.show({
        title: 'Success',
        message: 'Team created successfully',
        color: 'green',
      });
      setModalOpen(false);
      resetForm();
      loadTeams();
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to create team',
        color: 'red',
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this team?')) return;
    try {
      await teamApi.delete(id);
      notifications.show({
        title: 'Success',
        message: 'Team deleted successfully',
        color: 'green',
      });
      loadTeams();
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete team',
        color: 'red',
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
    });
  };

  return (
    <>
      <PageHeader
        title="Teams"
        extra={
          <Button
            leftSection={<IconPlus width="18" height="18" />}
            onClick={() => { resetForm(); setModalOpen(true); }}
          >
            Add Team
          </Button>
        }
      />

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Team Name</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
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
                  <Text size="sm" c="dimmed">{team.description || 'No description provided'}</Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="filled" color="red" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => handleDelete(team.id)}>
                      Delete
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
                    <Text fw={600} size="lg" mt="md">No teams found</Text>
                    <Text c="dimmed" size="sm">Define your first team to start managing scoped resources.</Text>
                  </Box>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      <Modal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); resetForm(); }}
        title="Add New Team"
        size="md"
      >
        <Stack gap="md" mt="md">
          <TextInput
            label="Team Name"
            placeholder="e.g. Payments Team"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            data-autofocus
          />
          <Textarea
            label="Description"
            placeholder="What does this team manage?"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />
          
          <Group justify="flex-end" mt="xl">
            <Button variant="subtle" color="gray" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>Create Team</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export const Route = createFileRoute('/teams/')({
  component: TeamsPage,
});
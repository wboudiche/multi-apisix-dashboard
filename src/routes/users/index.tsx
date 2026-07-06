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
  Badge,
  Box,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { type User } from '@/apis/auth';
import { instanceApi, type UserInstanceRole } from '@/apis/instances';
import { type Team,teamApi } from '@/apis/teams';
import PageHeader from '@/components/page/PageHeader';
import { currentUserAtom } from '@/stores/auth';
import { instancesAtom } from '@/stores/instance';
import IconPlus from '~icons/material-symbols/add';
import IconInstance from '~icons/material-symbols/dns-outline';
import IconGroup from '~icons/material-symbols/group-outline';
import IconKey from '~icons/material-symbols/key-outline';
import IconUser from '~icons/material-symbols/person-outline';
import IconShield from '~icons/material-symbols/shield-outline';

type CreateUserRequest = {
  username: string;
  password: string;
  email: string;
  role: string;
};

const UsersPage = () => {
  const [currentUser] = useAtom(currentUserAtom);
  const [availableInstances] = useAtom(instancesAtom);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>('basic');
  
  const [formData, setFormData] = useState<CreateUserRequest>({
    username: '',
    password: '',
    email: '',
    role: 'user',
  });

  const [userAssignments, setUserAssignments] = useState<Record<string, UserInstanceRole[]>>({});
  const [instanceRoles, setInstanceRoles] = useState<Record<string, { role: string, team_id: string, scope?: { tags: string[], pathPrefixes: string[] } }>>({});


  const isSuperAdmin = currentUser?.role === 'super_admin';

  const loadData = async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('auth:access_token');
      
      // Load users
      const userRes = await fetch('/api/v1/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      let loadedUsers: User[] = [];
      if (userRes.ok) {
        loadedUsers = await userRes.json();
        setUsers(loadedUsers);
      }

      // Load teams
      const teamData = await teamApi.list();
      setTeams(teamData);

      // Load instance assignments for each user
      const assignments: Record<string, UserInstanceRole[]> = {};
      await Promise.all(
        loadedUsers.map(async (user) => {
          try {
            assignments[user.id] = await instanceApi.getUserInstances(user.id);
          } catch {
            assignments[user.id] = [];
          }
        })
      );
      setUserAssignments(assignments);
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to load user management data',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isSuperAdmin]);

  const handleSubmit = async () => {
    // Validate team selection for developer/viewer roles
    for (const instanceID in instanceRoles) {
      const config = instanceRoles[instanceID];
      if (config.role && (config.role === 'developer' || config.role === 'viewer') && !config.team_id) {
        notifications.show({
          message: 'Team is required for developer and viewer roles',
          color: 'red',
        });
        return;
      }
    }

    try {
      const token = localStorage.getItem('auth:access_token');
      let userId = editingUser?.id;

      // Only create user if not editing
      if (!editingUser) {
        const response = await fetch('/api/v1/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...formData, role: formData.role === 'user' ? '' : formData.role }),
        });

        if (!response.ok) {
          const error = await response.json();
          notifications.show({
            title: 'Error',
            message: error.error || 'Failed to create user',
            color: 'red',
          });
          return;
        }
        const newUser = await response.json();
        userId = newUser.id;
      }

      // Save instance specific roles, teams and scopes
      for (const instanceID in instanceRoles) {
        const config = instanceRoles[instanceID];
        if (config.role) {
          await fetch(`/api/v1/user-access/${userId}/instances/${instanceID}/role`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              role: config.role,
              team_id: config.team_id,
              scope: config.scope
            }),
          });
        }
      }

      notifications.show({
        title: 'Success',
        message: editingUser ? 'Permissions updated successfully' : 'User and permissions created successfully',
        color: 'green',
      });
      setModalOpen(false);
      resetForm();
      loadData();
    } catch {
      notifications.show({
        title: 'Error',
        message: editingUser ? 'Failed to update permissions' : 'Failed to create user',
        color: 'red',
      });
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      const token = localStorage.getItem('auth:access_token');
      const response = await fetch(`/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        notifications.show({
          title: 'Success',
          message: 'User deleted successfully',
          color: 'green',
        });
        loadData();
      }
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete user',
        color: 'red',
      });
    }
  };

  const resetForm = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      email: '',
      role: 'user',
    });
    setActiveTab('basic');
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'red';
      case 'instance_admin': return 'orange';
      case 'developer': return 'blue';
      default: return 'gray';
    }
  };

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder className="Card-root" ta="center">
          <IconShield width="48" height="48" color="var(--brand)" />
          <Title order={2} mt="md">Access Denied</Title>
          <Text c="dimmed" mt="sm">
            Only Super Admins can manage users and RBAC roles.
          </Text>
        </Paper>
      </Container>
    );
  }

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      email: user.email,
      role: user.role === '' ? 'user' : user.role,
    });
    // Load existing instance assignments
    const assignments = userAssignments[user.id] || [];
    const roles: Record<string, { role: string, team_id: string, scope?: { tags: string[], pathPrefixes: string[] } }> = {};
    for (const a of assignments) {
      roles[a.instance_id] = {
        role: a.role,
        team_id: a.team_id || '',
        scope: a.scope ? { tags: a.scope.tags || [], pathPrefixes: a.scope.path_prefixes || [] } : undefined,
      };
    }
    setInstanceRoles(roles);
    setActiveTab('basic');
    setModalOpen(true);
  };

  const getAssignments = (userId: string) => userAssignments[userId] || [];

  return (
    <>
      <PageHeader
        title="User Management"
        extra={
          <Button
            leftSection={<IconPlus width="18" height="18" />}
            onClick={() => { resetForm(); setModalOpen(true); }}
          >
            Add User
          </Button>
        }
      />

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Instances</Table.Th>
              <Table.Th>Teams</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user, index) => {
              const assignments = getAssignments(user.id);
              const assignedTeams = assignments
                .map((a) => teams.find((t) => t.id === a.team_id))
                .filter(Boolean);
              const uniqueTeams = [...new Map(assignedTeams.map((t) => [t!.id, t!])).values()];

              return (
              <Table.Tr key={user.id} className={`stagger-${(index % 5) + 1}`}>
                <Table.Td>
                  <Group gap="sm">
                    <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
                      <IconUser width="18" height="18" />
                    </ThemeIcon>
                    <Box>
                      <Text fw={600} size="sm">{user.username}</Text>
                      <Text size="xs" c="dimmed">{user.email || 'No email provided'}</Text>
                    </Box>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={getRoleColor(user.role)}
                    variant="light"
                    leftSection={<IconShield width="12" height="12" />}
                  >
                    {user.role.replace('_', ' ')}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {user.role === 'super_admin' ? (
                    <Text size="xs" c="dimmed" fs="italic">All instances</Text>
                  ) : assignments.length === 0 ? (
                    <Text size="xs" c="dimmed">—</Text>
                  ) : (
                    <Stack gap={4}>
                      {assignments.map((a) => {
                        const inst = availableInstances.find((i) => i.id === a.instance_id);
                        return (
                          <Group key={a.instance_id} gap={6} wrap="nowrap">
                            <IconInstance width="13" height="13" style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                            <Text size="xs" fw={500}>{inst?.name || a.instance_id.slice(0, 8)}</Text>
                            <Text size="xs" c="dimmed">({a.role.replace('_', ' ')})</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  )}
                </Table.Td>
                <Table.Td>
                  {user.role === 'super_admin' ? (
                    <Text size="xs" c="dimmed" fs="italic">All teams</Text>
                  ) : uniqueTeams.length === 0 ? (
                    <Text size="xs" c="dimmed">—</Text>
                  ) : (
                    <Stack gap={4}>
                      {uniqueTeams.map((team) => (
                        <Group key={team.id} gap={6} wrap="nowrap">
                          <IconGroup width="13" height="13" style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                          <Text size="xs" fw={500}>{team.name}</Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                  </Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="filled" color="blue" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => openEditModal(user)}>
                      Permissions
                    </Button>
                    {user.id !== currentUser?.id && (
                      <Button size="xs" variant="filled" color="red" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => handleDelete(user.id)}>
                        Delete
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
              );
            })}
            {users.length === 0 && !loading && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Box className="EmptyState-root" ta="center">
                    <IconUser width="48" height="48" color="var(--text-tertiary)" />
                    <Text fw={600} size="lg" mt="md">No users found</Text>
                    <Text c="dimmed" size="sm">Create your first team member to collaborate.</Text>
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
        title={editingUser ? 'Edit User & Permissions' : 'Add New User'}
        size="lg"
      >
        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List mb="lg" grow>
            <Tabs.Tab value="basic" leftSection={<IconUser width="16" height="16" />}>Basic Info</Tabs.Tab>
            <Tabs.Tab value="access" leftSection={<IconInstance width="16" height="16" />} disabled={formData.role === 'super_admin'}>Instance Access</Tabs.Tab>

          </Tabs.List>

          <Tabs.Panel value="basic">
            <Stack gap="md">
              <TextInput
                label="Username"
                placeholder="johndoe"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                disabled={!!editingUser}
                data-autofocus
              />
              <TextInput
                label="Email"
                placeholder="john@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
              {!editingUser && (
                <TextInput
                  label="Password"
                  placeholder="Enter secure password"
                  required
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  leftSection={<IconKey width="16" height="16" />}
                />
              )}
              <Select
                label="Global Role"
                description="Super Admins have full access to all instances. Regular users need per-instance role assignments."
                value={formData.role}
                onChange={(value) => setFormData({ ...formData, role: value || 'user' })}
                data={[
                  { value: 'super_admin', label: 'Super Admin (Full Access)' },
                  { value: 'user', label: 'User (Assign per-instance roles below)' },
                ]}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="access">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Assign this user to APISIX instances with a specific role and team.
              </Text>

              {availableInstances.length === 0 ? (
                <Paper p="md" withBorder ta="center" bg="var(--surface-1)">
                  <Text size="sm">No instances available to assign.</Text>
                </Paper>
              ) : (
                <Stack gap="sm">
                  {availableInstances.map(inst => {
                    const config = instanceRoles[inst.id];
                    return (
                      <Paper key={inst.id} p="md" withBorder style={{ borderColor: config?.role ? 'var(--mantine-color-blue-3)' : undefined }}>
                        <Stack gap="sm">
                          <Group justify="space-between">
                            <Box>
                              <Text fw={600} size="sm">{inst.name}</Text>
                              <Text size="xs" c="dimmed">{inst.admin_api_url}</Text>
                            </Box>
                            {config?.role && (
                              <Badge size="xs" variant="light" color="blue">Assigned</Badge>
                            )}
                          </Group>
                          <Group gap="sm" grow>
                            <Select
                              size="sm"
                              label="Role"
                              placeholder="No access"
                              clearable
                              value={config?.role || null}
                              onChange={(role) => setInstanceRoles({
                                ...instanceRoles,
                                [inst.id]: { ...instanceRoles[inst.id], role: role || '', team_id: instanceRoles[inst.id]?.team_id || '' }
                              })}
                              data={[
                                { value: 'instance_admin', label: 'Instance Admin' },
                                { value: 'developer', label: 'Developer' },
                                { value: 'viewer', label: 'Viewer' },
                              ]}
                            />
                            {(config?.role === 'developer' || config?.role === 'viewer') && (
                              <Select
                                size="sm"
                                label="Team"
                                placeholder="No team"
                                clearable
                                required
                                data={teams.map(t => ({ value: t.id, label: t.name }))}
                                value={config?.team_id || null}
                                onChange={(teamId) => setInstanceRoles({
                                  ...instanceRoles,
                                  [inst.id]: { ...instanceRoles[inst.id], team_id: teamId || '', role: instanceRoles[inst.id]?.role || '' }
                                })}
                              />
                            )}
                          </Group>
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>

        <Group justify="flex-end" mt="xl">
          <Button variant="subtle" color="gray" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
        </Group>
      </Modal>
    </>
  );
};

export const Route = createFileRoute('/users/')({
  component: UsersPage,
});

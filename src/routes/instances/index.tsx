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
  ActionIcon,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { type CreateInstanceRequest,type Instance, instanceApi } from '@/apis/instances';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom,instancesAtom, instancesLoadingAtom } from '@/stores/instance';
import IconPlus from '~icons/material-symbols/add';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconDelete from '~icons/material-symbols/delete-forever-outline';
import IconServer from '~icons/material-symbols/dns-outline';
import IconEdit from '~icons/material-symbols/edit-outline';
import IconPlugConnected from '~icons/material-symbols/wifi-tethering';

const InstancesPage = () => {
  const { isSuperAdmin } = usePermission();
  const [instances, setInstances] = useAtom(instancesAtom);
  const [loading, setLoading] = useAtom(instancesLoadingAtom);
  const [currentInstanceId, setCurrentInstanceId] = useAtom(currentInstanceIdAtom);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateInstanceRequest>({
    name: '',
    description: '',
    admin_api_url: '',
    admin_key: '',
    gateway_url: '',
    is_active: true,
  });

  const loadInstances = async () => {
    setLoading(true);
    try {
      const data = await instanceApi.list();
      setInstances(data);
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to load instances',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInstances();
  }, []);

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder ta="center">
          <Title order={2} mt="md">Access Denied</Title>
          <Text c="dimmed" mt="sm">
            Only Super Admins can manage instances.
          </Text>
        </Paper>
      </Container>
    );
  }

  const handleSubmit = async () => {
    try {
      if (editingInstance) {
        await instanceApi.update(editingInstance.id, formData);
        notifications.show({
          title: 'Success',
          message: 'Instance updated successfully',
          color: 'green',
        });
      } else {
        await instanceApi.create(formData);
        notifications.show({
          title: 'Success',
          message: 'Instance created successfully',
          color: 'green',
        });
      }
      setModalOpen(false);
      resetForm();
      loadInstances();
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to save instance',
        color: 'red',
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this instance?')) return;
    try {
      await instanceApi.delete(id);
      notifications.show({
        title: 'Success',
        message: 'Instance deleted successfully',
        color: 'green',
      });
      if (currentInstanceId === id) {
        setCurrentInstanceId('');
      }
      loadInstances();
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete instance',
        color: 'red',
      });
    }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      await instanceApi.testConnection(id);
      notifications.show({
        title: 'Connection Successful',
        message: 'Successfully connected to APISIX instance',
        color: 'green',
        icon: <IconCheck width="18" height="18" />,
      });
    } catch {
      notifications.show({
        title: 'Connection Failed',
        message: 'Could not connect to the APISIX Admin API',
        color: 'red',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSetActive = async (instance: Instance) => {
    setCurrentInstanceId(instance.id);
    notifications.show({
      title: 'Instance Selected',
      message: `Now managing ${instance.name}`,
      color: 'blue',
    });
  };

  const resetForm = () => {
    setEditingInstance(null);
    setFormData({
      name: '',
      description: '',
      admin_api_url: '',
      admin_key: '',
      gateway_url: '',
      is_active: true,
    });
  };

  const openEditModal = (instance: Instance) => {
    setEditingInstance(instance);
    setFormData({
      name: instance.name,
      description: instance.description,
      admin_api_url: instance.admin_api_url,
      admin_key: '', // Don't show existing key for security
      gateway_url: instance.gateway_url || '',
      is_active: instance.is_active,
    });
    setModalOpen(true);
  };

  return (
    <Container fluid className="animate-fade-in-up">
      <Box className="PageTitle-root" mb="xl">
        <Group justify="space-between">
          <Box>
            <Title order={1}>Instances</Title>
            <Text c="dimmed" mt={4}>
              Manage connections to your Apache APISIX gateways
            </Text>
          </Box>
          {instances.length > 0 && (
            <Button
              leftSection={<IconPlus width="18" height="18" />}
              onClick={() => { resetForm(); setModalOpen(true); }}
              className="animate-pulse-hover"
            >
              Add Instance
            </Button>
          )}
        </Group>
      </Box>

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Admin API URL</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Active Manager</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {instances.map((instance, index) => {
              const isActive = currentInstanceId === instance.id;
              
              return (
                <Table.Tr
                  key={instance.id}
                  className={`stagger-${(index % 5) + 1}`}
                  style={{
                    backgroundColor: isActive ? 'rgba(248, 66, 63, 0.04)' : undefined,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Table.Td>
                    <Group gap="sm">
                      <ThemeIcon 
                        variant={isActive ? 'filled' : 'light'} 
                        color={isActive ? 'apisix-red' : 'gray'}
                        size="lg"
                        radius="md"
                      >
                        <IconServer width="18" height="18" />
                      </ThemeIcon>
                      <Box>
                        <Text fw={600} size="sm" c={isActive ? 'apisix-red' : undefined}>
                          {instance.name}
                        </Text>
                        <Text size="xs" c="dimmed" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {instance.description || 'No description'}
                        </Text>
                      </Box>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" c="dimmed">
                      {instance.admin_api_url}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge 
                      color={instance.is_active ? 'green' : 'gray'}
                      variant={instance.is_active ? 'light' : 'outline'}
                    >
                      {instance.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      checked={isActive}
                      onChange={() => handleSetActive(instance)}
                      color="apisix-red"
                      size="md"
                    />
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Group gap="xs" justify="flex-end">
                      <Tooltip label="Test Connection">
                        <ActionIcon
                          variant="light"
                          color="blue"
                          aria-label="Test Connection"
                          onClick={() => handleTestConnection(instance.id)}
                          loading={testingId === instance.id}
                        >
                          <IconPlugConnected width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit">
                        <ActionIcon variant="light" color="yellow" aria-label="Edit" onClick={() => openEditModal(instance)}>
                          <IconEdit width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <ActionIcon variant="light" color="red" aria-label="Delete" onClick={() => handleDelete(instance.id)}>
                          <IconDelete width="18" height="18" />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            
            {instances.length === 0 && !loading && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Box className="EmptyState-root" ta="center">
                    <IconServer width="48" height="48" color="var(--text-tertiary)" />
                    <Text fw={600} size="lg" mt="md" c="var(--text-primary)">
                      No instances found
                    </Text>
                    <Text c="dimmed" size="sm" mt="xs" mb="lg">
                      Get started by connecting to your first APISIX instance.
                    </Text>
                    <Button 
                      leftSection={<IconPlus width="16" height="16" />}
                      onClick={() => { resetForm(); setModalOpen(true); }}
                    >
                      Add Instance
                    </Button>
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
        title={editingInstance ? 'Edit Instance' : 'Add New Instance'}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
        overlayProps={{
          backgroundOpacity: 0.55,
          blur: 3,
        }}
      >
        <Stack gap="md" mt="md">
          <TextInput
            label="Name"
            description="A recognizable name for this gateway"
            placeholder="e.g., Production Cluster"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            data-autofocus
          />
          <Textarea
            label="Description"
            placeholder="e.g., Main production API gateway handling all external traffic"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
          />
          <TextInput
            label="Admin API URL"
            description="The URL where the APISIX Admin API is accessible"
            placeholder="http://localhost:9180"
            required
            value={formData.admin_api_url}
            onChange={(e) => setFormData({ ...formData, admin_api_url: e.target.value })}
          />
          <TextInput
            label="Admin Key"
            description={editingInstance ? 'Leave empty to keep existing key' : 'The X-API-Key required for authentication'}
            placeholder="Enter admin key"
            required={!editingInstance}
            type="password"
            value={formData.admin_key}
            onChange={(e) => setFormData({ ...formData, admin_key: e.target.value })}
          />
          <TextInput
            label="Gateway URL"
            description="The URL where the APISIX gateway is accessible (for route testing)"
            placeholder="http://localhost:9080"
            value={formData.gateway_url}
            onChange={(e) => setFormData({ ...formData, gateway_url: e.target.value })}
          />

          <Paper p="md" withBorder bg="var(--surface-1)" mt="sm">
            <Group justify="space-between">
              <Box>
                <Text fw={500} size="sm">Active Status</Text>
                <Text size="xs" c="dimmed">Inactive instances cannot be selected or modified</Text>
              </Box>
              <Switch
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                size="md"
              />
            </Group>
          </Paper>

          <Group justify="flex-end" mt="xl">
            <Button variant="subtle" color="gray" onClick={() => { setModalOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingInstance ? 'Save Changes' : 'Create Instance'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

export const Route = createFileRoute('/instances/')({
  component: InstancesPage,
});

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
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  List,
  Loader,
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
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CreateInstanceRequest,
  getInstanceConflict,
  type Instance,
  INSTANCE_CONFLICT,
  instanceApi,
  type InstanceDependencies,
  type InstanceHealth,
} from '@/apis/instances';
import { usePermission } from '@/hooks/usePermission';
import { currentInstanceIdAtom,instancesAtom, instancesLoadingAtom } from '@/stores/instance';
import IconPlus from '~icons/material-symbols/add';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconDelete from '~icons/material-symbols/delete-forever-outline';
import IconServer from '~icons/material-symbols/dns-outline';
import IconEdit from '~icons/material-symbols/edit-outline';
import IconPlugConnected from '~icons/material-symbols/wifi-tethering';

/**
 * Reports whether the gateway actually answered. Deliberately independent of
 * `is_active`, which only records whether an admin enabled the instance.
 */
const ConnectivityBadge = ({
  health,
  loaded,
}: {
  health?: InstanceHealth;
  loaded: boolean;
}) => {
  const { t } = useTranslation();

  if (!loaded || !health) {
    return (
      <Badge color="gray" variant="outline">
        {t('instances.checking')}
      </Badge>
    );
  }

  const connected = health.status === 'Connected';
  return (
    <Tooltip label={health.error} disabled={!health.error}>
      <Badge color={connected ? 'green' : 'red'} variant="light">
        {connected ? t('instances.connected') : t('instances.unreachable')}
      </Badge>
    </Tooltip>
  );
};

/** Resources that live on the gateway and survive the instance's deletion. */
const GATEWAY_RESOURCES = [
  { key: 'routes', label: 'instances.resourceRoutes' },
  { key: 'services', label: 'instances.resourceServices' },
  { key: 'upstreams', label: 'instances.resourceUpstreams' },
  { key: 'consumers', label: 'instances.resourceConsumers' },
  { key: 'stream_routes', label: 'instances.resourceStreamRoutes' },
] as const;

/** Dashboard-owned records that the deletion discards. */
const DASHBOARD_RECORDS = [
  { key: 'user_assignments', label: 'instances.resourceUserAssignments' },
  { key: 'ownership_records', label: 'instances.resourceOwnershipRecords' },
] as const;

/** The countable fields of InstanceDependencies (i.e. everything but `reachable`). */
type CountableDependency = {
  [K in keyof InstanceDependencies]: InstanceDependencies[K] extends number ? K : never;
}[keyof InstanceDependencies];

type ImpactLabel =
  | (typeof GATEWAY_RESOURCES)[number]['label']
  | (typeof DASHBOARD_RECORDS)[number]['label'];

type ImpactCount = { label: ImpactLabel; count: number };

/**
 * Spells out exactly what a deletion would orphan, so it can never be the silent
 * no-op it used to be.
 */
const DeleteImpact = ({ dependencies }: { dependencies: InstanceDependencies }) => {
  const { t } = useTranslation();

  const countsFor = (
    group: readonly { key: CountableDependency; label: ImpactLabel }[]
  ): ImpactCount[] =>
    group
      .map((entry) => ({ label: entry.label, count: dependencies[entry.key] }))
      .filter((entry) => entry.count > 0);

  const attached = countsFor(GATEWAY_RESOURCES);
  const records = countsFor(DASHBOARD_RECORDS);

  const renderCounts = (entries: ImpactCount[]) => (
    <List size="sm" spacing={4} withPadding>
      {entries.map((entry) => (
        <List.Item key={entry.label}>
          {entry.count} {t(entry.label)}
        </List.Item>
      ))}
    </List>
  );

  if (dependencies.reachable && attached.length === 0 && records.length === 0) {
    return <Text size="sm">{t('instances.deleteEmpty')}</Text>;
  }

  return (
    <Stack gap="sm">
      {!dependencies.reachable && (
        <Alert color="orange" variant="light">
          {t('instances.deleteUnreachable')}
        </Alert>
      )}
      {attached.length > 0 && (
        <Box>
          <Text size="sm">{t('instances.deleteAttachedIntro')}</Text>
          {renderCounts(attached)}
        </Box>
      )}
      {records.length > 0 && (
        <Box>
          <Text size="sm">{t('instances.deleteOrphanIntro')}</Text>
          {renderCounts(records)}
        </Box>
      )}
    </Stack>
  );
};

/** A delete awaiting confirmation. `dependencies` is null while still loading. */
type PendingDelete = {
  instance: Instance;
  dependencies: InstanceDependencies | null;
};

const InstancesPage = () => {
  const { t } = useTranslation();
  const { isSuperAdmin } = usePermission();
  const [instances, setInstances] = useAtom(instancesAtom);
  const [loading, setLoading] = useAtom(instancesLoadingAtom);
  const [currentInstanceId, setCurrentInstanceId] = useAtom(currentInstanceIdAtom);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, InstanceHealth>>({});
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  // Name of the instance already using the submitted Admin API URL, awaiting confirmation.
  const [urlConflict, setUrlConflict] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState<CreateInstanceRequest>({
    name: '',
    description: '',
    admin_api_url: '',
    admin_key: '',
    gateway_url: '',
    is_active: true,
  });

  const loadInstances = useCallback(async () => {
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
  }, [setInstances, setLoading]);

  /**
   * Connectivity is a live property of the gateway, not of the stored record, so
   * it is fetched separately and never inferred from `is_active`.
   */
  const loadHealth = useCallback(async () => {
    try {
      const results = await instanceApi.listHealth();
      setHealth(Object.fromEntries(results.map((entry) => [entry.instance_id, entry])));
    } catch {
      setHealth({});
    } finally {
      setHealthLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadInstances();
    loadHealth();
  }, [loadInstances, loadHealth]);

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder ta="center">
          <Title order={2} mt="md">{t('instances.accessDeniedTitle')}</Title>
          <Text c="dimmed" mt="sm">
            {t('instances.accessDeniedBody')}
          </Text>
        </Paper>
      </Container>
    );
  }

  /**
   * Saves the instance. `force` is set only after the operator has confirmed a
   * warned-about conflict, so an unconfirmed duplicate can never slip through.
   */
  const submitInstance = async (force: boolean) => {
    setSaving(true);
    setNameError(null);
    try {
      const saved = editingInstance
        ? await instanceApi.update(editingInstance.id, formData, force)
        : await instanceApi.create(formData, force);

      setModalOpen(false);
      setUrlConflict(null);
      resetForm();

      if (saved.connection_warning) {
        // Saved, but reporting it as a plain success would repeat the bug this fixes.
        notifications.show({
          title: t('instances.saveWarningTitle'),
          message: saved.connection_warning,
          color: 'yellow',
        });
      } else {
        notifications.show({
          title: 'Success',
          message: editingInstance
            ? 'Instance updated successfully'
            : 'Instance created successfully',
          color: 'green',
        });
      }

      loadInstances();
      loadHealth();
    } catch (error) {
      const conflict = getInstanceConflict(error);

      if (conflict?.code === INSTANCE_CONFLICT.duplicateName) {
        setNameError(t('instances.duplicateName', { name: formData.name.trim() }));
        return;
      }

      if (conflict?.code === INSTANCE_CONFLICT.duplicateAdminAPIURL) {
        setUrlConflict(conflict.conflicting_instance ?? '');
        return;
      }

      notifications.show({
        title: 'Error',
        message: 'Failed to save instance',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => submitInstance(false);

  /**
   * Opens the delete confirmation and loads what the deletion would orphan. The
   * instance is not touched until the operator confirms.
   */
  const openDeleteModal = async (instance: Instance) => {
    setPendingDelete({ instance, dependencies: null });
    try {
      const dependencies = await instanceApi.dependencies(instance.id);
      setPendingDelete({ instance, dependencies });
    } catch {
      setPendingDelete(null);
      notifications.show({
        title: 'Error',
        message: 'Failed to check what depends on this instance',
        color: 'red',
      });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete.instance;

    setDeleting(true);
    try {
      await instanceApi.delete(id, true);
      notifications.show({
        title: 'Success',
        message: 'Instance deleted successfully',
        color: 'green',
      });
      if (currentInstanceId === id) {
        setCurrentInstanceId('');
      }
      setPendingDelete(null);
      loadInstances();
      loadHealth();
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete instance',
        color: 'red',
      });
    } finally {
      setDeleting(false);
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
      // Keep the Connectivity column consistent with what the test just reported.
      loadHealth();
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
    setNameError(null);
    setUrlConflict(null);
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
            <Title order={1}>{t('sources.instances')}</Title>
            <Text c="dimmed" mt={4}>
              {t('instances.subtitle')}
            </Text>
          </Box>
          {instances.length > 0 && (
            <Button
              leftSection={<IconPlus width="18" height="18" />}
              onClick={() => { resetForm(); setModalOpen(true); }}
              className="animate-pulse-hover"
            >
              {t('instances.addInstance')}
            </Button>
          )}
        </Group>
      </Box>

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('instances.columnName')}</Table.Th>
              <Table.Th>{t('instances.columnAdminUrl')}</Table.Th>
              <Table.Th>
                <Tooltip label={t('instances.enabledHint')}>
                  <span>{t('instances.columnEnabled')}</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label={t('instances.connectivityHint')}>
                  <span>{t('instances.columnConnectivity')}</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>{t('instances.columnActiveManager')}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{t('table.actions')}</Table.Th>
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
                      {instance.is_active ? t('instances.enabled') : t('instances.disabled')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <ConnectivityBadge health={health[instance.id]} loaded={healthLoaded} />
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
                        <ActionIcon variant="light" color="red" aria-label="Delete" onClick={() => openDeleteModal(instance)}>
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
                <Table.Td colSpan={6}>
                  <Box className="EmptyState-root" ta="center">
                    <IconServer width="48" height="48" color="var(--text-tertiary)" />
                    <Text fw={600} size="lg" mt="md" c="var(--text-primary)">
                      {t('instances.emptyTitle')}
                    </Text>
                    <Text c="dimmed" size="sm" mt="xs" mb="lg">
                      {t('instances.emptyBody')}
                    </Text>
                    <Button
                      leftSection={<IconPlus width="16" height="16" />}
                      onClick={() => { resetForm(); setModalOpen(true); }}
                    >
                      {t('instances.addInstance')}
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
            error={nameError}
            onChange={(e) => {
              setNameError(null);
              setFormData({ ...formData, name: e.target.value });
            }}
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
                <Text fw={500} size="sm">{t('instances.enabledFieldLabel')}</Text>
                <Text size="xs" c="dimmed">{t('instances.enabledFieldHint')}</Text>
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
              {t('form.btn.cancel')}
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              {editingInstance ? t('instances.saveChanges') : t('instances.createInstance')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={urlConflict !== null}
        onClose={() => setUrlConflict(null)}
        title={t('instances.duplicateUrlTitle')}
        size="md"
      >
        <Stack gap="md">
          <Text size="sm">
            {t('instances.duplicateUrlBody', { name: urlConflict ?? '' })}
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setUrlConflict(null)}>
              {t('form.btn.cancel')}
            </Button>
            <Button color="yellow" loading={saving} onClick={() => submitInstance(true)}>
              {t('instances.saveAnyway')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('instances.deleteTitle', { name: pendingDelete?.instance.name ?? '' })}
        size="md"
      >
        <Stack gap="md">
          {pendingDelete?.dependencies ? (
            <DeleteImpact dependencies={pendingDelete.dependencies} />
          ) : (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                {t('instances.checking')}
              </Text>
            </Group>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setPendingDelete(null)}>
              {t('form.btn.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleting}
              disabled={!pendingDelete?.dependencies}
              onClick={confirmDelete}
            >
              {t('instances.deleteConfirm')}
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

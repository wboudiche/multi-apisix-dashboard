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
  Center,
  Container,
  Grid,
  Group,
  Loader,
  Paper,
  RingProgress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import IconActivity from '~icons/material-symbols/activity-zone-outline';
import IconCheck from '~icons/material-symbols/check-circle-outline';
import IconServer from '~icons/material-symbols/dns-outline';
import IconError from '~icons/material-symbols/error-outline';
import IconUpstream from '~icons/material-symbols/hub-outline';
import IconRefresh from '~icons/material-symbols/refresh';
import IconRoute from '~icons/material-symbols/route-outline';
import IconService from '~icons/material-symbols/settings-suggest-outline';

type ResourceStats = {
  routes: number;
  services: number;
  upstreams: number;
};

type InstanceHealth = {
  instance_id: string;
  name: string;
  status: string;
  last_check: string;
  error?: string;
};

type OverviewData = {
  total_instances: number;
  active_instances: number;
  global_stats: ResourceStats;
  instance_stats: ResourceStats;
  all_instances: InstanceHealth[];
};

const Overview = () => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth:access_token');
      const response = await fetch(`/api/v1/overview${forceRefresh ? '?refresh=true' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        setData(await response.json());
      }
    } catch {
      notifications.show({
        title: 'Error',
        message: 'Failed to load dashboard overview',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview(true);
    // Poll every 30s
    const timer = setInterval(() => fetchOverview(true), 30000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !data) {
    return (
      <Center style={{ height: '50vh' }}>
        <Loader size="lg" />
      </Center>
    );
  }

  const activePercent = data ? (data.active_instances / data.total_instances) * 100 : 0;

  return (
    <Container size="xl" className="animate-fade-in-up">
      <Box className="PageTitle-root" mb="xl">
        <Group justify="space-between">
          <Box>
            <Title order={1}>Dashboard Overview</Title>
            <Text c="dimmed" mt={4}>
              System health and resource utilization summary
            </Text>
          </Box>
          <Button 
            variant="light" 
            leftSection={<IconRefresh width="18" height="18" />}
            onClick={() => fetchOverview(true)}
            loading={loading}
          >
            Refresh Data
          </Button>
        </Group>
      </Box>

      <Grid gutter="lg">
        {/* Health Summary Widget */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper className="Card-root" p="xl" h="100%">
            <Group justify="space-between" mb="md">
              <Text fw={600} size="lg">Gateway Health</Text>
              <ThemeIcon variant="light" color="apisix-red" size="lg" radius="md">
                <IconActivity width="20" height="20" />
              </ThemeIcon>
            </Group>
            
            <Center>
              <RingProgress
                size={160}
                thickness={14}
                roundCaps
                label={
                  <Center>
                    <Stack gap={0} align="center">
                      <Text fw={700} size="xl">{data?.active_instances}/{data?.total_instances}</Text>
                      <Text size="xs" c="dimmed">Online</Text>
                    </Stack>
                  </Center>
                }
                sections={[
                  { value: activePercent, color: 'green', tooltip: 'Healthy Gateways' },
                  { value: 100 - activePercent, color: 'red', tooltip: 'Disconnected Gateways' },
                ]}
              />
            </Center>
            
            <Stack gap="xs" mt="lg">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Operational Status</Text>
                <Badge color={activePercent === 100 ? 'green' : 'orange'} variant="light">
                  {activePercent === 100 ? 'All Clear' : 'Issues Detected'}
                </Badge>
              </Group>
            </Stack>
          </Paper>
        </Grid.Col>

        {/* Global Resource Stats Widget */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Paper className="Card-root" p="xl" h="100%">
            <Group justify="space-between" mb="xl">
              <Box>
                <Text fw={600} size="lg">Global Resource Matrix</Text>
                <Text size="xs" c="dimmed">Consolidated resources across all accessible instances</Text>
              </Box>
              <ThemeIcon variant="light" color="blue" size="lg" radius="md">
                <IconServer width="20" height="20" />
              </ThemeIcon>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xl">
              <Box>
                <Group gap="xs" mb="xs">
                  <IconRoute width="18" height="18" color="var(--brand)" />
                  <Text size="sm" fw={500} c="dimmed">Total Routes</Text>
                </Group>
                <Title order={2}>{data?.global_stats.routes}</Title>
              </Box>
              <Box>
                <Group gap="xs" mb="xs">
                  <IconService width="18" height="18" color="var(--brand)" />
                  <Text size="sm" fw={500} c="dimmed">Total Services</Text>
                </Group>
                <Title order={2}>{data?.global_stats.services}</Title>
              </Box>
              <Box>
                <Group gap="xs" mb="xs">
                  <IconUpstream width="18" height="18" color="var(--brand)" />
                  <Text size="sm" fw={500} c="dimmed">Total Upstreams</Text>
                </Group>
                <Title order={2}>{data?.global_stats.upstreams}</Title>
              </Box>
            </SimpleGrid>

            <Paper withBorder p="md" mt="xl" bg="var(--surface-1)" radius="md">
              <Group justify="space-between">
                <Text size="sm" fw={500}>System Configuration</Text>
                <Text size="xs" c="dimmed">All data persistent in etcd cluster</Text>
              </Group>
            </Paper>
          </Paper>
        </Grid.Col>

        {/* Detailed Instance Health List */}
        <Grid.Col span={12}>
          <Paper className="Card-root" p="xl">
            <Title order={3} mb="lg">Instance Connectivity</Title>
            <Table horizontalSpacing="md" verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Gateway Instance</Table.Th>
                  <Table.Th>Connectivity</Table.Th>
                  <Table.Th>Last Check</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Diagnostic</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data?.all_instances.map((inst, index) => (
                  <Table.Tr key={inst.instance_id} className={`stagger-${(index % 5) + 1}`}>
                    <Table.Td>
                      <Text fw={600} size="sm">{inst.name}</Text>
                      <Text size="10px" ff="monospace" c="dimmed">{inst.instance_id}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        {inst.status === 'Connected' ? 
                          <IconCheck width="16" height="16" color="green" /> : 
                          <IconError width="16" height="16" color="red" />
                        }
                        <Text size="sm" fw={500} c={inst.status === 'Connected' ? 'green' : 'red'}>
                          {inst.status}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {new Date(inst.last_check).toLocaleTimeString()}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {inst.error ? (
                        <Tooltip label={inst.error}>
                          <Badge color="red" variant="dot" size="sm">Log Error</Badge>
                        </Tooltip>
                      ) : (
                        <Badge color="green" variant="dot" size="sm">Stable</Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Grid.Col>
      </Grid>
    </Container>
  );
};

export const Route = createFileRoute('/overview/')({
  component: Overview,
});

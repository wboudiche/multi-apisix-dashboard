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
  AppShell,
  Badge,
  Box,
  Burger,
  Group,
  Image,
  Menu,
  Select,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useAtom, useSetAtom } from 'jotai';
import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { instanceApi, type InstanceHealth } from '@/apis/instances';
import { type Team, teamApi } from '@/apis/teams';
import apisixLogo from '@/assets/apisix-logo.svg';
import { queryClient } from '@/config/global';
import { usePermission } from '@/hooks/usePermission';
import { currentUserAtom, logoutActionAtom, userInstancesAtom } from '@/stores/auth';
import { currentInstanceIdAtom, instancesAtom, setInstancesAtom } from '@/stores/instance';
import { currentTeamIdAtom } from '@/stores/team';
import IconMenu from '~icons/material-symbols/menu';
import IconMenuOpen from '~icons/material-symbols/menu-open';

import { LanguageMenu } from './LanguageMenu';

const Logo = () => {
  const { t } = useTranslation();
  return (
    <Image src={apisixLogo} alt={t('apisix.logo')} w={24} h={24} fit="fill" />
  );
};

/** Small pulsing health dot */
const HealthDot: FC<{ status?: 'Connected' | 'Disconnected'; error?: string }> = ({ status, error }) => {
  const isConnected = status === 'Connected';
  const color = isConnected ? '#10b981' : status === 'Disconnected' ? '#ef4444' : '#6b7280';
  const label = isConnected ? 'Connected' : status === 'Disconnected' ? `Disconnected${error ? ': ' + error : ''}` : 'Checking…';

  return (
    <Tooltip label={label} withArrow>
      <Box
        component="span"
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: isConnected ? `0 0 6px 2px ${color}60` : 'none',
          animation: isConnected ? 'healthPulse 2s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
};

type TeamSwitcherProps = {
  teams: Team[];
  isAdmin: boolean;
};

const TeamSwitcher: FC<TeamSwitcherProps> = ({ teams, isAdmin }) => {
  const [currentTeamId, setCurrentTeamId] = useAtom(currentTeamIdAtom);

  const handleTeamChange = (value: string | null) => {
    const newTeamId = value ?? '';
    setCurrentTeamId(newTeamId);
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
    queryClient.invalidateQueries({ queryKey: ['upstreams'] });
  };

  if (isAdmin) {
    const teamData = [
      { value: '', label: 'All Teams' },
      ...teams.map((t) => ({ value: t.id, label: t.name })),
    ];

    return (
      <Select
        placeholder="All Teams"
        data={teamData}
        value={currentTeamId}
        onChange={handleTeamChange}
        style={{ width: 160 }}
        clearable={false}
      />
    );
  }

  // developer / viewer — read-only badge showing their team
  const currentTeam = teams.find((t) => t.id === currentTeamId);
  if (!currentTeam) return null;

  return (
    <Badge variant="outline" color="apisix-red" size="sm" radius="sm">
      {currentTeam.name}
    </Badge>
  );
};

type HeaderProps = {
  opened: boolean;
  toggle: () => void;
  collapsed?: boolean;
  onCollapseToggle?: () => void;
};

export const Header: FC<HeaderProps> = (props) => {
  const { opened, toggle, collapsed, onCollapseToggle } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [currentUser] = useAtom(currentUserAtom);
  const [instances] = useAtom(instancesAtom);
  const [userInstances, setUserInstances] = useAtom(userInstancesAtom);
  const [currentInstanceId, setCurrentInstanceId] = useAtom(currentInstanceIdAtom);
  const [teams, setTeams] = useState<Team[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, InstanceHealth>>({});
  const setInstances = useSetAtom(setInstancesAtom);
  const logout = useSetAtom(logoutActionAtom);

  // Load header data on mount and when user/instance changes
  useEffect(() => {
    const loadHeaderData = async () => {
      try {
        const data = await instanceApi.list();
        setInstances(data);

        // Auto-select when nothing is selected, or when the stored id no
        // longer matches a known instance (stale localStorage would leave
        // InstanceGuard stuck on the "no instance" empty state forever)
        const isStale =
          currentInstanceId && !data.some((inst) => inst.id === currentInstanceId);
        if ((!currentInstanceId || isStale) && data.length > 0) {
          setCurrentInstanceId(data[0].id);
        }

        if (currentUser) {
          const userInstData = await instanceApi.getUserInstances(currentUser.id);
          setUserInstances(userInstData);

          const teamData = await teamApi.list();
          setTeams(teamData);
        }
      } catch (error) {
        console.error('Failed to load header data:', error);
      }
    };
    loadHeaderData();
  }, [currentUser, currentInstanceId]);

  // Poll instance health every 30 seconds
  const fetchHealth = useCallback(async () => {
    try {
      const healthData = await instanceApi.listHealth();
      const map: Record<string, InstanceHealth> = {};
      healthData.forEach((h) => { map[h.instance_id] = h; });
      setHealthMap(map);
    } catch {
      // Silently fail — health is supplemental
    }
  }, []);

  useEffect(() => {
    if (instances.length === 0) return;
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [instances.length, fetchHealth]);

  const activeUserInstance = userInstances.find(ui => ui.instance_id === currentInstanceId);
  const currentTeam = teams.find(t => t.id === activeUserInstance?.team_id);

  const handleLogout = () => {
    logout();
    localStorage.removeItem('auth:access_token');
    localStorage.removeItem('auth:refresh_token');
    localStorage.removeItem('auth:token_expiry');
    navigate({ to: '/login' });
  };

  // Build select data with health status
  const instanceData = instances.map((inst) => ({
    value: inst.id,
    label: inst.name,
  }));

  // Custom option renderer with health dot
  const renderOption = ({ option }: { option: { value: string; label: string } }) => {
    const health = healthMap[option.value];
    return (
      <Group gap={8} wrap="nowrap">
        <HealthDot status={health?.status} error={health?.error} />
        <Text size="sm" truncate>{option.label}</Text>
      </Group>
    );
  };

  // Current selection display with health dot
  const currentHealth = healthMap[currentInstanceId];

  const { isAdmin } = usePermission();

  return (
    <AppShell.Header>
      <Group h="100%" px="md" justify="space-between">
        <Group h="100%" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Tooltip label={collapsed ? t('common.expand') : t('common.collapse')} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onCollapseToggle}
              visibleFrom="sm"
              size="lg"
            >
              {collapsed ? <IconMenu /> : <IconMenuOpen />}
            </ActionIcon>
          </Tooltip>
          <Logo />
          <div>{t('apisix.dashboard')}</div>
        </Group>

        <Group h="100%" gap="md">
          {/* Instance Selector with Health Dots */}
          {instances.length > 0 && (
            <Group gap={6} wrap="nowrap">
              <HealthDot status={currentHealth?.status} error={currentHealth?.error} />
              <Select
                placeholder="Select instance"
                data={instanceData}
                value={currentInstanceId}
                onChange={(value) => setCurrentInstanceId(value || '')}
                style={{ width: 200 }}
                searchable
                allowDeselect={false}
                renderOption={renderOption}
              />
            </Group>
          )}

          {/* Team Switcher */}
          {teams.length > 0 && currentInstanceId && (
            <TeamSwitcher teams={teams} isAdmin={isAdmin} />
          )}

          <LanguageMenu />

          {/* User Menu */}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs">
                  {currentTeam && (
                    <Badge variant="outline" color="apisix-red" size="sm" radius="sm">
                      {currentTeam.name}
                    </Badge>
                  )}
                  <Box>
                    <Text size="sm" fw={600}>
                      {currentUser?.username || 'User'}
                    </Text>
                    {activeUserInstance && (
                      <Text size="10px" c="dimmed" style={{ marginTop: -4 }}>
                        {activeUserInstance.role.replace('_', ' ')}
                      </Text>
                    )}
                  </Box>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Account</Menu.Label>
              <Menu.Item>
                {currentUser?.email}
              </Menu.Item>
              <Menu.Item>
                Role: {currentUser?.role?.replace('_', ' ')}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={handleLogout}>
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </AppShell.Header>
  );
};

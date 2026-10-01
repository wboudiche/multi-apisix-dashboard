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
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { FC } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { instanceApi, type InstanceHealth } from '@/apis/instances';
import {
  instancesQueryOptions,
  teamsQueryOptions,
  userInstancesQueryOptions,
} from '@/apis/queries';
import { type Team } from '@/apis/teams';
import apisixLogo from '@/assets/apisix-logo.svg';
import { BuildIdentity } from '@/components/BuildIdentity';
import { queryClient } from '@/config/global';
import { healthReason } from '@/config/health-reason';
import { roleLabel } from '@/config/role-labels';
import { usePermission } from '@/hooks/usePermission';
import { currentUserAtom, logoutActionAtom, userInstancesAtom } from '@/stores/auth';
import { currentInstanceIdAtom, instancesAtom, setInstancesAtom } from '@/stores/instance';
import { currentTeamIdAtom, ownTeamsAtom, sentTeamIdAtom } from '@/stores/team';
import { describeError } from '@/utils/api-error';
import IconMenu from '~icons/material-symbols/menu';
import IconMenuOpen from '~icons/material-symbols/menu-open';

import { LanguageMenu } from './LanguageMenu';

/** How often the header re-probes every gateway it is allowed to see. */
const HEALTH_POLL_INTERVAL_MS = 30_000;

const Logo = () => {
  const { t } = useTranslation();
  return (
    <Image src={apisixLogo} alt={t('apisix.logo')} w={24} h={24} fit="fill" />
  );
};

/** Small pulsing health dot */
const HealthDot: FC<{ health?: InstanceHealth }> = ({ health }) => {
  const { t } = useTranslation();
  const status = health?.status;
  const reason = healthReason(t, health);
  const isConnected = status === 'Connected';
  const color = isConnected ? '#10b981' : status === 'Disconnected' ? '#ef4444' : '#6b7280';
  // Grey covers two states the dashboard tells apart in words: a gateway whose
  // status came back Unknown, with the reason if there is one, and one absent
  // from the map, which is still being checked and has no reason to give.
  const label = isConnected
    ? t('header.healthConnected')
    : status === 'Disconnected'
      ? reason
        ? t('header.healthDisconnectedWhy', { reason })
        : t('header.healthDisconnected')
      : status === 'Unknown'
        ? reason
          ? t('header.healthUnknownWhy', { reason })
          : t('header.healthUnknown')
        : t('header.healthChecking');

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
  // An admin's: the whole catalogue. A developer's or a viewer's: their own
  // teams on the instance, which is all they may choose between.
  teams: Pick<Team, 'id' | 'name'>[];
  isAdmin: boolean;
};

const TeamSwitcher: FC<TeamSwitcherProps> = ({ teams, isAdmin }) => {
  const { t } = useTranslation();
  const [currentTeamId, setCurrentTeamId] = useAtom(currentTeamIdAtom);
  // What this tab's requests carry: for a developer or a viewer, the pick
  // when it is one of the teams shown here, and none otherwise.
  const sentTeamId = useAtomValue(sentTeamIdAtom);

  const handleTeamChange = (value: string | null) => {
    const newTeamId = value ?? '';
    setCurrentTeamId(newTeamId);
    // A developer's or a viewer's lists are asked again by the header, when
    // what is sent for them changes - a pick is one way that happens.
    if (!isAdmin) return;
    queryClient.invalidateQueries({ queryKey: ['routes'] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
    queryClient.invalidateQueries({ queryKey: ['upstreams'] });
  };

  if (isAdmin) {
    const teamData = [
      { value: '', label: t('header.allTeams') },
      // `team`, not `t`: the parameter shadowed i18next's own `t` one line under
      // a call to it, which is how a translated option becomes a property of a
      // Team (#311 found the same shape on the Users page).
      ...teams.map((team) => ({ value: team.id, label: team.name })),
    ];

    return (
      <Select
        data-testid="team-switcher"
        placeholder={t('header.allTeams')}
        data={teamData}
        value={currentTeamId}
        onChange={handleTeamChange}
        style={{ width: 160 }}
        clearable={false}
      />
    );
  }

  // A developer or a viewer. With one team there is nothing to choose: its
  // name, so that they know whose resources they are looking at.
  if (teams.length === 1) {
    return (
      <Badge data-testid="team-badge" variant="outline" color="apisix-red" size="sm" radius="sm">
        {teams[0].name}
      </Badge>
    );
  }

  // With several (#301), which of them the lists show and a new resource goes
  // to. None picked shows all of theirs. What it shows as picked is what is
  // sent, so a pick that is not one of these teams - left by another tab, a
  // team they were taken off, one that was deleted - reads as none here
  // because none is sent for it (see teamToSend).
  return (
    <Select
      data-testid="team-switcher"
      aria-label={t('header.teamSwitcher')}
      data={[
        { value: '', label: t('header.allMyTeams') },
        ...teams.map((team) => ({ value: team.id, label: team.name })),
      ]}
      value={sentTeamId}
      onChange={handleTeamChange}
      style={{ width: 180 }}
      clearable={false}
      allowDeselect={false}
    />
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
  const setInstances = useSetAtom(setInstancesAtom);
  const logout = useSetAtom(logoutActionAtom);

  // One read of the instance list for the whole app: this and InstanceGuard
  // share the query, so it is fetched once and a retry in either place fills
  // both (#165).
  const {
    data: instanceList,
    error: instancesError,
  } = useQuery(instancesQueryOptions(currentUser?.id));

  useEffect(() => {
    if (!instanceList) return;
    setInstances(instanceList);

    // Auto-select when nothing is selected, or when the stored id no longer
    // matches a known instance (stale localStorage would leave InstanceGuard
    // stuck on the "no instance" empty state forever)
    const isStale =
      currentInstanceId && !instanceList.some((inst) => inst.id === currentInstanceId);
    if ((!currentInstanceId || isStale) && instanceList.length > 0) {
      setCurrentInstanceId(instanceList[0].id);
    }

  }, [instanceList, currentInstanceId, setCurrentInstanceId, setInstances]);

  useEffect(() => {
    if (!instancesError) return;
    // A header with no instance selector and no reason given for it reads as
    // "this account has no gateways", which is a different situation entirely.
    // describeError surfaces the backend's own reason, the way the instances
    // page already does for this same call; a stable id keeps repeats
    // collapsed into one notification.
    //
    // On the query's error rather than on one read of its own, so a background
    // refetch that fails says so too: the dashboard keeps running on the last
    // good list, deliberately, and this is what tells the operator that list
    // is no longer verified (#165).
    notifications.show({
      id: 'header-load-failed',
      title: t('header.loadFailedTitle'),
      message: describeError(instancesError, t('header.loadFailed')),
      color: 'red',
    });
  }, [instancesError, t]);

  // The account's own access list. Everyone may read their own, so a failure
  // here is a fault rather than the ordinary answer - and it is the list
  // usePermission reads a role out of, so absorbing it into an empty one takes
  // away what someone may do and gives no reason for it (#165). The fallback
  // stays as it was: usePermission drops back to user.role, which is empty for
  // every non-super_admin, so nothing widens - it narrows, quietly.
  const { data: accessList, error: accessError } = useQuery(
    userInstancesQueryOptions(currentUser?.id)
  );

  useEffect(() => {
    if (!accessList) return;
    setUserInstances(accessList);

  }, [accessList, setUserInstances]);

  useEffect(() => {
    if (!accessError) return;
    notifications.show({
      id: 'header-access-load-failed',
      title: t('header.accessLoadFailedTitle'),
      message: describeError(accessError, t('header.accessLoadFailed')),
      color: 'red',
    });
  }, [accessError, t]);

  // Deliberately quiet, and deliberately not reported like the two above.
  // /api/v1/teams is admin-only and answers 403 to a developer, which is the
  // ordinary case rather than a fault: they get no team switcher and that is
  // all. Announcing it would put a red toast on every page of every non-admin
  // session, blaming reads that worked.
  const { data: teams = [] } = useQuery({
    ...teamsQueryOptions(currentUser?.id),
    enabled: !!currentUser,
  });

  // Identity of the list rather than the array, which is a new reference on
  // every load even when nothing changed.
  const instanceIds = instances
    .map((inst) => inst.id)
    .sort()
    .join(',');

  // Health is polled rather than pushed, so it belongs to the data layer like
  // every other server read. Running it here as an effect meant calling the
  // fetcher synchronously on mount, which set state during the effect and
  // cascaded a render on every change to the instance list.
  const { data: healthMap = {} } = useQuery({
    // Scoped to the user: the endpoint answers within the caller's own
    // assignments, so a cached map must not outlive the session that read it.
    //
    // Keyed by the list too, because `enabled` only gates the first run. The
    // instances page writes the same atom this reads, so registering a gateway
    // there used to leave its dot grey on "Checking…" until the timer next came
    // round, and deleting one left the removed id in the map.
    queryKey: ['instance-health', currentUser?.id, instanceIds],
    queryFn: async () => {
      const healthData = await instanceApi.listHealth();
      return Object.fromEntries(
        healthData.map((h) => [h.instance_id, h])
      ) as Record<string, InstanceHealth>;
    },
    enabled: instances.length > 0,
    refetchInterval: HEALTH_POLL_INTERVAL_MS,
    // Health is supplemental: a failed probe leaves the dots on "Checking…"
    // rather than interrupting whatever the operator is doing.
    retry: false,
  });

  const activeUserInstance = userInstances.find(ui => ui.instance_id === currentInstanceId);
  const currentTeam = teams.find((team) => team.id === activeUserInstance?.team_id);

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
        <HealthDot health={health} />
        <Text size="sm" truncate>{option.label}</Text>
      </Group>
    );
  };

  // Current selection display with health dot
  const currentHealth = healthMap[currentInstanceId];

  const { isAdmin, role: effectiveRole } = usePermission();

  // A developer's or a viewer's own teams on this instance, out of the access
  // list above: the catalogue answers them 403. The same read the requests
  // are checked against (see ownTeamsAtom).
  const ownTeams = useAtomValue(ownTeamsAtom)[currentInstanceId];

  const switcherTeams = isAdmin ? teams : (ownTeams?.teams ?? []);

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
              <HealthDot health={currentHealth} />
              <Select
                data-testid="instance-switcher"
                placeholder={t('header.selectInstance')}
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
          {switcherTeams.length > 0 && currentInstanceId && (
            <TeamSwitcher teams={switcherTeams} isAdmin={isAdmin} />
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
                      {currentUser?.username || t('header.noUsername')}
                    </Text>
                    {/* The role that governs, not the assignment: an account
                        holding a viewer assignment and promoted to super admin
                        read "Viewer" here and "Role: Super Admin" one line
                        below, understating what it may do on the dashboard's
                        own authorization surface (#324). */}
                    {effectiveRole && (
                      <Text size="10px" c="dimmed" style={{ marginTop: -4 }}>
                        {roleLabel(t, effectiveRole)}
                      </Text>
                    )}
                  </Box>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('header.account')}</Menu.Label>
              {/* A Label for the same reason as the role below it and the
                  build line under that: an Item is a tab stop Enter does
                  nothing to, it closes the menu when clicked, and it cancels
                  mousedown - so the address could not be selected to be
                  pasted anywhere. */}
              <Menu.Label>{currentUser?.email}</Menu.Label>
              {effectiveRole && (
                // A Label, not an Item, for the reason the build line below
                // gives: an Item is a tab stop that does nothing, and clicking
                // this one to read it closes the menu.
                <Menu.Label>
                  {/* The same role, named the same way, as the line above it:
                      the two used to be spelled differently, and in four
                      languages out of five this one was not translated at
                      all (#319). */}
                  {t('header.accountRole', {
                    role: roleLabel(t, effectiveRole),
                  })}
                </Menu.Label>
              )}
              <Menu.Divider />
              {/* Which build this page is, where someone reporting a bug can
                  read it without an account that may enter Settings (#237).
                  A Label, not an Item: an Item takes a place in the menu's
                  keyboard order as something Enter does nothing to, closes the
                  menu when clicked, and cancels mousedown - so the sha could
                  not be selected to be pasted anywhere. */}
              <Menu.Label>
                <BuildIdentity />
              </Menu.Label>
              <Menu.Divider />
              <Menu.Item color="red" onClick={handleLogout}>
                {t('header.logout')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </AppShell.Header>
  );
};

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
  Checkbox,
  Container,
  Group,
  Modal,
  MultiSelect,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
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

import { type User } from '@/apis/auth';
import { instanceApi, roleInTeam, type TeamRole, teamsOf, type UserInstanceRole } from '@/apis/instances';
import { type Team,teamApi } from '@/apis/teams';
import { userApi } from '@/apis/users';
import PageHeader from '@/components/page/PageHeader';
import { PasswordRequirements } from '@/components/PasswordRequirements';
import { globalRoleLabel, INSTANCE_ROLES, roleColor, roleLabel } from '@/config/role-labels';
import { currentUserAtom } from '@/stores/auth';
import { instancesAtom } from '@/stores/instance';
import { describeError } from '@/utils/api-error';
import { policyRefusal } from '@/utils/policy-refusal';
import { recordDate } from '@/utils/record-date';
import IconPlus from '~icons/material-symbols/add';
import IconInstance from '~icons/material-symbols/dns-outline';
import IconGroup from '~icons/material-symbols/group-outline';
import IconKey from '~icons/material-symbols/key-outline';
import IconUser from '~icons/material-symbols/person-outline';
import IconShield from '~icons/material-symbols/shield-outline';

/** The create form's own state: every field is filled, edit reuses a subset. */
type UserFormData = {
  username: string;
  password: string;
  email: string;
  role: string;
  must_change_password: boolean;
};

/** One instance's assignment as the form holds it. */
type AssignmentForm = {
  role: string;
  /**
   * Every team of the assignment (#301), and the only place the form keeps
   * them: what it shows, what it checks and what it sends are this one list.
   */
  team_ids: string[];
  /**
   * The role in each team, for a developer or a viewer (#role-per-team). A
   * team picked starts with `role`; choosing `role` sets every team to it.
   */
  team_roles: Record<string, TeamRole>;
};

/** The roles a team can be held in. */
const TEAM_ROLES: TeamRole[] = ['developer', 'viewer'];

/** The strongest role held in the teams: what the backend stores as the role. */
const strongest = (roles: Record<string, TeamRole>, ids: string[]): TeamRole =>
  ids.some((id) => roles[id] === 'developer') ? 'developer' : 'viewer';

/**
 * For a developer or a viewer the teams are the whole of what they can see; an
 * instance admin is not tied to one. The backend's own rule, of the same name.
 */
const roleNeedsTeam = (role: string) => role === 'developer' || role === 'viewer';

const UsersPage = () => {
  const { t } = useTranslation();
  const [currentUser] = useAtom(currentUserAtom);
  const [availableInstances] = useAtom(instancesAtom);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  // Whether the teams have been read at all: until then a team the list does
  // not hold is one that has not arrived, not one that is gone.
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  // By name: the API answers in no particular order, a different one each time.
  const teamOptions = [...teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({ value: team.id, label: team.name }));
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>('basic');
  
  const [formData, setFormData] = useState<UserFormData>({
    username: '',
    password: '',
    email: '',
    role: 'user',
    must_change_password: true,
  });

  const [userAssignments, setUserAssignments] = useState<Record<string, UserInstanceRole[]>>({});
  // The users whose assignments could not be read, and why. An unreadable
  // list used to be stored as an empty one, and this table is the only place
  // a super admin sees who may do what: "none" and "could not be read" have
  // to look different here (#165).
  const [unreadableAssignments, setUnreadableAssignments] = useState<Record<string, string>>({});
  // The assignments the open dialog was seeded from. Removals are decided
  // against these, not against whatever has landed by the time Save is
  // pressed: the table renders - and the Permissions button works - while the
  // per-user reads are still in flight, so a dialog opened in that window is
  // seeded from nothing while the list fills in behind it. Compared against
  // the later list, every role the form does not show reads as "cleared", and
  // saving an e-mail change took the account's access away.
  const [seededAssignments, setSeededAssignments] = useState<UserInstanceRole[]>([]);
  /**
   * The teams picked for an instance, in the order the assignment was stored
   * in: the teams it already held where they were, the ones added behind them
   * in the order they were added. The first team of an assignment is still the
   * one `team_id` names and the header shows, and the field alone would move a
   * team unticked and ticked again to the end.
   */
  const inStoredOrder = (instanceId: string, ids: string[]) => {
    const seeded = seededAssignments.find((a) => a.instance_id === instanceId);
    const stored = seeded ? teamsOf(seeded) : [];
    const at = (id: string) => {
      const index = stored.indexOf(id);
      return index === -1 ? stored.length : index;
    };
    // Stable, so the teams that are new keep the order of the clicks.
    return [...ids].sort((a, b) => at(a) - at(b));
  };
  const [instanceRoles, setInstanceRoles] = useState<Record<string, AssignmentForm>>({});


  const isSuperAdmin = currentUser?.role === 'super_admin';

  const loadData = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      // Read before it is shown: a body that is not a list of users throws
      // here rather than reaching state, where the next render's map over it
      // replaced the page with the root's error component (#165).
      const loadedUsers = await userApi.list();
      setUsers(loadedUsers);

      // Before the teams read, which may throw: these two maps are what the
      // rows just committed are rendered against, and leaving last load's
      // behind would show a user added since as having no assignments.
      // Load instance assignments for each user
      const assignments: Record<string, UserInstanceRole[]> = {};
      const unreadable: Record<string, string> = {};
      await Promise.all(
        loadedUsers.map(async (user) => {
          try {
            assignments[user.id] = await instanceApi.getUserInstances(user.id);
          } catch (err) {
            unreadable[user.id] = describeError(err, t('users.assignmentsUnreadable'));
          }
        })
      );
      setUserAssignments(assignments);
      setUnreadableAssignments(unreadable);

      const teamData = await teamApi.list();
      setTeams(teamData);
      setTeamsLoaded(true);

      const failed = Object.keys(unreadable).length;
      if (failed > 0) {
        notifications.show({
          // One report for the whole load: this fans out one request per user,
          // and a backend that is down fails all of them.
          id: 'users-assignments-unreadable',
          title: t('users.assignmentsUnreadableTitle'),
          message: t('users.assignmentsUnreadableBody', {
            count: failed,
            reason: Object.values(unreadable)[0],
          }),
          color: 'red',
        });
      }
    } catch (err) {
      notifications.show({
        title: t('users.errorTitle'),
        message: describeError(err, t('users.loadFailed')),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, t]);

  useEffect(() => {
    // A fetch on mount. The setState this rule flags is that request's own
    // loading flag, raised as it starts — not state derived from other state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleSubmit = async () => {
    // Validate team selection for developer/viewer roles
    for (const instanceID in instanceRoles) {
      const config = instanceRoles[instanceID];
      if (roleNeedsTeam(config.role) && config.team_ids.length === 0) {
        notifications.show({
          message: t('users.teamRequired'),
          color: 'red',
        });
        return;
      }
    }

    try {
      let userId: string;

      // Only create user if not editing
      if (!editingUser) {
        try {
          const newUser = await userApi.create({
            ...formData,
            role: formData.role === 'user' ? '' : formData.role,
          });
          userId = newUser.id;
        } catch (err) {
          notifications.show({
            title: t('users.errorTitle'),
            message: policyRefusal(t, err) ?? describeError(err, t('users.createFailed')),
            color: 'red',
          });
          return;
        }
      } else {
        userId = editingUser.id;
        // Editing used to skip this entirely, so the global role picked in the
        // form was never sent anywhere — the form reported success having
        // changed nothing.
        try {
          await userApi.update(userId, {
            email: formData.email,
            role: formData.role === 'user' ? '' : formData.role,
          });
        } catch (err) {
          notifications.show({
            title: t('users.errorTitle'),
            message: describeError(err, t('users.updateFailed')),
            color: 'red',
          });
          return;
        }
      }

      // Removals first, writes second. Neither order is atomic - the API takes
      // one assignment at a time - so the question is which way a partial
      // failure should fail. This way it fails closed: a write refused after a
      // removal leaves the account with less access than intended, rather than
      // leaving the access someone was taking away in place while the grant
      // they paired it with went through.
      //
      // Clearing a role is what takes an access away. The Select has always
      // been clearable, and clearing it did nothing at all: the write loop
      // skips an entry with no role, and the dialog still closed on
      // "Permissions updated successfully" with the assignment untouched.
      //
      // Driven by the assignments this dialog was seeded from, not by the
      // form: one that could not be read - or had not arrived yet - leaves
      // nothing to iterate, so an empty form never reads as "remove
      // everything" for a user whose access the dashboard could not see in
      // the first place (#165).
      if (editingUser) {
        for (const assignment of seededAssignments) {
          if (instanceRoles[assignment.instance_id]?.role) continue;
          try {
            await instanceApi.removeUserRole(userId, assignment.instance_id);
          } catch (err) {
            notifications.show({
              title: t('users.errorTitle'),
              message: describeError(err, t('users.roleRemoveFailed')),
              color: 'red',
            });
            // The rows behind this dialog were read before any of this ran, so
            // leaving without a reload shows an account's access as it was
            // before a save that partly went through.
            loadData();
            return;
          }
        }
      }

      // Save instance specific roles and teams
      for (const instanceID in instanceRoles) {
        const config = instanceRoles[instanceID];
        if (config.role) {
          // Every one of these was previously unchecked, so a rejected
          // assignment still ended in a success toast.
          try {
            const needsTeams = roleNeedsTeam(config.role);
            await instanceApi.setUserRole(userId, instanceID, {
              // The strongest team role: what the backend stores as role.
              role: needsTeams ? strongest(config.team_roles, config.team_ids) : config.role,
              team_ids: config.team_ids,
              ...(needsTeams ? {
                team_roles: Object.fromEntries(
                  config.team_ids.map((id) => [id, config.team_roles[id] ?? 'viewer'])
                ),
              } : {}),
            });
          } catch (err) {
            notifications.show({
              title: t('users.errorTitle'),
              message: describeError(err, t('users.roleAssignFailed')),
              color: 'red',
            });
            loadData();
            return;
          }
        }
      }

      notifications.show({
        title: t('users.successTitle'),
        message: editingUser
          ? t('users.permissionsUpdated')
          : t('users.createdWithPermissions'),
        color: 'green',
      });
      setModalOpen(false);
      resetForm();
      loadData();
    } catch {
      notifications.show({
        title: t('users.errorTitle'),
        message: editingUser
          ? t('users.permissionsFailed')
          : t('users.createFailed'),
        color: 'red',
      });
    }
  };

  const openResetModal = (user: User) => {
    setResetUser(user);
    setResetPassword('');
  };

  const handleResetPassword = async () => {
    if (!resetUser) return;
    setResetLoading(true);
    try {
      await userApi.resetPassword(resetUser.id, resetPassword);

      notifications.show({
        title: t('users.resetSuccess'),
        message: t('users.resetSuccessMessage', { username: resetUser.username }),
        color: 'green',
      });
      setResetUser(null);
      setResetPassword('');
    } catch (err) {
      notifications.show({
        title: t('users.resetFailed'),
        message: policyRefusal(t, err) ?? describeError(err, t('users.resetFailed')),
        color: 'red',
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm(t('users.deleteConfirm'))) return;
    try {
      await userApi.delete(userId);
      notifications.show({
        title: t('users.successTitle'),
        message: t('users.deleted'),
        color: 'green',
      });
    } catch (err) {
      // A refused delete — the last super admin, an id already gone — said
      // nothing, the row still there as though the click had missed (#210).
      notifications.show({
        title: t('users.errorTitle'),
        message: describeError(err, t('users.deleteFailed')),
        color: 'red',
      });
    }
    // Reloaded either way: a user already gone leaves the list.
    loadData();
  };

  /** Closes the dialog and clears what it was editing. */
  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      email: '',
      role: 'user',
      must_change_password: true,
    });
    // The per-instance roles too. Add User calls this and then opens the same
    // dialog, which is seeded from this state: without it, the roles of the
    // account edited before were written to the account being created - on the
    // Instance Access tab, which the dialog does not open on.
    setInstanceRoles({});
    setSeededAssignments([]);
    setActiveTab('basic');
  };

  if (!isSuperAdmin) {
    return (
      <Container size="xl">
        <Paper p="xl" withBorder className="Card-root" ta="center">
          <IconShield width="48" height="48" color="var(--brand)" />
          <Title order={2} mt="md">{t('users.accessDeniedTitle')}</Title>
          <Text c="dimmed" mt="sm">
            {t('users.accessDeniedBody')}
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
      must_change_password: false,
    });
    // Load existing instance assignments
    const assignments = userAssignments[user.id] || [];
    setSeededAssignments(assignments);
    const roles: Record<string, AssignmentForm> = {};
    for (const a of assignments) {
      roles[a.instance_id] = {
        role: a.role,
        team_ids: teamsOf(a),
        team_roles: Object.fromEntries(teamsOf(a).map((id) => [id, roleInTeam(a, id) ?? 'viewer'])),
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
        title={t('users.pageTitle')}
        extra={
          <Button
            leftSection={<IconPlus width="18" height="18" />}
            onClick={() => { resetForm(); setModalOpen(true); }}
          >
            {t('users.addUser')}
          </Button>
        }
      />

      <Paper className="Card-root" p={0}>
        <Table horizontalSpacing="lg" verticalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('users.columnUser')}</Table.Th>
              <Table.Th>{t('users.columnRole')}</Table.Th>
              <Table.Th>{t('users.columnInstances')}</Table.Th>
              <Table.Th>{t('users.columnTeams')}</Table.Th>
              <Table.Th>{t('users.columnCreated')}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{t('table.actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user, index) => {
              const assignments = getAssignments(user.id);
              // Every team of every assignment, once. One that no longer
              // exists is shown by its id rather than left out: the form shows
              // it and the backend holds it, and a column saying "none" beside
              // them was this screen contradicting itself.
              // Only once the teams have been read: before that, or when
              // that read failed, every team would show as an id.
              const memberships = assignments.flatMap((a) =>
                teamsOf(a).map((id) => ({
                  key: `${a.instance_id}:${id}`,
                  instance: availableInstances.find((i) => i.id === a.instance_id)?.name ?? a.instance_id,
                  team: teamById.get(id) ?? (teamsLoaded ? { id, name: id } : undefined),
                  role: roleInTeam(a, id),
                }))
              ).filter((m) => m.team !== undefined);

              return (
              <Table.Tr key={user.id} className={`stagger-${(index % 5) + 1}`}>
                <Table.Td>
                  <Group gap="sm">
                    <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
                      <IconUser width="18" height="18" />
                    </ThemeIcon>
                    <Box>
                      <Text fw={600} size="sm">{user.username}</Text>
                      <Text size="xs" c="dimmed">{user.email || t('users.noEmail')}</Text>
                    </Box>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={roleColor(user.role)}
                    variant="light"
                    leftSection={<IconShield width="12" height="12" />}
                  >
                    {globalRoleLabel(t, user.role)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {user.role === 'super_admin' ? (
                    <Text size="xs" c="dimmed" fs="italic">{t('users.allInstances')}</Text>
                  ) : unreadableAssignments[user.id] ? (
                    <Text size="xs" c="red">{t('users.assignmentsUnreadable')}</Text>
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
                            <Text size="xs" c="dimmed">({roleLabel(t, a.role)})</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  )}
                </Table.Td>
                <Table.Td>
                  {user.role === 'super_admin' ? (
                    <Text size="xs" c="dimmed" fs="italic">{t('users.allTeams')}</Text>
                  ) : unreadableAssignments[user.id] ? (
                    // Derived from the assignments, so it is unknown for the
                    // same reason rather than empty.
                    <Text size="xs" c="red">{t('users.assignmentsUnreadable')}</Text>
                  ) : memberships.length === 0 ? (
                    <Text size="xs" c="dimmed">—</Text>
                  ) : (
                    <Stack gap={4}>
                      {memberships.map((m) => (
                        <Tooltip key={m.key} label={m.instance}>
                          <Group gap={6} wrap="nowrap">
                            <IconGroup width="13" height="13" style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                            <Text size="xs" fw={500}>
                              {m.role
                                ? t('users.teamWithRole', { team: m.team!.name, role: roleLabel(t, m.role), interpolation: { escapeValue: false } })
                                : m.team!.name}
                            </Text>
                          </Group>
                        </Tooltip>
                      ))}
                    </Stack>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {recordDate(user.created_at) ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="filled" color="blue" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => openEditModal(user)}>
                      {t('users.permissions')}
                    </Button>
                    {user.id !== currentUser?.id && (
                      <Button size="xs" variant="light" color="orange" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => openResetModal(user)}>
                        {t('users.resetPassword')}
                      </Button>
                    )}
                    {user.id !== currentUser?.id && (
                      <Button size="xs" variant="filled" color="red" radius="sm" styles={{ root: { padding: '0 12px' } }} onClick={() => handleDelete(user.id)}>
                        {t('form.btn.delete')}
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
                    <Text fw={600} size="lg" mt="md">{t('users.emptyTitle')}</Text>
                    <Text c="dimmed" size="sm">{t('users.emptyBody')}</Text>
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
        title={editingUser ? t('users.dialogEditTitle') : t('users.dialogAddTitle')}
        size="lg"
      >
        {editingUser && unreadableAssignments[editingUser.id] && (
          // Above the tabs, because the dialog opens on Basic Info and this
          // is about the Access tab: inside it, the warning was only seen by
          // someone who had already gone looking.
          //
          // The form is seeded from the same read, so what it shows as "no
          // role" may simply be what could not be read. Nothing is removed for
          // this user - the removal loop walks the assignments that were read,
          // and for them there are none - but the person picking roles should
          // know what they are looking at (#165).
          <Paper p="sm" mb="md" withBorder bg="var(--surface-1)">
            <Text size="sm" c="red">
              {t('users.assignmentsUnreadableForm')}
            </Text>
          </Paper>
        )}

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List mb="lg" grow>
            <Tabs.Tab value="basic" leftSection={<IconUser width="16" height="16" />}>{t('users.tabBasic')}</Tabs.Tab>
            <Tabs.Tab value="access" leftSection={<IconInstance width="16" height="16" />} disabled={formData.role === 'super_admin'}>{t('users.tabAccess')}</Tabs.Tab>

          </Tabs.List>

          <Tabs.Panel value="basic">
            <Stack gap="md">
              <TextInput
                label={t('users.fieldUsername')}
                // This and the e-mail below stay as they are: they are
                // examples, not sentences, and a translator cannot improve
                // "johndoe" without inventing a different person.
                /* eslint-disable-next-line i18next/no-literal-string */
                placeholder="johndoe"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                disabled={!!editingUser}
                data-autofocus
              />
              <TextInput
                label={t('users.fieldEmail')}
                /* eslint-disable-next-line i18next/no-literal-string */
                placeholder="john@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
              {!editingUser && (
                <TextInput
                  label={t('users.fieldPassword')}
                  placeholder={t('users.fieldPasswordPlaceholder')}
                  required
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  leftSection={<IconKey width="16" height="16" />}
                />
              )}
              {!editingUser && <PasswordRequirements password={formData.password} />}
              {!editingUser && (
                <Checkbox
                  label={t('changePassword.requireOnFirstLogin')}
                  checked={formData.must_change_password}
                  onChange={(e) =>
                    setFormData({ ...formData, must_change_password: e.currentTarget.checked })
                  }
                />
              )}
              <Select
                label={t('users.fieldGlobalRole')}
                description={t('users.fieldGlobalRoleDesc')}
                value={formData.role}
                onChange={(value) => setFormData({ ...formData, role: value || 'user' })}
                data={[
                  { value: 'super_admin', label: t('users.roleOptionSuperAdmin') },
                  { value: 'user', label: t('users.roleOptionUser') },
                ]}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="access">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                {t('users.accessHint')}
              </Text>

              {availableInstances.length === 0 ? (
                <Paper p="md" withBorder ta="center" bg="var(--surface-1)">
                  <Text size="sm">{t('users.noInstances')}</Text>
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
                              <Badge size="xs" variant="light" color="blue">{t('users.assigned')}</Badge>
                            )}
                          </Group>
                          <Group gap="sm" grow>
                            <Select
                              size="sm"
                              label={t('users.fieldInstanceRole')}
                              placeholder={t('users.fieldInstanceRolePlaceholder')}
                              clearable
                              // Mantine hides its clear button from the
                              // accessibility tree and takes it out of the tab
                              // order. This Select has no "no access" option,
                              // so that button is the only way to take an
                              // access away - and this is the dashboard's
                              // authorization screen. It gets a name, a tab
                              // stop, and a place in the tree.
                              clearButtonProps={{
                                'aria-label': t('users.clearRole'),
                                'aria-hidden': false,
                                tabIndex: 0,
                              }}
                              value={config?.role || null}
                              onChange={(role) => {
                                const teamIds = instanceRoles[inst.id]?.team_ids || [];
                                const current = instanceRoles[inst.id]?.team_roles || {};
                                setInstanceRoles({
                                  ...instanceRoles,
                                  [inst.id]: {
                                    ...instanceRoles[inst.id],
                                    role: role || '',
                                    team_ids: teamIds,
                                    // A developer or a viewer sets every team to it;
                                    // otherwise the roles stay, unsent for an admin.
                                    team_roles: role && roleNeedsTeam(role)
                                      ? Object.fromEntries(teamIds.map((id) => [id, role as TeamRole]))
                                      : current,
                                  },
                                });
                              }}
                              data={INSTANCE_ROLES.map((role) => ({
                                value: role,
                                label: roleLabel(t, role),
                              }))}
                            />
                            {/* For every role, though only a developer or a
                                viewer must have a team: an instance admin's
                                list is sent with the rest, and hidden it could
                                neither be seen nor emptied. */}
                            {config?.role && (
                              <MultiSelect
                                size="sm"
                                label={t('users.fieldTeam')}
                                // Mantine keeps showing the placeholder beside
                                // the teams picked.
                                placeholder={config.team_ids.length ? undefined : t('users.fieldTeamPlaceholder')}
                                // Typing narrows a long list of teams - and
                                // without it Mantine hides the field itself
                                // once a team is picked and there is no
                                // placeholder, leaving nothing to focus.
                                searchable
                                clearable
                                // As for the role above: named, in the tab
                                // order and in the tree.
                                clearButtonProps={{
                                  'aria-label': t('users.clearTeams'),
                                  'aria-hidden': false,
                                  tabIndex: 0,
                                }}
                                required={roleNeedsTeam(config.role)}
                                data={teamOptions}
                                value={config.team_ids}
                                onChange={(teamIds) => {
                                  const ordered = inStoredOrder(inst.id, teamIds);
                                  const current = instanceRoles[inst.id]?.team_roles || {};
                                  const role = instanceRoles[inst.id]?.role || '';
                                  setInstanceRoles({
                                    ...instanceRoles,
                                    [inst.id]: {
                                      ...instanceRoles[inst.id],
                                      team_ids: ordered,
                                      role,
                                      // A team already there keeps its role; a new one
                                      // takes the role field's.
                                      team_roles: Object.fromEntries(
                                        ordered.map((id) => [id, current[id] ?? (roleNeedsTeam(role) ? (role as TeamRole) : 'viewer')])
                                      ),
                                    },
                                  });
                                }}
                              />
                            )}
                          </Group>
                          {roleNeedsTeam(config.role) && config.team_ids.length > 0 && (
                            <Stack gap={4} data-testid={`team-roles-${inst.id}`}>
                              <Text size="xs" fw={500}>{t('users.teamRoles')}</Text>
                              {config.team_ids.map((teamId) => {
                                const name = teamById.get(teamId)?.name ?? teamId;
                                return (
                                  <Group key={teamId} gap="sm" justify="space-between" wrap="nowrap">
                                    <Text size="sm">{name}</Text>
                                    <SegmentedControl
                                      size="xs"
                                      aria-label={t('users.teamRoleIn', { team: name, interpolation: { escapeValue: false } })}
                                      value={config.team_roles[teamId] ?? 'viewer'}
                                      data={TEAM_ROLES.map((role) => ({ value: role, label: roleLabel(t, role) }))}
                                      onChange={(role) => setInstanceRoles({
                                        ...instanceRoles,
                                        [inst.id]: {
                                          ...config,
                                          team_roles: { ...config.team_roles, [teamId]: role as TeamRole },
                                        },
                                      })}
                                    />
                                  </Group>
                                );
                              })}
                            </Stack>
                          )}
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
          {/* The same teardown as the dialog's own onClose: Cancel used to
              leave the edited account's form state and per-instance role map
              behind for whatever opened the dialog next. */}
          <Button variant="subtle" color="gray" onClick={closeModal}>
            {t('form.btn.cancel')}
          </Button>
          <Button onClick={handleSubmit}>
            {editingUser ? t('form.btn.saveChanges') : t('users.submitCreate')}
          </Button>
        </Group>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        opened={!!resetUser}
        onClose={() => setResetUser(null)}
        title={t('users.resetPassword')}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t('users.resetHint', { username: resetUser?.username ?? '' })}
          </Text>
          <PasswordInput
            label={t('users.tempPassword')}
            placeholder={t('users.tempPasswordPlaceholder')}
            required
            data-autofocus
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            leftSection={<IconKey width="16" height="16" />}
          />
          <PasswordRequirements password={resetPassword} />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setResetUser(null)}>
              {t('form.btn.cancel')}
            </Button>
            <Button color="orange" loading={resetLoading} onClick={handleResetPassword}>
              {t('users.resetPassword')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export const Route = createFileRoute('/users/')({
  component: UsersPage,
});

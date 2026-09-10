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

import { Box, Button, Center, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { instanceApi } from '@/apis/instances';
import { currentUserAtom } from '@/stores/auth';
import { currentInstanceIdAtom } from '@/stores/instance';
import { MalformedResponseError } from '@/utils/response-shape';
import IconAdd from '~icons/material-symbols/add';
import IconInstance from '~icons/material-symbols/lan';
import IconRefresh from '~icons/material-symbols/refresh';

type InstanceGuardProps = {
  children: ReactNode;
};

const EmptyState = ({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta: ReactNode;
}) => (
  <Center mih="60vh">
    <Paper
      p="xl"
      radius="lg"
      withBorder
      style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}
    >
      <Stack align="center" gap="lg">
        <Box
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(248, 66, 63, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconInstance width="28" height="28" style={{ color: 'var(--brand)' }} />
        </Box>
        <Stack gap={4}>
          <Title order={3}>{title}</Title>
          <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>{message}</Text>
        </Stack>
        {cta}
      </Stack>
    </Paper>
  </Center>
);

export const InstanceGuard = ({ children }: InstanceGuardProps) => {
  const { t } = useTranslation();
  const currentInstanceId = useAtomValue(currentInstanceIdAtom);

  const currentUser = useAtomValue(currentUserAtom);
  const {
    data: instances,
    isLoading,
    isError,
    isFetching,
  } = useQuery({
    // Scoped to the user, like the header's health query: logging out navigates
    // client-side, so without it the next account is waved through on the list
    // the previous one saw until the refetch lands.
    queryKey: ['instances', currentUser?.id],
    queryFn: () => instanceApi.list(),
    staleTime: 30_000,
    // A malformed body throws deterministically — the response interceptor
    // rejects one that was never JSON, parseRecordList one that is JSON of the
    // wrong shape — so retrying it only holds the whole dashboard on a spinner
    // for seven seconds before saying the same thing. Everything else — a 502
    // from a restarting backend, a dropped connection — still gets the default
    // attempts, because those do heal on their own and used to.
    //
    // Keyed on the shared type rather than the native TypeError this used to
    // check: that read any accidental TypeError from an interceptor as
    // "malformed body, do not retry".
    retry: (attempt, error) =>
      !(error instanceof MalformedResponseError) && attempt < 3,
  });

  if (isLoading) {
    return (
      <Center mih="40vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // (1) The list could not be read, and there is no earlier one to fall back
  // on. Told apart from having none, because the difference is what the
  // operator does next: "register your first gateway" sent to someone who
  // already has five, whose backend is simply unreachable, costs them the time
  // it takes to work out the advice was wrong.
  //
  // `!instances` matters as much as isError. react-query keeps the last good
  // data on a failed refetch, and it refetches on window focus — so without it
  // a one-second blip while the operator was on another tab would replace a
  // working dashboard, and whatever they had half-filled in on it.
  if (isError && !instances) {
    return (
      <EmptyState
        title={t('instanceGuard.unreadable.title')}
        message={t('instanceGuard.unreadable.message')}
        cta={
          // A reload rather than a refetch: the header reads this same endpoint
          // through an effect of its own, and refetching only this query leaves
          // its instance selector empty — so a successful retry could land the
          // operator on "pick an instance from the selector above" with no
          // selector there. Nothing is in progress on an error screen, so the
          // heavier hammer costs nothing. Collapsing the two reads is #161's
          // neighbour and tracked separately.
          <Button
            onClick={() => window.location.reload()}
            loading={isFetching}
            leftSection={<IconRefresh width="16" height="16" />}
          >
            {t('instanceGuard.unreadable.cta')}
          </Button>
        }
      />
    );
  }

  // (2) No instances registered at all — drive the user to /ui/instances.
  // instanceApi.list always answers with a list (see parseRecordList), so the
  // length is the whole question here.
  if (!instances || instances.length === 0) {
    return (
      <EmptyState
        title={t('instanceGuard.noInstances.title')}
        message={t('instanceGuard.noInstances.message')}
        cta={
          <Button
            component={Link}
            to="/instances"
            leftSection={<IconAdd width="16" height="16" />}
          >
            {t('instanceGuard.noInstances.cta')}
          </Button>
        }
      />
    );
  }

  // (3) Instances exist but none selected — direct the user to the header
  // switcher rather than auto-picking one (auto-pick can mask the wrong
  // selection in multi-instance setups).
  const known = instances.some((inst) => inst.id === currentInstanceId);
  if (!currentInstanceId || !known) {
    return (
      <EmptyState
        title={t('instanceGuard.noSelection.title')}
        message={t('instanceGuard.noSelection.message')}
        cta={null}
      />
    );
  }

  return <>{children}</>;
};

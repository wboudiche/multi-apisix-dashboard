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
import { currentInstanceIdAtom } from '@/stores/instance';
import IconAdd from '~icons/material-symbols/add';
import IconInstance from '~icons/material-symbols/lan';

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

  const { data: instances, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: () => instanceApi.list(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Center mih="40vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // (1) No instances registered at all — drive the user to /ui/instances.
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

  // (2) Instances exist but none selected — direct the user to the header
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

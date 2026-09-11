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
import { Button, Center, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import {
  type QueryKey,
  useQuery,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isNotFound } from '@/apis/hooks';
import { currentInstanceAtom, currentInstanceIdAtom } from '@/stores/instance';

type DetailGateProps<TData, TKey extends QueryKey> = {
  /**
   * The page's own record query, as a thunk. It is called on every render, so
   * after a switch it is keyed on the instance switched to; the page reads the
   * same options and finds the record in cache.
   */
  record: () => UseQueryOptions<TData, Error, TData, TKey>;
  /** The record's id, as the user knows it. */
  id: string;
  /** Back to the list the record belongs to. */
  onBack: () => void;
  children: ReactNode;
};

/**
 * One instance's record, and only that instance's.
 *
 * Keyed on the instance, so a switch in the header remounts the page under it
 * instead of leaving it on the record it opened with — while a save from it
 * would go to the instance switched to, under the same id (#187). The gate
 * loads the record first: a skeleton until it has; if the instance has no
 * such record, a page that says so; otherwise the page, which finds the
 * record in cache. A page that suspends on its record therefore cannot throw
 * the new instance's 404 up to the root route's error boundary, which would
 * replace the whole app.
 *
 * Any other failure is left to the page, as before.
 */
export const DetailGate = <TData, TKey extends QueryKey>(
  props: DetailGateProps<TData, TKey>
) => {
  const instanceId = useAtomValue(currentInstanceIdAtom);
  return <Gate key={instanceId} {...props} />;
};

const Gate = <TData, TKey extends QueryKey>(
  props: DetailGateProps<TData, TKey>
) => {
  const { record, id, onBack, children } = props;
  const { t } = useTranslation();
  const instance = useAtomValue(currentInstanceAtom);
  const query = useQuery(record());

  if (query.isPending) {
    return <Skeleton height={400} />;
  }

  if (query.isError && isNotFound(query.error)) {
    return (
      <Center mih="40vh">
        <Paper
          p="xl"
          radius="lg"
          withBorder
          maw={520}
          w="100%"
          ta="center"
          data-testid="detail-not-found"
        >
          <Stack align="center" gap="md">
            <Title order={3}>{t('detailGate.notFound.title')}</Title>
            <Text size="sm" c="dimmed">
              {t('detailGate.notFound.message', {
                id,
                instance: instance?.name ?? '',
              })}
            </Text>
            <Button variant="light" onClick={onBack}>
              {t('form.btn.backToList')}
            </Button>
          </Stack>
        </Paper>
      </Center>
    );
  }

  return <>{children}</>;
};

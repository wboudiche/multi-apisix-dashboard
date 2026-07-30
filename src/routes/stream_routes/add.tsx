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
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { getStreamRouteListReq,postStreamRouteReq } from '@/apis/stream_routes';
import { FormSubmitBtn } from '@/components/form/Btn';
import { produceRoute } from '@/components/form-slice/FormPartRoute/util';
import { FormPartStreamRoute } from '@/components/form-slice/FormPartStreamRoute';
import {
  StreamRoutePostSchema,
  type StreamRoutePostType,
} from '@/components/form-slice/FormPartStreamRoute/schema';
import PageHeader from '@/components/page/PageHeader';
import { StreamRoutesErrorComponent } from '@/components/page-slice/stream_routes/ErrorComponent';
import { PAGE_SIZE_MAX } from '@/config/constant';
import { req } from '@/config/req';
import type { APISIXType } from '@/types/schema/apisix';
import {
  findStreamRouteDuplicates,
  type StreamRouteDuplicate,
} from '@/utils/stream-route-duplicates';

type Props = {
  navigate: (res: APISIXType['RespStreamRouteDetail']) => Promise<void>;
  defaultValues?: Partial<StreamRoutePostType>;
};

export const StreamRouteAddForm = (props: Props) => {
  const { navigate, defaultValues } = props;
  const { t } = useTranslation();

  const postStreamRoute = useMutation({
    mutationFn: (d: StreamRoutePostType) =>
      postStreamRouteReq(req, produceRoute(d)),
    async onSuccess(res) {
      notifications.show({
        message: t('info.add.success', { name: t('streamRoutes.singular') }),
        color: 'green',
      });
      await navigate(res);
    },
  });

  const form = useForm({
    resolver: zodResolver(StreamRoutePostSchema),
    shouldUnregister: true,
    shouldFocusError: true,
    mode: 'all',
    defaultValues,
  });

  const [pendingDuplicate, setPendingDuplicate] = useState<{
    data: StreamRoutePostType;
    duplicates: StreamRouteDuplicate[];
  } | null>(null);

  const checkDuplicates = useCallback(
    async (d: StreamRoutePostType): Promise<StreamRouteDuplicate[]> => {
      try {
        const res = await getStreamRouteListReq(req, {
          page: 1,
          page_size: PAGE_SIZE_MAX,
        });
        return findStreamRouteDuplicates(
          res.list.map((item) => item.value),
          d
        );
      } catch {
        // Never block a create because the check itself failed: the duplicate
        // warning is an aid, not a gate.
        return [];
      }
    },
    []
  );

  // Describes a duplicate by the traffic it matches, since a stream route has
  // no name to identify it by.
  const describe = (d: StreamRouteDuplicate): string => {
    const parts = [
      d.server_addr && `${d.server_addr}${d.server_port ? `:${d.server_port}` : ''}`,
      !d.server_addr && d.server_port && `port ${d.server_port}`,
      d.sni && `SNI ${d.sni}`,
      d.remote_addr && `from ${d.remote_addr}`,
    ].filter(Boolean);
    return parts.length > 0
      ? parts.join(', ')
      : t('form.streamRoutes.duplicateAny');
  };

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(async (d) => {
          const duplicates = await checkDuplicates(d);
          if (duplicates.length > 0) {
            setPendingDuplicate({ data: d, duplicates });
            return;
          }
          await postStreamRoute.mutateAsync(d);
        })}
      >
        <FormPartStreamRoute />
        <FormSubmitBtn>{t('form.btn.add')}</FormSubmitBtn>
      </form>

      <Modal
        opened={pendingDuplicate !== null}
        onClose={() => setPendingDuplicate(null)}
        title={t('form.streamRoutes.duplicateConfirmTitle')}
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm">{t('form.streamRoutes.duplicateConfirmBody')}</Text>
          <List size="sm" spacing={4} withPadding>
            {(pendingDuplicate?.duplicates ?? []).map((d) => (
              <List.Item key={d.id}>{describe(d)}</List.Item>
            ))}
          </List>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setPendingDuplicate(null)}
            >
              {t('form.btn.cancel')}
            </Button>
            <Button
              color="yellow"
              loading={postStreamRoute.isPending}
              onClick={() => {
                const pending = pendingDuplicate;
                setPendingDuplicate(null);
                if (pending) postStreamRoute.mutateAsync(pending.data);
              }}
            >
              {t('form.streamRoutes.duplicateConfirmAction')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </FormProvider>
  );
};

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('info.add.title', { name: t('streamRoutes.singular') })}
      />
      <StreamRouteAddForm
        navigate={(res) =>
          navigate({
            to: '/stream_routes/detail/$id',
            params: { id: res.data.value.id },
          })
        }
      />
    </>
  );
}

export const Route = createFileRoute('/stream_routes/add')({
  component: RouteComponent,
  errorComponent: StreamRoutesErrorComponent,
});

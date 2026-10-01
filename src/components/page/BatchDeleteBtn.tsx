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
import { Button, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';

import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import IconDelete from '~icons/material-symbols/delete-forever-outline';

type BatchDeleteBtnProps = {
  ids: string[];
  apiBase: string;
  resourceName: string;
  onSuccess?: () => void;
  onClearSelection?: () => void;
};

export const BatchDeleteBtn = (props: BatchDeleteBtnProps) => {
  const { ids, apiBase, resourceName, onSuccess, onClearSelection } = props;
  const { canDelete } = usePermission();
  const { t } = useTranslation();

  if (!canDelete || ids.length === 0) return null;

  const handleBatchDelete = () => {
    modals.openConfirmModal({
      centered: true,
      confirmProps: { color: 'red' },
      title: t('info.delete.title', { name: resourceName }),
      children: (
        <Text>
          {t('info.delete.content', { name: resourceName })}
          <Text component="span" fw={700} mx="0.25em">
            {ids.length}
          </Text>
          {t('mark.question')}
        </Text>
      ),
      labels: { confirm: t('form.btn.delete'), cancel: t('form.btn.cancel') },
      // Every answer waited for and counted. On the first refusal Promise.all
      // gave up the lot: the other deletes had gone through, and the page was
      // left as it was - the selection still ticked, the list not asked again,
      // and nothing said about what had and had not been deleted (#371). Each
      // refusal has its own toast, from `req`, with the gateway's reason.
      onConfirm: async () => {
        const answers = await Promise.allSettled(
          ids.map((id) => req.delete(`${apiBase}/${id}`))
        );
        const failed = answers.filter((answer) => answer.status === 'rejected').length;
        const deleted = answers.length - failed;
        if (failed === 0) {
          notifications.show({
            message: t('info.delete.success', { name: `${deleted} ${resourceName}` }),
            color: 'green',
          });
        } else {
          notifications.show({
            message: t('info.delete.partial', { deleted, failed, name: resourceName }),
            color: deleted > 0 ? 'orange' : 'red',
          });
        }
        // Whatever the answers: what is left on the list is what the next
        // selection is made from.
        onClearSelection?.();
        onSuccess?.();
        queryClient.invalidateQueries();
      },
    });
  };

  return (
    <Button
      color="red"
      variant="light"
      size="compact-sm"
      leftSection={<IconDelete width="16" height="16" />}
      onClick={handleBatchDelete}
    >
      {t('form.btn.delete')} ({ids.length})
    </Button>
  );
};

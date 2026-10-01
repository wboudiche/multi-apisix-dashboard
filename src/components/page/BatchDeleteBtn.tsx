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

import { isNotFound } from '@/apis/hooks';
import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
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
      // left as it was - the list not asked again, and nothing said about
      // what had and had not been deleted (#371).
      onConfirm: async () => {
        const answers = await Promise.allSettled(
          ids.map((id) =>
            // A 404 is not a refusal, and gets no toast of its own: see below.
            req.delete(`${apiBase}/${id}`, { headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } })
          )
        );
        // Not there any more - another tab, another admin - is what was asked
        // for: the row is gone. Counted as a failure, a batch that ended
        // exactly as intended was reported in red.
        const refused = answers.filter(
          (answer) => answer.status === 'rejected' && !isNotFound(answer.reason)
        ).length;
        const gone = answers.length - refused;

        if (refused === 0) {
          notifications.show({
            message: t('info.delete.success', { name: `${gone} ${resourceName}` }),
            color: 'green',
          });
          onClearSelection?.();
        } else {
          // The selection is left alone: the rows that went leave it with the
          // list, and the ones that were refused stay ticked, to be tried
          // again once whatever refused them - an unreachable gateway, most
          // often - is put right. Why is `req`'s to say: a toast, or the
          // banner when it is the gateway that cannot be reached.
          notifications.show({
            message: t('info.delete.partial', { deleted: gone, failed: refused, name: resourceName }),
            color: gone > 0 ? 'orange' : 'red',
          });
        }

        if (gone > 0) {
          // Everything that counted or listed what went, this list included.
          queryClient.invalidateQueries();
        } else {
          onSuccess?.();
        }
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

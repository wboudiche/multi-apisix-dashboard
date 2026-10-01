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
import { reqFor } from '@/config/req';
import { usePermission } from '@/hooks/usePermission';
import { selectedInstanceId } from '@/stores/instance';
import { describeError } from '@/utils/api-error';
import IconDelete from '~icons/material-symbols/delete-forever-outline';

type BatchDeleteBtnProps = {
  ids: string[];
  apiBase: string;
  resourceName: string;
  onSuccess?: () => void;
  onClearSelection?: () => void;
};

/**
 * Whether a delete failed because the gateway no longer has the row.
 *
 * A 404 from the gateway, that is - its answers carry `message` or
 * `error_msg`. The dashboard answers 404 too, with `error`, for an instance
 * that is gone or switched off: nothing was deleted then, and counting it as
 * gone reported a batch that did nothing as a success.
 */
const goneFromGateway = (failure: unknown) => {
  if (!isNotFound(failure)) return false;
  const body = (failure as { response?: { data?: { message?: string; error_msg?: string } } })
    .response?.data;
  return !!(body?.message || body?.error_msg);
};

export const BatchDeleteBtn = (props: BatchDeleteBtnProps) => {
  const { ids, apiBase, resourceName, onSuccess, onClearSelection } = props;
  const { canDelete } = usePermission();
  const { t } = useTranslation();

  if (!canDelete || ids.length === 0) return null;

  const handleBatchDelete = () => {
    // The instance the rows were ticked on, which is the one selected now.
    // Named in every delete: read when each is sent, it was whichever
    // instance was selected by then, and a confirmation left open while the
    // header moved on deleted the same ids from another gateway.
    const gateway = reqFor(selectedInstanceId());
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
            // A 404 gets no toast from `req`: it is told apart below.
            gateway.delete(`${apiBase}/${id}`, { headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } })
          )
        );
        const failures = answers.flatMap((answer) =>
          answer.status === 'rejected' ? [answer.reason as unknown] : []
        );
        // Not there any more - another tab, another admin - is what was asked
        // for: the row is gone. Counted as a failure, a batch that ended
        // exactly as intended was reported in red.
        const refusals = failures.filter((failure) => !goneFromGateway(failure));
        const gone = answers.length - refusals.length;

        if (refusals.length === 0) {
          notifications.show({
            message: t('info.delete.success', { name: `${gone} ${resourceName}` }),
            color: 'green',
          });
          onClearSelection?.();
        } else {
          // The selection is left alone: the rows that went leave it with the
          // list, and the ones that were refused stay ticked, to be tried
          // again once whatever refused them is put right.
          notifications.show({
            message: t('info.delete.partial', {
              deleted: gone,
              failed: refusals.length,
              name: resourceName,
            }),
            color: gone > 0 ? 'orange' : 'red',
          });
          // Why is `req`'s to say - a toast, or the banner when the gateway
          // cannot be reached - except for the 404s it was told to keep quiet
          // about: the dashboard's own, for an instance that is gone or
          // switched off. Said here, once.
          const unsaid = refusals.find(isNotFound);
          if (unsaid) {
            notifications.show({
              id: 'batch-delete-not-found',
              message: describeError(unsaid, t('error.notFound')),
              color: 'red',
            });
          }
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

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
import axios from 'axios';
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
  /**
   * Given the ids that are gone, for the page to take out of its selection.
   * Those and no others: the page stays usable while a batch is answered, and
   * clearing the selection whole unticked what had been ticked since.
   */
  onDeleted?: (ids: string[]) => void;
};

type Refused = { response?: { status?: number; data?: Record<string, string | undefined> } };

/**
 * Whether a delete failed because the gateway no longer has the row.
 *
 * The gateway says so with a 404 and `{"message": "Key not found"}`, and that
 * is the only answer read as "gone". Any other 404 is not: its own with
 * `error_msg` is a request it did not understand - an Admin URL pointing at
 * the wrong port gets one for every delete - a proxy in front of it has its
 * own wording, and the dashboard answers 404 itself, with `error`, for an
 * instance that is gone or switched off. Nothing was deleted in any of those,
 * and counted as gone they reported a batch that did nothing as a success.
 * A gateway that words it otherwise one day is then reported as a refusal,
 * which is the mistake to prefer.
 */
const goneFromGateway = (failure: unknown) =>
  // eslint-disable-next-line local/no-prose-literal -- APISIX's own words, compared and not shown
  isNotFound(failure) && (failure as Refused).response?.data?.message === 'Key not found';

/**
 * What a refused 404 says, with the notification id `req` gives the same
 * sentence - so that if the list asked again says it too, it is shown once.
 */
const notFoundNotice = (failure: unknown, fallback: string) => {
  const body = (failure as Refused).response?.data;
  const message = body?.error_msg || body?.message || body?.error || fallback;
  return { id: `req-error-404-${message}`, message, color: 'red' };
};

export const BatchDeleteBtn = (props: BatchDeleteBtnProps) => {
  const { ids, apiBase, resourceName, onSuccess, onDeleted } = props;
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
        // Not there any more - another tab, another admin - is what was asked
        // for: the row is gone. Counted as a failure, a batch that ended
        // exactly as intended was reported in red.
        const refusals: unknown[] = [];
        const goneIds: string[] = [];
        answers.forEach((answer, i) => {
          if (answer.status === 'fulfilled' || goneFromGateway(answer.reason)) goneIds.push(ids[i]);
          else refusals.push(answer.reason);
        });
        const gone = goneIds.length;

        if (refusals.length === 0) {
          notifications.show({
            message: t('info.delete.success', { name: `${gone} ${resourceName}` }),
            color: 'green',
          });
        } else {
          notifications.show({
            message: t('info.delete.partial', {
              deleted: gone,
              failed: refusals.length,
              name: resourceName,
            }),
            color: gone > 0 ? 'orange' : 'red',
          });
          // Why is `req`'s to say - a toast, or the banner when the gateway
          // cannot be reached - with two exceptions, said here: the 404s it
          // was told to keep quiet about and that turned out to be refusals,
          // and a delete that got no answer at all, where it has no response
          // to read.
          const notFound = refusals.find(isNotFound);
          if (notFound) notifications.show(notFoundNotice(notFound, t('error.notFound')));
          const unanswered = refusals.find(
            (refusal) => axios.isAxiosError(refusal) && !refusal.response
          );
          if (unanswered) {
            notifications.show({
              id: 'batch-delete-unanswered',
              message: describeError(unanswered, t('error.generic', { status: '?' })),
              color: 'red',
            });
          }
        }
        // What went is taken out of the selection, and nothing else: the rows
        // that were refused stay ticked, to be tried again, and so do the
        // ones ticked while this was being answered.
        if (gone > 0) onDeleted?.(goneIds);

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

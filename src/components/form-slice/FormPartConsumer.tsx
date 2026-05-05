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
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { getConsumerGroupListQueryOptions } from '@/apis/hooks';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemTextInput } from '@/components/form/TextInput';
import type { APISIXType } from '@/types/schema/apisix';

import { FormItemPlugins } from './FormItemPlugins';
import { FormPartBasic } from './FormPartBasic';
import { FormSection } from './FormSection';

export const FormSectionPluginsOnly = ({ context }: { context?: 'consumer' | 'route' }) => {
  const { t } = useTranslation();
  return (
    <FormSection legend={t('form.plugins.label')}>
      <FormItemPlugins name="plugins" context={context} />
    </FormSection>
  );
};

const FormItemConsumerGroupSelect = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<APISIXType['ConsumerPut']>();
  const { data: consumerGroups } = useSuspenseQuery(
    getConsumerGroupListQueryOptions({ page: 1, page_size: 500 })
  );

  const options = useMemo(
    () =>
      consumerGroups?.list?.map((g) => ({
        value: g.value.id,
        label: g.value.name || g.value.id,
      })) ?? [],
    [consumerGroups]
  );

  return (
    <FormItemSelect
      control={control}
      name="group_id"
      label={t('form.consumers.groupId')}
      data={options}
      searchable
      clearable
    />
  );
};

export const FormPartConsumer = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<APISIXType['ConsumerPut']>();

  return (
    <>
      <FormPartBasic
        showName={false}
        before={
          <FormItemTextInput
            control={control}
            name="username"
            label={t('form.consumers.username')}
            required
          />
        }
      />
      <FormItemConsumerGroupSelect />
      <FormSectionPluginsOnly context="consumer" />
    </>
  );
};

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
import { Divider, InputWrapper } from '@mantine/core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  getServiceListQueryOptions,
  getUpstreamListQueryOptions,
} from '@/apis/hooks';
import { FormItemEditor } from '@/components/form/Editor';
import { LabelWithTooltip } from '@/components/form/LabelWithTooltip';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTagsInput } from '@/components/form/TagInput';
import { FormItemTextarea } from '@/components/form/Textarea';
import { FormItemTextInput } from '@/components/form/TextInput';
import { APISIX } from '@/types/schema/apisix';
import { NamePrefixProvider } from '@/utils/useNamePrefix';
import { zGetDefault } from '@/utils/zod';

import { useFormReadOnlyFields } from '../../../utils/form-context';
import { FormItemPlugins } from '../FormItemPlugins';
import { FormPartBasic } from '../FormPartBasic';
import { FormPartUpstream, FormSectionTimeout } from '../FormPartUpstream';
import { FormSection, type FormSectionProps } from '../FormSection';
import type { RoutePostType } from './schema';
import { SERVICE_NONE, UPSTREAM_CUSTOM } from './util';

export const FormPartBasicWithPriority = ({
  showGeneral,
}: {
  showGeneral?: boolean;
}) => {
  const { t } = useTranslation();
  const { control } = useFormContext<RoutePostType>();
  return (
    <FormPartBasic showStatus showGeneral={showGeneral}>
      <FormItemNumberInput
        control={control}
        name="priority"
        label={<LabelWithTooltip label={t('form.routes.priority')} tooltip={t('form.routes.tooltip.priority')} />}
        defaultValue={zGetDefault(APISIX.Route).priority!}
      />
    </FormPartBasic>
  );
};

export const FormSectionMatchRules = () => {
  const { t } = useTranslation();
  const { control, formState } = useFormContext<RoutePostType>();
  const readOnlyFields = useFormReadOnlyFields();
  const isReadOnly = formState.disabled;

  const watched = useWatch({
    control,
    name: ['methods', 'enable_websocket', 'uri', 'uris', 'host', 'hosts', 'remote_addr', 'remote_addrs', 'vars', 'filter_func'],
  });
  const [methods, enableWebsocket, uri, uris, host, hosts, remoteAddr, remoteAddrs, vars, filterFunc] = watched;

  const hasValue = (v: unknown) =>
    v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

  return (
    <FormSection legend={t('form.routes.matchRules')}>
      {(!isReadOnly || hasValue(methods)) && (
        <FormItemTagsInput
          control={control}
          name="methods"
          label={<LabelWithTooltip label={t('form.routes.methods')} tooltip={t('form.routes.tooltip.methods')} />}
          data={APISIX.HttpMethod.options.map((v) => v.value)}
          searchValue=""
          disabled={readOnlyFields.includes('methods') || undefined}
        />
      )}
      {(!isReadOnly || enableWebsocket) && (
        <InputWrapper label={<LabelWithTooltip label={t('form.routes.enableWebsocket')} tooltip={t('form.routes.tooltip.enableWebsocket')} />}>
          <FormItemSwitch
            control={control}
            name="enable_websocket"
            disabled={readOnlyFields.includes('enable_websocket') || undefined}
          />
        </InputWrapper>
      )}
      {(!isReadOnly || hasValue(uri)) && (
        <FormItemTextInput
          control={control}
          name="uri"
          label={<LabelWithTooltip label={t('form.routes.uri')} tooltip={t('form.routes.tooltip.uri')} />}
          disabled={readOnlyFields.includes('uri') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(uris)) && (
        <FormItemTagsInput
          control={control}
          name="uris"
          label={t('form.routes.uris')}
          disabled={readOnlyFields.includes('uris') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(host)) && (
        <FormItemTextInput
          control={control}
          name="host"
          label={<LabelWithTooltip label={t('form.routes.host')} tooltip={t('form.routes.tooltip.host')} />}
          disabled={readOnlyFields.includes('host') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(hosts)) && (
        <FormItemTagsInput
          control={control}
          name="hosts"
          label={t('form.routes.hosts')}
          disabled={readOnlyFields.includes('hosts') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(remoteAddr)) && (
        <FormItemTextInput
          control={control}
          name="remote_addr"
          label={<LabelWithTooltip label={t('form.routes.remoteAddr')} tooltip={t('form.routes.tooltip.remoteAddr')} />}
          disabled={readOnlyFields.includes('remote_addr') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(remoteAddrs)) && (
        <FormItemTagsInput
          control={control}
          name="remote_addrs"
          label={t('form.routes.remoteAddrs')}
          disabled={readOnlyFields.includes('remote_addrs') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(vars)) && (
        <FormItemEditor
          control={control}
          name="vars"
          label={<LabelWithTooltip label={t('form.routes.vars')} tooltip={t('form.routes.tooltip.vars')} />}
          description={t('form.routes.varsDescription')}
          disabled={readOnlyFields.includes('vars') || undefined}
        />
      )}
      {(!isReadOnly || hasValue(filterFunc)) && (
        <FormItemTextarea
          control={control}
          name="filter_func"
          label={<LabelWithTooltip label={t('form.routes.filterFunc')} tooltip={t('form.routes.tooltip.filterFunc')} />}
          disabled={readOnlyFields.includes('filter_func') || undefined}
        />
      )}
    </FormSection>
  );
};

export const FormSectionUpstream = (
  props: { simplified?: boolean } & FormSectionProps
) => {
  const { simplified, legend, ...restProps } = props;
  const { t } = useTranslation();
  const { control } = useFormContext<RoutePostType>();
  const { data: upstreams } = useSuspenseQuery(
    getUpstreamListQueryOptions({ page: 1, page_size: 500 })
  );

  const upstreamId = useWatch({ control, name: 'upstream_id' });
  const serviceId = useWatch({ control, name: 'service_id' });

  const isUpstreamDisabled = useMemo(
    () => !!(serviceId && serviceId !== SERVICE_NONE),
    [serviceId]
  );

  const upstreamOptions = useMemo(
    () => [
      { value: UPSTREAM_CUSTOM, label: t('form.upstreams.custom') },
      ...(upstreams?.list?.map((v) => ({
        value: v.value.id,
        label: v.value.name || v.value.id,
      })) || []),
    ],
    [upstreams, t]
  );

  return (
    <FormSection
      legend={legend === undefined ? t('form.upstreams.title') : legend}
      disabled={isUpstreamDisabled || restProps.disabled}
      {...restProps}
    >
      <FormItemSelect
        control={control}
        name="upstream_id"
        label="Upstream"
        data={upstreamOptions}
        searchable
        clearable
        disabled={isUpstreamDisabled}
      />
      {upstreamId === UPSTREAM_CUSTOM && (
        <NamePrefixProvider value="upstream">
          <FormPartUpstream simplified={simplified} />
        </NamePrefixProvider>
      )}
    </FormSection>
  );
};

export const FormSectionPlugins = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<RoutePostType>();
  return (
    <FormSection legend={t('form.plugins.label')}>
      <FormItemTextInput
        control={control}
        name="plugin_config_id"
        label={t('form.plugins.configId')}
      />
      <Divider my="xs" label={t('or')} />
      <FormItemPlugins name="plugins" />
    </FormSection>
  );
};

export const FormSectionService = () => {
  const { t } = useTranslation();
  const { control, setValue } = useFormContext<RoutePostType>();
  const readOnlyFields = useFormReadOnlyFields();
  const { data: services } = useSuspenseQuery(
    getServiceListQueryOptions({ page: 1, page_size: 500 })
  );

  const serviceOptions = useMemo(
    () =>
      services?.list?.map((v) => ({
        value: v.value.id,
        label: v.value.name || v.value.id,
      })) || [],
    [services]
  );

  return (
    <FormSection
      legend={t('form.routes.service')}
      disabled={readOnlyFields.includes('service_id') || undefined}
    >
      <FormItemSelect
        control={control}
        name="service_id"
        label="Service"
        data={serviceOptions}
        searchable
        clearable
        onChange={(val) => {
          if (val) {
            setValue('upstream_id', undefined as any);
          }
        }}
      />
    </FormSection>
  );
};

export const FormPartRoute = ({ showGeneral }: { showGeneral?: boolean }) => {
  return (
    <>
      <FormPartBasicWithPriority showGeneral={showGeneral} />
      <FormSectionMatchRules />
      <FormSectionService />
      <FormSectionTimeout />
      <FormSectionUpstream />
      <FormSectionPlugins />
    </>
  );
};
export { FormSectionRequestOverride } from './FormSectionRequestOverride';
export { FormPartUpstream, FormSectionTimeout };

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
import { Collapse, Divider, Grid, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemSelect } from '@/components/form/Select';
import { FormItemSwitch } from '@/components/form/Switch';
import { FormItemTextareaWithUpload } from '@/components/form/TextareaWithUpload';
import { FormItemTextInput } from '@/components/form/TextInput';
import { APISIX } from '@/types/schema/apisix';
import { useNamePrefix } from '@/utils/useNamePrefix';
import IconChevronRight from '~icons/material-symbols/chevron-right';
import IconExpandMore from '~icons/material-symbols/expand-more';

import { FormPartBasic } from '../FormPartBasic';
import { FormSection } from '../FormSection';
import { FormItemNodes } from './FormItemNodes';
import { FormSectionChecks } from './FormSectionChecks';
import type { FormPartUpstreamType } from './schema';
import { TestConnectionButton } from './TestConnectionButton';

export const FormSectionTLS = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();

  return (
    <FormSection legend={t('form.upstreams.tls.title')} hideInTOC>
      <FormItemSwitch
        control={control}
        name={np('tls.verify')}
        label={t('form.upstreams.tls.verify')}
        description={t('form.upstreams.tls.verifyDesc')}
      />
      <FormSection legend={t('form.upstreams.tls.clientCertKeyPair')} hideInTOC>
        <FormItemTextareaWithUpload
          control={control}
          name={np('tls.client_cert')}
          label={t('form.upstreams.tls.clientCert')}
          description={t('form.upstreams.tls.clientCertDesc')}
        />
        <FormItemTextareaWithUpload
          control={control}
          name={np('tls.client_key')}
          label={t('form.upstreams.tls.clientKey')}
          description={t('form.upstreams.tls.clientKeyDesc')}
        />
        <Divider my="xs" label={t('or')} />
        <FormItemTextInput
          control={control}
          name={np('tls.client_cert_id')}
          label={t('form.upstreams.tls.clientCertId')}
          description={t('form.upstreams.tls.clientCertIdDesc')}
        />
      </FormSection>
    </FormSection>
  );
};

export const FormItemScheme = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormItemSelect
      control={control}
      name={np('scheme')}
      label={t('form.upstreams.scheme')}
      description={t('form.upstreams.schemeDesc')}
      withAsterisk
      defaultValue={APISIX.UpstreamSchemeL7.options[0].value}
      data={[
        {
          group: 'L7',
          items: APISIX.UpstreamSchemeL7.options.map((v) => v.value),
        },
        {
          group: 'L4',
          items: APISIX.UpstreamSchemeL4.options.map((v) => v.value),
        },
      ]}
    />
  );
};

export const FormSectionLoadbalancing = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.loadBalancing')} hideInTOC>
      <FormItemSelect
        control={control}
        name={np('type')}
        label={t('form.upstreams.type')}
        description={t('form.upstreams.typeDesc')}
        defaultValue={APISIX.UpstreamBalancer.options[0].value}
        data={APISIX.UpstreamBalancer.options.map((v) => v.value)}
      />
      <FormItemSelect
        control={control}
        name={np('hash_on')}
        label={t('form.upstreams.hashOn')}
        defaultValue={APISIX.UpstreamHashOn.options[0].value}
        data={APISIX.UpstreamHashOn.options.map((v) => v.value)}
        description={t('form.upstreams.hashOnDesc')}
      />
      <FormItemTextInput
        control={control}
        name={np('key')}
        label={t('form.upstreams.key')}
        description={t('form.upstreams.keyDesc')}
      />
    </FormSection>
  );
};

export const FormSectionPassHost = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.passHost')} hideInTOC>
      <FormItemSelect
        control={control}
        name={np('pass_host')}
        label={t('form.upstreams.passHost')}
        description={t('form.upstreams.passHostDesc')}
        defaultValue={APISIX.UpstreamPassHost.options[0].value}
        data={APISIX.UpstreamPassHost.options.map((v) => v.value)}
      />
      <FormItemTextInput
        control={control}
        name={np('upstream_host')}
        label={t('form.upstreams.upstreamHost')}
        description={t('form.upstreams.upstreamHostDesc')}
      />
    </FormSection>
  );
};

export const FormSectionRetry = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.retry')} hideInTOC>
      <FormItemNumberInput
        control={control}
        name={np('retries')}
        label={t('form.upstreams.retries')}
        description={t('form.upstreams.retriesDesc')}
        allowDecimal={false}
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('retry_timeout')}
        label={t('form.upstreams.retryTimeout')}
        description={t('form.upstreams.retryTimeoutDesc')}
        suffix="s"
        allowDecimal={false}
        min={0}
      />
    </FormSection>
  );
};

export const FormSectionTimeout = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.timeout.title')} hideInTOC>
      <FormItemNumberInput
        control={control}
        name={np('timeout.connect')}
        label={t('form.upstreams.timeout.connect')}
        description={t('form.upstreams.timeout.connectDesc')}
        suffix="s"
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('timeout.send')}
        label={t('form.upstreams.timeout.send')}
        description={t('form.upstreams.timeout.sendDesc')}
        suffix="s"
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('timeout.read')}
        label={t('form.upstreams.timeout.read')}
        description={t('form.upstreams.timeout.readDesc')}
        suffix="s"
        min={0}
      />
    </FormSection>
  );
};

export const FormSectionKeepAlive = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.keepalivePool.title')} hideInTOC>
      <FormItemNumberInput
        control={control}
        name={np('keepalive_pool.size')}
        label={t('form.upstreams.keepalivePool.size')}
        description={t('form.upstreams.keepalivePool.sizeDesc')}
        min={1}
      />
      <FormItemNumberInput
        control={control}
        name={np('keepalive_pool.idle_timeout')}
        label={t('form.upstreams.keepalivePool.idleTimeout')}
        description={t('form.upstreams.keepalivePool.idleTimeoutDesc')}
        suffix="s"
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('keepalive_pool.requests')}
        label={t('form.upstreams.keepalivePool.requests')}
        description={t('form.upstreams.keepalivePool.requestsDesc')}
        allowDecimal={false}
        min={1}
      />
    </FormSection>
  );
};

export { FormSectionChecks } from './FormSectionChecks';

export const FormSectionNodesAndDiscovery = () => {
  const { t } = useTranslation();
  const np = useNamePrefix();
  return (
    <FormSection legend={t('form.upstreams.nodes.title')} hideInTOC>
      <FormItemNodes name={np('nodes')} label={t('form.upstreams.nodes.title')} description={t('form.upstreams.nodes.desc')} required withAsterisk />
      <TestConnectionButton />
    </FormSection>
  );
};

export const FormSectionConnection = ({ simplified }: { simplified?: boolean }) => {
  const { t } = useTranslation();
  const [advancedOpened, { toggle: toggleAdvanced }] = useDisclosure(false);
  return (
    <FormSection legend={t('form.upstreams.connectionConfiguration')} hideInTOC>
      <FormItemScheme />
      <FormSectionLoadbalancing />
      <FormSectionPassHost />

      <UnstyledButton
        onClick={toggleAdvanced}
        mt="sm"
        mb="xs"
        py={8}
        px={12}
        style={{
          borderRadius: 'var(--mantine-radius-md)',
          border: '1px dashed var(--mantine-color-blue-4)',
          background: advancedOpened ? 'var(--mantine-color-blue-0)' : 'transparent',
          transition: 'all 0.15s ease',
          width: '100%',
        }}
      >
        <Group gap={6}>
          {advancedOpened ? (
            <IconExpandMore width="18" height="18" style={{ color: 'var(--mantine-color-blue-6)' }} />
          ) : (
            <IconChevronRight width="18" height="18" style={{ color: 'var(--mantine-color-blue-6)' }} />
          )}
          <Text size="sm" fw={600} c="blue.6">
            {t('form.upstreams.advancedSettings')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('form.upstreams.advancedSettingsDesc')}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={advancedOpened}>
        <Stack gap="xs" mt="xs">
          <FormSectionRetry />
          <FormSectionTimeout />
          <FormSectionKeepAlive />
          {!simplified && <FormSectionTLS />}
        </Stack>
      </Collapse>
    </FormSection>
  );
};

export const FormPartUpstreamFlat = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<FormPartUpstreamType>();
  const np = useNamePrefix();

  const loadBalancingType = useWatch({ control, name: np('type'), defaultValue: (APISIX.UpstreamBalancer.options[0] as any).value });
  const passHost = useWatch({ control, name: np('pass_host'), defaultValue: (APISIX.UpstreamPassHost.options[0] as any).value });

  return (
    <Stack gap="md">
      <FormItemSelect
        control={control}
        name={np('type')}
        label={t('form.upstreams.type')}
        description={t('form.upstreams.typeDesc')}
        withAsterisk
        defaultValue={(APISIX.UpstreamBalancer.options[0] as any).value}
        data={(APISIX.UpstreamBalancer.options as any[]).map((v) => ({ value: v.value, label: v.value === 'roundrobin' ? 'Round Robin' : v.value === 'chash' ? 'CHash' : v.value === 'ewma' ? 'EWMA' : v.value === 'least_conn' ? 'Least Conn' : v.value }))}
      />

      {loadBalancingType === 'chash' && (
        <>
          <FormItemSelect
            control={control}
            name={np('hash_on')}
            label={t('form.upstreams.hashOn')}
            defaultValue={(APISIX.UpstreamHashOn.options[0] as any).value}
            data={(APISIX.UpstreamHashOn.options as any[]).map((v) => v.value)}
            description={t('form.upstreams.hashOnDesc')}
          />
          <FormItemTextInput
            control={control}
            name={np('key')}
            label={t('form.upstreams.key')}
            description={t('form.upstreams.keyDesc')}
          />
        </>
      )}

      <FormItemNodes name={np('nodes')} label={t('form.upstreams.nodes.title')} description={t('form.upstreams.nodes.desc')} required withAsterisk />
      <TestConnectionButton />

      <FormItemSelect
        control={control}
        name={np('pass_host')}
        label={t('form.upstreams.passHost')}
        description={t('form.upstreams.passHostDesc')}
        defaultValue={(APISIX.UpstreamPassHost.options[0] as any).value}
        data={(APISIX.UpstreamPassHost.options as any[]).map((v) => ({
          value: v.value,
          label: v.value === 'pass' ? 'Keep the same Host from client request' : v.value === 'node' ? 'Use the IP or hostname of the node' : 'Rewrite Host'
        }))}
      />
      {passHost === 'rewrite' && (
        <FormItemTextInput
          control={control}
          name={np('upstream_host')}
          label={t('form.upstreams.upstreamHost')}
          description={t('form.upstreams.upstreamHostDesc')}
        />
      )}
      <FormItemNumberInput
        control={control}
        name={np('retries')}
        label={t('form.upstreams.retries')}
        description={t('form.upstreams.retriesDesc')}
        allowDecimal={false}
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('retry_timeout')}
        label={t('form.upstreams.retryTimeout')}
        description={t('form.upstreams.retryTimeoutDesc')}
        allowDecimal={false}
        min={0}
      />

      <FormItemScheme />

      <FormItemNumberInput
        control={control}
        name={np('timeout.connect')}
        label={t('form.upstreams.timeout.connect')}
        description={t('form.upstreams.timeout.connectDesc')}
        withAsterisk
        suffix="s"
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('timeout.send')}
        label={t('form.upstreams.timeout.send')}
        description={t('form.upstreams.timeout.sendDesc')}
        withAsterisk
        suffix="s"
        min={0}
      />
      <FormItemNumberInput
        control={control}
        name={np('timeout.read')}
        label={t('form.upstreams.timeout.read')}
        description={t('form.upstreams.timeout.readDesc')}
        withAsterisk
        suffix="s"
        min={0}
      />

      <Divider my="sm" label={t('form.upstreams.keepalivePool.title')} labelPosition="left" />
      <Grid>
        <Grid.Col span={4}>
          <FormItemNumberInput
            control={control}
            name={np('keepalive_pool.size')}
            label={t('form.upstreams.keepalivePool.size')}
            description={t('form.upstreams.keepalivePool.sizeDesc')}
            min={1}
          />
        </Grid.Col>
        <Grid.Col span={4}>
          <FormItemNumberInput
            control={control}
            name={np('keepalive_pool.idle_timeout')}
            label={t('form.upstreams.keepalivePool.idleTimeout')}
            description={t('form.upstreams.keepalivePool.idleTimeoutDesc')}
            suffix="s"
            min={0}
          />
        </Grid.Col>
        <Grid.Col span={4}>
          <FormItemNumberInput
            control={control}
            name={np('keepalive_pool.requests')}
            label={t('form.upstreams.keepalivePool.requests')}
            description={t('form.upstreams.keepalivePool.requestsDesc')}
            allowDecimal={false}
            min={1}
          />
        </Grid.Col>
      </Grid>

      <FormSectionChecks />
    </Stack >
  );
};

export const FormPartUpstream = ({ showGeneral, simplified }: { showGeneral?: boolean; simplified?: boolean }) => {
  if (simplified) {
    return <FormPartUpstreamFlat />;
  }
  return (
    <>
      <FormPartBasic showGeneral={showGeneral} />
      <FormSectionNodesAndDiscovery />
      <FormSectionConnection simplified={simplified} />
      <FormSectionChecks />
    </>
  );
};

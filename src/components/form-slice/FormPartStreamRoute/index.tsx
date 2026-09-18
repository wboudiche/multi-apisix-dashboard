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
import { Box, Select, Text } from '@mantine/core';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { FormItemJsonInput } from '@/components/form/JsonInput';
import { FormItemNumberInput } from '@/components/form/NumberInput';
import { FormItemTextInput } from '@/components/form/TextInput';

import { FormPartBasic } from '../FormPartBasic';
import {
  FormSectionPlugins,
  FormSectionService,
  FormSectionUpstream,
} from '../FormPartRoute';
import { FormSection } from '../FormSection';
import type { StreamRoutePostType } from './schema';

/**
 * The protocols APISIX ships an xRPC implementation for.
 *
 * Anything else is reached through "custom", because the list is what APISIX
 * has built in, not what a gateway has enabled: a protocol only works if it is
 * also declared under `xrpc.protocols` in config.yaml, which this form cannot
 * see (#141).
 */
const KNOWN_PROTOCOLS = ['redis', 'dubbo'];
const PROTOCOL_NONE = 'none';
const PROTOCOL_CUSTOM = 'custom';

const FormSectionStreamRouteBasic = () => {
  const { t } = useTranslation();
  const { control } = useFormContext<StreamRoutePostType>();

  return (
    <FormSection legend={t('form.streamRoutes.server')}>
      {/* These four read as "where the protocol is chosen" to anyone who
          arrives looking for TCP/UDP/TLS, because nothing else in the form
          mentions a protocol at all. They are match conditions (#141). */}
      <Text size="xs" c="dimmed">
        {t('form.streamRoutes.serverHint')}
      </Text>
      <FormItemTextInput
        control={control}
        name="server_addr"
        label={t('form.streamRoutes.serverAddr')}
      />
      <FormItemNumberInput
        control={control}
        name="server_port"
        label={t('form.streamRoutes.serverPort')}
        allowDecimal={false}
      />
      <FormItemTextInput
        control={control}
        name="remote_addr"
        label={t('form.streamRoutes.remoteAddr')}
      />
      <FormItemTextInput
        control={control}
        name="sni"
        label={t('form.streamRoutes.sni')}
      />
    </FormSection>
  );
};

const FormSectionStreamRouteProtocol = () => {
  const { t } = useTranslation();
  const { control, setValue, formState } = useFormContext<StreamRoutePostType>();
  const name = useWatch({ control, name: 'protocol.name' }) ?? '';

  // Derived from the value, not from what was clicked: the detail page fills
  // the form with `reset` in an effect, so a flag decided at first render
  // would have every saved route open on "none" - including one whose protocol
  // this dashboard does not list, whose name would then be one save away from
  // being dropped.
  //
  // The flag only covers the step in between: "custom" chosen, nothing typed
  // yet, where there is no value to derive from.
  const [pendingCustom, setPendingCustom] = useState(false);
  const custom = pendingCustom || (!!name && !KNOWN_PROTOCOLS.includes(name));
  const choice = custom
    ? PROTOCOL_CUSTOM
    : KNOWN_PROTOCOLS.includes(name)
      ? name
      : PROTOCOL_NONE;

  // A named protocol, not a chosen one: "custom" with an empty name is not a
  // protocol, and the fields below it have nothing to attach to.
  const hasProtocol = !!name;

  return (
    <FormSection legend={t('form.streamRoutes.protocol.title')}>
      {/* The one section that says "protocol", and the one people reach for
          when they want TCP or UDP. It is xRPC: application-layer, and
          unrelated to the transport (#141). */}
      <Text size="xs" c="dimmed">
        {t('form.streamRoutes.protocol.hint')}
      </Text>
      <Select
        label={t('form.streamRoutes.protocol.name')}
        description={t('form.streamRoutes.protocol.nameDescription')}
        allowDeselect={false}
        comboboxProps={{ shadow: 'md' }}
        // The rest of the form takes this from `useForm({ disabled })`; this
        // control is not bound through a controller, so it has to read it.
        disabled={formState.disabled}
        value={choice}
        data={[
          { value: PROTOCOL_NONE, label: t('form.streamRoutes.protocol.none') },
          ...KNOWN_PROTOCOLS.map((value) => ({ value, label: value })),
          { value: PROTOCOL_CUSTOM, label: t('form.streamRoutes.protocol.custom') },
        ]}
        onChange={(value) => {
          if (!value) return;
          setPendingCustom(value === PROTOCOL_CUSTOM);
          if (value !== PROTOCOL_CUSTOM) {
            setValue('protocol.name', value === PROTOCOL_NONE ? '' : value);
          }
        }}
      />
      {/* Always mounted, shown only for a custom protocol. Rendering it
          conditionally unregistered the field on the way out, and react-hook-form
          clears an unregistered value - so choosing redis right after custom
          erased the name that had just been set. */}
      <Box display={custom ? undefined : 'none'}>
        <FormItemTextInput
          control={control}
          name="protocol.name"
          label={t('form.streamRoutes.protocol.customName')}
        />
      </Box>
      {/* Disabled rather than cleared: react-hook-form leaves a disabled field
          out of the payload, so nothing stale is sent, and a value typed under
          a protocol survives a look at what the other ones are. */}
      <FormItemTextInput
        control={control}
        name="protocol.superior_id"
        label={t('form.streamRoutes.protocol.superiorId')}
        description={t('form.streamRoutes.protocol.superiorIdDescription')}
        disabled={!hasProtocol}
      />
      <FormItemJsonInput
        control={control}
        name="protocol.conf"
        label={t('form.streamRoutes.protocol.conf')}
        disabled={!hasProtocol}
        toObject
      />
      <FormItemJsonInput
        control={control}
        name="protocol.logger"
        label={t('form.streamRoutes.protocol.logger')}
        disabled={!hasProtocol}
        toObject
        objValue={[]}
      />
    </FormSection>
  );
};

export const FormPartStreamRoute = () => {
  const { t } = useTranslation();

  return (
    <>
      <FormPartBasic showName={false} />
      <FormSectionStreamRouteBasic />
      <FormSectionService />
      <FormSectionUpstream />
      <FormSectionPlugins />
      <FormSectionStreamRouteProtocol />
      {/* Last, for whoever reached the end still looking for TCP/UDP/TLS. */}
      <Text size="xs" c="dimmed" mt="xs">
        {t('form.streamRoutes.transportTip')}
      </Text>
    </>
  );
};

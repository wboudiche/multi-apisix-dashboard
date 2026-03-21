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
import { ActionIcon, Tooltip, type ButtonProps } from '@mantine/core';
import type { LinkProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { RouteLink, RouteLinkBtn } from '@/components/Btn';
import { usePermission } from '@/hooks/usePermission';
import type { FileRoutesByTo } from '@/routeTree.gen';
import IconPlus from '~icons/material-symbols/add';
import IconVisibility from '~icons/material-symbols/visibility-outline';

export type ToAddPageBtnProps = {
  to: keyof FilterKeys<FileRoutesByTo, 'add'>;
  label: string;
} & Pick<LinkProps, 'params'>;

export const ToAddPageBtn = ({ to, params, label, ...props }: ToAddPageBtnProps & ButtonProps) => {
  const { canCreate } = usePermission();
  if (!canCreate) return null;

  return (
    <RouteLinkBtn
      leftSection={<IconPlus width="18" height="18" />}
      size="sm"
      to={to}
      params={params}
      variant="filled"
      {...props}
    >
      {label}
    </RouteLinkBtn>
  );
};

export type ToDetailPageBtnProps = {
  to:
  | keyof FilterKeys<FileRoutesByTo, '$id'>
  | keyof FilterKeys<FileRoutesByTo, '$routeId'>
  | keyof FilterKeys<FileRoutesByTo, '$username'>;
  mode?: 'button' | 'icon';
} & Pick<LinkProps, 'params'>;

export const ToDetailPageBtn = (props: ToDetailPageBtnProps) => {
  const { params, to, mode = 'icon' } = props;
  const { t } = useTranslation();

  if (mode === 'button') {
    return (
      <RouteLinkBtn size="compact-xs" variant="light" to={to} params={params}>
        {t('form.btn.view')}
      </RouteLinkBtn>
    );
  }

  return (
    <Tooltip label={t('form.btn.view')}>
      <ActionIcon
        variant="light"
        color="blue"
        component={RouteLink as any}
        to={to}
        params={params}
      >
        <IconVisibility width="18" height="18" />
      </ActionIcon>
    </Tooltip>
  );
};

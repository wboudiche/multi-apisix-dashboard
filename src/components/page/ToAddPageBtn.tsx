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
import { ActionIcon, type ButtonProps,Tooltip } from '@mantine/core';
import type { LinkProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { RouteLink, RouteLinkBtn } from '@/components/Btn';
import type { ResourceType } from '@/config/resource-permissions';
import { usePermission } from '@/hooks/usePermission';
import type { FileRoutesByTo } from '@/routeTree.gen';
import IconPlus from '~icons/material-symbols/add';
import IconEdit from '~icons/material-symbols/edit-outline';
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
  /**
   * The APISIX path segment for what this page lists - "routes", "ssls".
   *
   * Required, because the answer it buys is per resource: a developer writes
   * routes and reads ssls, and the same button on those two pages leads to two
   * different places (#270).
   */
  resource: ResourceType;
} & Pick<LinkProps, 'params'>;

export const ToDetailPageBtn = (props: ToDetailPageBtnProps) => {
  const { params, to, mode = 'icon', resource } = props;
  const { t } = useTranslation();
  const { canWriteResource } = usePermission();

  // The same destination either way - a detail page is where a resource is
  // read as well as edited - named for what the account may do once it is
  // there. "Configure" offered to someone who may only read promises an edit
  // that every field refuses to save and the proxy answers 403 to (#188).
  const label = canWriteResource(resource) ? t('form.btn.configure') : t('form.btn.view');

  if (mode === 'button') {
    return (
      <RouteLinkBtn size="compact-xs" variant="light" to={to} params={params}>
        {label}
      </RouteLinkBtn>
    );
  }

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="light"
        color="blue"
        aria-label={label}
        renderRoot={(rootProps) => <RouteLink {...rootProps} to={to} params={params} />}
      >
        {/* The pictogram follows the word: an eye for a page that can only
            be read, the edit mark for one that can be changed. */}
        {canWriteResource(resource) ? (
          <IconEdit width="18" height="18" />
        ) : (
          <IconVisibility width="18" height="18" />
        )}
      </ActionIcon>
    </Tooltip>
  );
};

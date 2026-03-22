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
import { AppShellNavbar, Box, Center, NavLink, type NavLinkProps, Stack, Tooltip } from '@mantine/core';
import { createLink } from '@tanstack/react-router';
import type { FC } from 'react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { navRoutes } from '@/config/navRoutes';
import { usePermission } from '@/hooks/usePermission';
import IconAltRoute from '~icons/material-symbols/alt-route';
import IconApi from '~icons/material-symbols/api';
import IconCloud from '~icons/material-symbols/cloud';
// Dynamic imports for icons from unplugin-icons
import IconDashboard from '~icons/material-symbols/dashboard';
import IconDns from '~icons/material-symbols/dns';
import IconExtension from '~icons/material-symbols/extension';
import IconGroup from '~icons/material-symbols/group';
import IconGroups from '~icons/material-symbols/groups';
import IconChevronLeft from '~icons/material-symbols/keyboard-arrow-left';
import IconChevronRight from '~icons/material-symbols/keyboard-arrow-right';
import IconLayers from '~icons/material-symbols/layers';
import IconPassword from '~icons/material-symbols/password';
import IconPerson from '~icons/material-symbols/person';
import IconRule from '~icons/material-symbols/rule';
import IconSettings from '~icons/material-symbols/settings';
import IconSettingsInputComponent from '~icons/material-symbols/settings-input-component';
import IconVpnKey from '~icons/material-symbols/vpn-key';

const iconMap: Record<string, React.ReactNode> = {
  dashboard: <IconDashboard />,
  cloud: <IconCloud />,
  person: <IconPerson />,
  layers: <IconLayers />,
  'alt-route': <IconAltRoute />,
  'settings-input-component': <IconSettingsInputComponent />,
  dns: <IconDns />,
  group: <IconGroup />,
  groups: <IconGroups />,
  'vpn-key': <IconVpnKey />,
  rule: <IconRule />,
  extension: <IconExtension />,
  settings: <IconSettings />,
  password: <IconPassword />,
  api: <IconApi />,
};

const MantineLinkComponent = React.forwardRef<HTMLAnchorElement, NavLinkProps>(
  (props, ref) => {
    return <NavLink ref={ref} {...props} />;
  }
);
MantineLinkComponent.displayName = 'MantineLinkComponent';

const CreatedLinkComponent = createLink(MantineLinkComponent);

interface NavbarLinkProps extends NavLinkProps {
  to: string;
}

export const NavbarLink: FC<NavbarLinkProps & { collapsed?: boolean }> = (props) => {
  const { collapsed, label, ...rest } = props;

  const content = (
    <CreatedLinkComponent
      key={props.to}
      href={props.to}
      {...rest}
      label={collapsed ? null : label}
      style={{
        borderRadius: 'var(--radius-md)',
        margin: '2px 4px',
        padding: collapsed ? '8px 0' : '8px 20px',
        boxSizing: 'border-box',
        width: collapsed ? '40px' : 'calc(100% - 8px)',
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: '40px',
      }}
    />
  );

  if (collapsed) {
    return (
      <Center w="100%">
        <Tooltip label={label} position="right" withArrow offset={10}>
          <Box w="100%" style={{ display: 'flex', justifyContent: 'center' }}>
            {content}
          </Box>
        </Tooltip>
      </Center>
    );
  }

  return content;
};

export const Navbar = ({ collapsed, onCollapseToggle }: { collapsed: boolean; onCollapseToggle: () => void }) => {
  const { t } = useTranslation();
  const { canAccessRoute } = usePermission();
  return (
    <AppShellNavbar p="0" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Box style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <Stack gap={0} py="xs">
          {navRoutes.filter((route) => canAccessRoute(route.to)).map((route) => (
            <NavbarLink
              {...route}
              key={route.to}
              collapsed={collapsed}
              label={t(`sources.${route.label}`)}
              leftSection={
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '1.2rem',
                    marginRight: collapsed ? 0 : 12,
                  }}
                >
                  {iconMap[route.icon]}
                </div>
              }
            />
          ))}
        </Stack>
      </Box>

      <Box p="xs" style={{ borderTop: '1px solid #eee' }}>
        <Tooltip label={collapsed ? t('common.expand') : t('common.collapse')} position="right">
          <Center
            component="button"
            onClick={onCollapseToggle}
            style={{
              width: '100%',
              height: '40px',
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              justifyContent: collapsed ? 'center' : 'flex-end',
              padding: collapsed ? 0 : '0 12px',
              color: 'var(--mantine-color-gray-6)',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {collapsed ? <IconChevronRight style={{ fontSize: '1.5rem' }} /> : <IconChevronLeft style={{ fontSize: '1.5rem' }} />}
          </Center>
        </Tooltip>
      </Box>
    </AppShellNavbar>
  );
};

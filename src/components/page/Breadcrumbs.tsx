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
import { Anchor, Breadcrumbs as MantineBreadcrumbs, Text } from '@mantine/core';
import { Link, useLocation } from '@tanstack/react-router';
import { type FC } from 'react';

import IconChevronRight from '~icons/material-symbols/chevron-right';

/** Map URL segments to human-readable labels */
const segmentLabels: Record<string, string> = {
    overview: 'Overview',
    routes: 'Routes',
    services: 'Services',
    upstreams: 'Upstreams',
    consumers: 'Consumers',
    consumer_groups: 'Consumer Groups',
    ssls: 'SSL Certificates',
    global_rules: 'Global Rules',
    plugin_metadata: 'Plugin Metadata',
    plugin_configs: 'Plugin Configs',
    secrets: 'Secrets',
    protos: 'Protos',
    stream_routes: 'Stream Routes',
    instances: 'Instances',
    users: 'Users',
    teams: 'Teams',
    add: 'Create',
    detail: 'Detail',
    login: 'Login',
};

type Crumb = {
    label: string;
    href?: string;
};

function buildCrumbs(pathname: string): Crumb[] {
    const parts = pathname.split('/').filter(Boolean);
    const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];

    let path = '';
    for (let i = 0; i < parts.length; i++) {
        const segment = parts[i];
        path += `/${segment}`;

        // If this segment looks like a dynamic ID (e.g. UUIDs, numbers), use "Detail"
        const isId = /^[0-9a-f-]{8,}$/.test(segment) || /^\d+$/.test(segment);
        const label = isId ? 'Detail' : segmentLabels[segment] || segment.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

        const isLast = i === parts.length - 1;

        crumbs.push({
            label,
            href: isLast ? undefined : path,
        });
    }

    return crumbs;
}

export const Breadcrumbs: FC = () => {
    const location = useLocation();
    const crumbs = buildCrumbs(location.pathname);

    // Don't show breadcrumbs on the root/overview page
    if (crumbs.length <= 1) return null;

    return (
        <MantineBreadcrumbs
            separator={<IconChevronRight width="14" height="14" style={{ color: 'var(--text-muted)', opacity: 0.6 }} />}
            style={{ marginBottom: 'var(--space-3)' }}
        >
            {crumbs.map((crumb, index) =>
                crumb.href ? (
                    <Anchor
                        key={index}
                        component={Link}
                        to={crumb.href}
                        size="sm"
                        style={{
                            color: 'var(--text-muted)',
                            fontFamily: 'DM Sans, sans-serif',
                            fontWeight: 500,
                            fontSize: '0.8rem',
                            textDecoration: 'none',
                            transition: 'color var(--transition-fast)',
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            e.currentTarget.style.color = 'var(--brand)';
                        }}
                        onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            e.currentTarget.style.color = 'var(--text-muted)';
                        }}
                    >
                        {crumb.label}
                    </Anchor>
                ) : (
                    <Text
                        key={index}
                        size="sm"
                        style={{
                            color: 'var(--text-secondary)',
                            fontFamily: 'DM Sans, sans-serif',
                            fontWeight: 600,
                            fontSize: '0.8rem',
                        }}
                    >
                        {crumb.label}
                    </Text>
                )
            )}
        </MantineBreadcrumbs>
    );
};

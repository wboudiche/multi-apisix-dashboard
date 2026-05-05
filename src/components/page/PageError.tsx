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
import { Box, Button, Code, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { type FC } from 'react';

import IconHome from '~icons/material-symbols/home';
import IconRefresh from '~icons/material-symbols/refresh';
import IconWarning from '~icons/material-symbols/warning-rounded';

type PageErrorProps = {
    error?: Error | unknown;
    title?: string;
    message?: string;
    showRetry?: boolean;
    showHome?: boolean;
    onRetry?: () => void;
};

export const PageError: FC<PageErrorProps> = ({
    error,
    title = 'Something went wrong',
    message = 'An unexpected error occurred while loading this page.',
    showRetry = true,
    showHome = true,
    onRetry,
}) => {
    const navigate = useNavigate();

    const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : null;

    return (
        <Box
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '50vh',
            }}
        >
            <Paper
                p="xl"
                radius="lg"
                style={{
                    maxWidth: 520,
                    width: '100%',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-light)',
                    boxShadow: 'var(--shadow-md)',
                    textAlign: 'center',
                }}
            >
                <Stack align="center" gap="lg">
                    <Box
                        style={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            background: 'rgba(248, 66, 63, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <IconWarning width="28" height="28" style={{ color: 'var(--brand)' }} />
                    </Box>

                    <Stack gap={4}>
                        <Title
                            order={3}
                            style={{
                                fontFamily: 'Outfit, sans-serif',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                            }}
                        >
                            {title}
                        </Title>
                        <Text
                            size="sm"
                            style={{
                                color: 'var(--text-muted)',
                                fontFamily: 'DM Sans, sans-serif',
                                lineHeight: 1.6,
                            }}
                        >
                            {message}
                        </Text>
                    </Stack>

                    {errorMessage && (
                        <Code
                            block
                            p="md"
                            style={{
                                borderRadius: 'var(--radius-md)',
                                maxHeight: 120,
                                overflow: 'auto',
                                border: '1px solid var(--border-light)',
                                background: 'var(--bg-primary)',
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '0.75rem',
                                textAlign: 'left',
                                width: '100%',
                            }}
                        >
                            {errorMessage}
                        </Code>
                    )}

                    <Group gap="md" mt="xs">
                        {showRetry && (
                            <Button
                                variant="filled"
                                leftSection={<IconRefresh width="16" height="16" />}
                                onClick={onRetry || (() => window.location.reload())}
                            >
                                Retry
                            </Button>
                        )}
                        {showHome && (
                            <Button
                                variant="outline"
                                color="gray"
                                leftSection={<IconHome width="16" height="16" />}
                                onClick={() => navigate({ to: '/' })}
                                className="Button-secondary"
                            >
                                Go Home
                            </Button>
                        )}
                    </Group>
                </Stack>
            </Paper>
        </Box>
    );
};

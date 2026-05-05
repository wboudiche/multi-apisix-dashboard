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
import { Box, Loader, Stack, Text } from '@mantine/core';
import { type FC } from 'react';

type PageLoaderProps = {
    message?: string;
};

export const PageLoader: FC<PageLoaderProps> = ({ message = 'Loading…' }) => {
    return (
        <Box
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '60vh',
            }}
        >
            <Stack align="center" gap="lg">
                <Box
                    style={{
                        position: 'relative',
                        width: 64,
                        height: 64,
                    }}
                >
                    {/* Outer glow ring */}
                    <Box
                        style={{
                            position: 'absolute',
                            inset: -8,
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, rgba(248, 66, 63, 0.12) 0%, transparent 70%)',
                            animation: 'pulse 2s ease-in-out infinite',
                        }}
                    />
                    <Loader
                        size="xl"
                        color="var(--brand)"
                        type="dots"
                    />
                </Box>
                <Text
                    size="sm"
                    style={{
                        color: 'var(--text-muted)',
                        fontFamily: 'DM Sans, sans-serif',
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                    }}
                >
                    {message}
                </Text>
            </Stack>
        </Box>
    );
};

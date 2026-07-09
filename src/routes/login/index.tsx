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

import {
  Box,
  Button,
  Center,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { createFileRoute,useNavigate } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useState } from 'react';

import { authApi } from '@/apis/auth';
import {
  accessTokenAtom,
  currentUserAtom,
  refreshTokenAtom,
  tokenExpiryAtom,
} from '@/stores/auth';

const Login = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const setAccessToken = useSetAtom(accessTokenAtom);
  const setRefreshToken = useSetAtom(refreshTokenAtom);
  const setTokenExpiry = useSetAtom(tokenExpiryAtom);
  const setCurrentUser = useSetAtom(currentUserAtom);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login({ username, password });

      // Store tokens
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      setTokenExpiry(Date.now() + response.expires_in * 1000);

      // Get current user
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);

      notifications.show({
        title: 'Login successful',
        message: `Welcome, ${user.username}!`,
        color: 'green',
      });

      navigate({ to: '/' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      notifications.show({
        title: 'Login failed',
        message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #FAFBFC 0%, #F0F2F5 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative background elements */}
      <Box
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(248, 66, 63, 0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <Box
        style={{
          position: 'absolute',
          bottom: '-20%',
          left: '-10%',
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(248, 66, 63, 0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <Container size={420} py={40} style={{ position: 'relative', zIndex: 1 }}>
        {/* Logo and Title */}
        <Box ta="center" mb={30}>
          <Title
            style={{
              fontWeight: 700,
              fontSize: '2.5rem',
              background: 'linear-gradient(135deg, #F8423F 0%, #E53532 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              marginBottom: '8px',
            }}
          >
            APISIX Dashboard
          </Title>
          <Text size="sm" c="dimmed">
            Multi-Instance Management
          </Text>
        </Box>

        {/* Login Card */}
        <Paper
          shadow="lg"
          p={30}
          radius="lg"
          style={{
            background: '#FFFFFF',
            border: '1px solid #E9ECEF',
          }}
        >
          <form onSubmit={handleLogin}>
            <Stack gap="md">
              <TextInput
                label="Username"
                placeholder="Enter your username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <PasswordInput
                label="Password"
                placeholder="Enter your password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                styles={{
                  input: {
                    '&:focus': {
                      borderColor: '#F8423F',
                    },
                  },
                  visibilityToggle: {
                    color: '#5C5F66',
                    '&:hover': {
                      color: '#F8423F',
                    },
                  },
                }}
              />

              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}

              <Button
                type="submit"
                fullWidth
                loading={loading}
                mt="sm"
              >
                Sign in
              </Button>
            </Stack>
          </form>
        </Paper>

        {/* Footer */}
        <Center mt="lg">
          <Text size="sm" c="dimmed">
            Licensed under the Apache License, Version 2.0
          </Text>
        </Center>
      </Container>
    </Box>
  );
};

export const Route = createFileRoute('/login/')({
  component: Login,
});

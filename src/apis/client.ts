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
import axios from 'axios';

import { appUrl } from '@/utils/app-url';
import { assertJsonBody } from '@/utils/response-shape';

import { endSession, refreshSession, SessionOverError } from './session';

export const apiClient = axios.create();

// Request interceptor — attach token and instance/team headers
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth:access_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    const instanceId = localStorage.getItem('instance:current_id') || '';
    if (instanceId) {
        config.headers['X-Instance-ID'] = instanceId;
    }
    const teamId = localStorage.getItem(`team:current_id:${instanceId}`) || '';
    if (teamId) {
        config.headers['X-Team-ID'] = teamId;
    }
    return config;
});

// Response interceptor — auto-refresh on 401
apiClient.interceptors.response.use(
    (response) => {
        // Every /api/* endpoint answers JSON. A 2xx carrying text is the
        // dashboard's own index.html coming back from a misrouted proxy, and
        // axios has already resolved it — see src/utils/response-shape.ts.
        assertJsonBody(response.data, response.config.url ?? '');
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        // The backend gates every endpoint behind a pending password change;
        // send the user to the dedicated screen instead of surfacing 403s.
        if (
            error.response?.status === 403 &&
            error.response?.data?.code === 'password_change_required' &&
            !window.location.pathname.endsWith('/change-password')
        ) {
            window.location.href = appUrl('/change-password');
            return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            // Every endpoint on this client sits behind the dashboard's own
            // auth middleware, so a 401 here is always this session — unlike
            // `req`, which also carries a gateway's rejections.
            try {
                const token = await refreshSession();
                originalRequest.headers.Authorization = `Bearer ${token}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                // Same rule as `req`: only a refusal ends the session. Anything
                // else — the network, a restarting backend, a proxy answering
                // with index.html — is reported as itself, and its message is
                // the only one that names what is actually wrong.
                if (refreshError instanceof SessionOverError) {
                    endSession();
                    return Promise.reject(error);
                }
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

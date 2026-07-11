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

import { authApi } from './auth';

let isRefreshing = false;
let failedQueue: Array<{
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

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
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // The backend gates every endpoint behind a pending password change;
        // send the user to the dedicated screen instead of surfacing 403s.
        if (
            error.response?.status === 403 &&
            error.response?.data?.code === 'password_change_required' &&
            !window.location.pathname.endsWith('/change-password')
        ) {
            window.location.href = '/ui/change-password';
            return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                }).then((token) => {
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    return apiClient(originalRequest);
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const refreshToken = localStorage.getItem('auth:refresh_token');
            if (!refreshToken) {
                // No refresh token — redirect to login
                localStorage.removeItem('auth:access_token');
                localStorage.removeItem('auth:refresh_token');
                localStorage.removeItem('auth:token_expiry');
                window.location.href = '/login';
                return Promise.reject(error);
            }

            try {
                const data = await authApi.refresh(refreshToken);
                localStorage.setItem('auth:access_token', data.access_token);
                localStorage.setItem('auth:refresh_token', data.refresh_token);
                localStorage.setItem(
                    'auth:token_expiry',
                    String(Date.now() + data.expires_in * 1000)
                );

                processQueue(null, data.access_token);
                originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);
                localStorage.removeItem('auth:access_token');
                localStorage.removeItem('auth:refresh_token');
                localStorage.removeItem('auth:token_expiry');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

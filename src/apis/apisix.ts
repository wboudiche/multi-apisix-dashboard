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

// Use proxy - no baseURL needed, requests go through Vite
const API_BASE = '/api/v1';

const getAuthHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem('auth:access_token')}`,
});

const getInstanceId = () => localStorage.getItem('instance:current_id');

// Generic proxy request
const proxyRequest = async (method: string, path: string, data?: unknown) => {
  const instanceId = getInstanceId();
  if (!instanceId) {
    throw new Error('No instance selected');
  }

  const url = `${API_BASE}/apisix${path}?instance_id=${instanceId}`;
  
  const response = await axios({
    method,
    url,
    headers: {
      ...getAuthHeader(),
      'Content-Type': 'application/json',
    },
    data,
  });
  
  return response.data;
};

export const apisixApi = {
  // Routes
  listRoutes: async () => {
    return proxyRequest('GET', '/routes');
  },
  
  getRoute: async (id: string) => {
    return proxyRequest('GET', `/admin/routes/${id}`);
  },
  
  createRoute: async (data: unknown) => {
    return proxyRequest('POST', '/admin/routes', data);
  },
  
  updateRoute: async (id: string, data: unknown) => {
    return proxyRequest('PUT', `/admin/routes/${id}`, data);
  },
  
  deleteRoute: async (id: string) => {
    return proxyRequest('DELETE', `/admin/routes/${id}`);
  },

  // Services
  listServices: async () => {
    return proxyRequest('GET', '/services');
  },
  
  getService: async (id: string) => {
    return proxyRequest('GET', `/admin/services/${id}`);
  },
  
  createService: async (data: unknown) => {
    return proxyRequest('POST', '/admin/services', data);
  },
  
  updateService: async (id: string, data: unknown) => {
    return proxyRequest('PUT', `/admin/services/${id}`, data);
  },
  
  deleteService: async (id: string) => {
    return proxyRequest('DELETE', `/admin/services/${id}`);
  },

  // Upstreams
  listUpstreams: async () => {
    return proxyRequest('GET', '/upstreams');
  },
  
  getUpstream: async (id: string) => {
    return proxyRequest('GET', `/admin/upstreams/${id}`);
  },
  
  createUpstream: async (data: unknown) => {
    return proxyRequest('POST', '/admin/upstreams', data);
  },
  
  updateUpstream: async (id: string, data: unknown) => {
    return proxyRequest('PUT', `/admin/upstreams/${id}`, data);
  },
  
  deleteUpstream: async (id: string) => {
    return proxyRequest('DELETE', `/admin/upstreams/${id}`);
  },

  // Consumers
  listConsumers: async () => {
    return proxyRequest('GET', '/consumers');
  },
  
  createConsumer: async (data: unknown) => {
    return proxyRequest('POST', '/admin/consumers', data);
  },
  
  deleteConsumer: async (id: string) => {
    return proxyRequest('DELETE', `/admin/consumers/${id}`);
  },
};

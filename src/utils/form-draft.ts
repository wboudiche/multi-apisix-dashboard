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

/**
 * Form values as a draft may keep them in localStorage: without the
 * client_secret of any plugin. A secret filled in from Keycloak, or typed,
 * has no business outliving the page in the browser's storage. The values
 * given are not changed.
 */
export const withoutPluginSecrets = <T extends Record<string, unknown>>(values: T): T => {
  const plugins = values.plugins;
  if (!plugins || typeof plugins !== 'object') return values;
  const kept: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(plugins as Record<string, unknown>)) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const rest: Record<string, unknown> = { ...(config as Record<string, unknown>) };
      delete rest.client_secret;
      kept[name] = rest;
    } else {
      kept[name] = config;
    }
  }
  return { ...values, plugins: kept };
};

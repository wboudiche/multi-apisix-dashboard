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
 * The authentication plugins whose callers are held by the gateway itself:
 * a route carries the plugin, and each consumer that may get through holds a
 * credential of it - a key, a username and a password. The plugin's own form
 * lists those consumers and makes a new one, so nobody has to know that a
 * key lives on a consumer, two menus away from the route it opens.
 */
export const AUTH_CLIENT_PLUGINS = ['key-auth', 'basic-auth'] as const;
export type AuthClientPlugin = (typeof AUTH_CLIENT_PLUGINS)[number];

export const isAuthClientPlugin = (name: string): name is AuthClientPlugin =>
  (AUTH_CLIENT_PLUGINS as readonly string[]).includes(name);

/**
 * The fields of each plugin that most configurations set, shown first; the
 * rest of its form folds away under More options.
 */
export const AUTH_PRIMARY_FIELDS: Record<AuthClientPlugin, string[]> = {
  'key-auth': ['header', 'hide_credentials'],
  'basic-auth': ['hide_credentials'],
};

/** A consumer's name, as APISIX accepts it. */
export const CLIENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** A random secret, hex, from the browser's cryptographic generator. */
export const generateSecret = (bytes = 16): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

type WithPlugins = { plugins?: Record<string, unknown> };

/**
 * Whether a consumer holds a credential of the plugin: in its own plugins,
 * the way before APISIX had credentials, or in one of its credentials.
 */
export const holdsCredential = (
  plugin: string,
  consumer: WithPlugins,
  credentials: WithPlugins[]
): boolean =>
  !!consumer.plugins?.[plugin] ||
  credentials.some((c) => !!c.plugins?.[plugin]);

/** What a new client's credential carries, by plugin. */
export const credentialConfig = (
  plugin: AuthClientPlugin,
  name: string,
  secret: string
): Record<string, string> =>
  plugin === 'key-auth' ? { key: secret } : { username: name, password: secret };

/** The credential's id: the plugin, and a suffix that keeps it unique. */
export const credentialId = (plugin: AuthClientPlugin): string =>
  `${plugin}-${generateSecret(3)}`;

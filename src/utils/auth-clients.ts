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
 * credential of it - a key, a username and a password, a secret it signs
 * tokens or requests with. The plugin's own form
 * lists those consumers and makes a new one, so nobody has to know that a
 * key lives on a consumer, two menus away from the route it opens.
 */
export const AUTH_CLIENT_PLUGINS = ['key-auth', 'basic-auth', 'jwt-auth', 'hmac-auth'] as const;
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
  'jwt-auth': ['hide_credentials'],
  'hmac-auth': ['hide_credentials'],
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

/**
 * What a new client's credential carries, by plugin. A JWT names its client
 * by the token's `key` claim and an HMAC signature by its keyId: both are the
 * client's name, which the gateway already holds unique.
 */
export const credentialConfig = (
  plugin: AuthClientPlugin,
  name: string,
  secret: string
): Record<string, string> => {
  switch (plugin) {
    case 'key-auth':
      return { key: secret };
    case 'basic-auth':
      return { username: name, password: secret };
    case 'jwt-auth':
      return { key: name, secret };
    case 'hmac-auth':
      return { key_id: name, secret_key: secret };
  }
};

/** The credential's id: the plugin, and a suffix that keeps it unique. */
export const credentialId = (plugin: AuthClientPlugin): string =>
  `${plugin}-${generateSecret(6)}`;

/** A value as one single-quoted shell word, whatever it holds. */
export const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, '\'\\\'\'')}'`;

/**
 * The header a key-auth configuration names, when it is one a header can be:
 * anything else is not shown to be pasted, and the plugin's default is.
 */
export const usableHeader = (header: unknown, fallback = 'apikey'): string =>
  typeof header === 'string' && /^[A-Za-z0-9-]+$/.test(header) ? header : fallback;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * A JWT signed HS256 with the client's secret, as jwt-auth checks it: the
 * client named by the `key` claim, valid for the seconds given. Made in the
 * browser, for trying the route; the application makes its own.
 */
export const signJwt = async (
  key: string,
  secret: string,
  seconds: number,
  now = Date.now()
): Promise<string> => {
  const enc = new TextEncoder();
  const part = (o: object) => base64url(enc.encode(JSON.stringify(o)));
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
    key,
    exp: Math.floor(now / 1000) + seconds,
  })}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
};

/**
 * A shell script that signs one request as hmac-auth checks it: the keyId,
 * the method and path, and the Date header, each on its own line, signed
 * HMAC-SHA256 with the secret. The date is written in the C locale - the
 * gateway refuses a day or month name in another language.
 */
export const hmacScript = (keyId: string, secret: string): string =>
  [
    `KEY_ID=${shellQuote(keyId)}`,
    `SECRET=${shellQuote(secret)}`,
    'REQ_PATH=/your/path',
    'DATE=$(LC_ALL=C date -u \'+%a, %d %b %Y %H:%M:%S GMT\')',
    'SIG=$(printf \'%s\\n%s %s\\ndate: %s\\n\' "$KEY_ID" GET "$REQ_PATH" "$DATE" \\',
    '  | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)',
    'curl -H "Date: $DATE" \\',
    '  -H "Authorization: Signature keyId=\\"$KEY_ID\\",algorithm=\\"hmac-sha256\\",headers=\\"@request-target date\\",signature=\\"$SIG\\"" \\',
    '  "http://<gateway>$REQ_PATH"',
  ].join('\n');

/**
 * Which clients the route lets through, as its consumer-restriction plugin
 * says. Holding a key opens every route that asks for one; the plugin is what
 * narrows a route to some of them - what an API manager calls a subscription.
 *
 * - `any`: no restriction, every client holding a credential gets through.
 * - `only`: an allow-list of consumer names, the shape this form writes.
 * - `custom`: a restriction this form does not write - a deny-list, by
 *   method, by group, switched off - left to the plugin's own form.
 */
export type Restriction =
  | { mode: 'any' }
  | { mode: 'only'; names: string[] }
  | { mode: 'custom' };

export const RESTRICTION_PLUGIN = 'consumer-restriction';

/**
 * Where the gateway runs consumer-restriction by default: below the
 * authentication plugins, so the consumer is known by the time it looks.
 */
export const RESTRICTION_DEFAULT_PRIORITY = 2400;

/** The keys of a consumer-restriction this form can read and write back. */
const OWN_KEYS = new Set(['type', 'whitelist', 'rejected_code', 'rejected_msg', '_meta']);

export const readRestriction = (config: unknown): Restriction => {
  if (config === undefined || config === null) return { mode: 'any' };
  if (typeof config !== 'object') return { mode: 'custom' };
  const c = config as Record<string, unknown>;
  const meta = c._meta;
  if (
    Object.keys(c).some((k) => !OWN_KEYS.has(k)) ||
    (c.type !== undefined && c.type !== 'consumer_name') ||
    !Array.isArray(c.whitelist) ||
    !c.whitelist.every((n) => typeof n === 'string') ||
    // Switched off, or run on a filter: not a plain list of who gets in.
    (meta !== undefined &&
      (meta === null ||
        typeof meta !== 'object' ||
        (meta as Record<string, unknown>).disable === true ||
        (meta as Record<string, unknown>).filter !== undefined))
  ) {
    return { mode: 'custom' };
  }
  return { mode: 'only', names: c.whitelist as string[] };
};

/** Whether two choices let the same clients in, whatever the order ticked. */
export const sameRestriction = (a: Restriction, b: Restriction): boolean => {
  if (a.mode !== b.mode) return false;
  if (a.mode !== 'only' || b.mode !== 'only') return true;
  const x = [...a.names].sort();
  const y = [...b.names].sort();
  return x.length === y.length && x.every((n, i) => n === y[i]);
};

/**
 * Whether an authentication plugin runs too late for the restriction: the
 * restriction looks at the consumer the plugin found, and the gateway runs
 * the higher priority first. At or below the restriction's, the plugin has
 * found nobody yet when the restriction looks, and every request is refused.
 */
export const runsAfterRestriction = (
  pluginPriority: number | undefined,
  restrictionPriority: number
): boolean => pluginPriority !== undefined && pluginPriority <= restrictionPriority;

/**
 * The consumer-restriction a choice comes to: none at all for every client,
 * or an allow-list of the names, keeping what else the plugin was given - its
 * rejection code and message, its priority.
 */
export const writeRestriction = (
  current: unknown,
  names: string[] | null
): Record<string, unknown> | null => {
  if (names === null) return null;
  const kept =
    current && typeof current === 'object'
      ? { ...(current as Record<string, unknown>) }
      : {};
  delete kept.type;
  return { ...kept, whitelist: names };
};

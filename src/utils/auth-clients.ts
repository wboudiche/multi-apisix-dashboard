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
 * The name a client's credential is found by, for the plugins that name it
 * apart from its secret: a basic-auth username, a JWT's key claim, an HMAC
 * keyId. The gateway finds the client by it and takes a second credential
 * holding the same one without complaint, so it is the client's name with a
 * random suffix: one made elsewhere from the same name, by another team, does
 * not clash with it. It is no secret - every signature names it - so this
 * keeps clients apart by accident, not against someone copying it on purpose.
 */
export const clientIdentifier = (name: string): string => `${name}-${generateSecret(3)}`;

/** What a new client's credential carries, by plugin. */
export const credentialConfig = (
  plugin: AuthClientPlugin,
  identifier: string,
  secret: string
): Record<string, string> => {
  switch (plugin) {
    case 'key-auth':
      return { key: secret };
    case 'basic-auth':
      return { username: identifier, password: secret };
    case 'jwt-auth':
      return { key: identifier, secret };
    case 'hmac-auth':
      return { key_id: identifier, secret_key: secret };
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

/** Whether this page can sign a token: Web Crypto, in a secure context. */
export const canSignJwt = (): boolean => !!globalThis.crypto?.subtle;

/** The claim jwt-auth finds the client by, as the route's form sets it. */
export const jwtKeyClaim = (config: Record<string, unknown>): string =>
  typeof config.key_claim_name === 'string' && config.key_claim_name
    ? config.key_claim_name
    : 'key';

/**
 * A JWT signed HS256 with the client's secret, as jwt-auth checks it: the
 * client named in the claim the route reads, valid until the expiry given.
 * Made in the browser, for trying the route; the application makes its own.
 * Needs Web Crypto, which a page not served over HTTPS or from localhost does
 * not have: see canSignJwt.
 */
export const signJwt = async (
  claim: string,
  identifier: string,
  secret: string,
  exp: number
): Promise<string> => {
  const enc = new TextEncoder();
  const part = (o: object) => base64url(enc.encode(JSON.stringify(o)));
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ [claim]: identifier, exp })}`;
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

const HMAC_ALGORITHMS = ['hmac-sha256', 'hmac-sha512', 'hmac-sha1'] as const;

/** A header name as a shell variable: X-App becomes H_X_APP. */
const headerVar = (header: string): string =>
  `H_${header.toUpperCase().replace(/[-_]/g, '_')}`;

/** A header name a shell line can carry as it is. */
const PLAIN_HEADER = /^[A-Za-z0-9_-]+$/;

/**
 * A shell script that signs one request as the route's hmac-auth checks it:
 * the keyId, the method and path, the Date header and every other header the
 * route requires signed, each on its own line, signed with an algorithm the
 * route allows; and the body's digest when the route validates it or signs
 * it. Its date is written in the C locale - the gateway refuses a day or
 * month name in another language - and its base64 on one line, which
 * `base64` wraps.
 *
 * The headers are spelt as the route spells them: the gateway compares the
 * names it requires with the signed ones case and all. The ones the script
 * can work out - the date, the digest, the host, the length - it does; any
 * other is a variable for the user to set.
 */
export const hmacScript = (
  identifier: string,
  secret: string,
  config: Record<string, unknown>
): string => {
  const allowed = Array.isArray(config.allowed_algorithms)
    ? HMAC_ALGORITHMS.filter((a) => (config.allowed_algorithms as unknown[]).includes(a))
    : [...HMAC_ALGORITHMS];
  const algorithm = allowed[0] ?? 'hmac-sha256';
  const hash = algorithm.replace('hmac-', '');

  // Each required header once, whatever its case, as the route first spells it.
  const seen = new Set<string>();
  const required: string[] = [];
  for (const h of Array.isArray(config.signed_headers) ? config.signed_headers : []) {
    // The request target is signed first whatever the route says.
    if (typeof h !== 'string' || h.toLowerCase() === '@request-target') continue;
    if (seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    required.push(h);
  }
  const unwritable = required.filter((h) => !PLAIN_HEADER.test(h));
  const spelt = (name: string) => required.find((h) => h.toLowerCase() === name);
  const date = spelt('date') ?? 'date';
  const digestName = spelt('digest');
  const lengthName = spelt('content-length');
  const hostName = spelt('host');
  // A body is sent - empty unless set - whenever anything is worked out of it.
  const withBody =
    config.validate_request_body === true || !!digestName || !!lengthName;
  // Each with a variable of its own: X-App and X_App would make the same
  // one, as would content_length the worked-out length's.
  const taken = new Set(['H_HOST', 'H_CONTENT_LENGTH']);
  const others = required
    .filter(
      (h) =>
        PLAIN_HEADER.test(h) &&
        !['date', 'digest', 'content-length', 'host'].includes(h.toLowerCase())
    )
    .map((name) => {
      let variable = headerVar(name);
      for (let i = 2; taken.has(variable); i += 1) variable = `${headerVar(name)}_${i}`;
      taken.add(variable);
      return { name, variable };
    });

  // Signed in the order the Authorization header lists them.
  const signedHeaders: { name: string; value: string }[] = [
    { name: date, value: '"$DATE"' },
    ...(hostName ? [{ name: hostName, value: '"$H_HOST"' }] : []),
    ...(digestName ? [{ name: digestName, value: '"$DIGEST"' }] : []),
    ...(lengthName ? [{ name: lengthName, value: '"$H_CONTENT_LENGTH"' }] : []),
    ...others.map((h) => ({ name: h.name, value: `"$${h.variable}"` })),
  ];
  const format =
    ['%s', '%s %s', ...signedHeaders.map((h) => `${h.name}: %s`)].join('\\n') + '\\n';
  const args = ['"$KEY_ID"', '"$METHOD"', '"$REQ_PATH"', ...signedHeaders.map((h) => h.value)];
  const signed = ['@request-target', ...signedHeaders.map((h) => h.name)].join(' ');

  return [
    ...(unwritable.length
      ? [
          // Only printable characters, quoted: a line break in a route's
          // header name would end the comment and run the rest as a command.
          `# Also required, and to be added by hand: ${unwritable
            .map((h) => JSON.stringify(h.replace(/[^\x20-\x7e]/g, '?')))
            .join(', ')}`,
        ]
      : []),
    'GATEWAY=\'http://<gateway>\'',
    'METHOD=GET',
    'REQ_PATH=/your/path',
    ...others.map((h) => `${h.variable}='value'`),
    ...(withBody ? ['BODY=\'\''] : []),
    `KEY_ID=${shellQuote(identifier)}`,
    `SECRET=${shellQuote(secret)}`,
    'DATE=$(LC_ALL=C date -u \'+%a, %d %b %Y %H:%M:%S GMT\')',
    ...(hostName
      ? ['H_HOST=${GATEWAY#*://}', 'H_HOST=${H_HOST%%/*}', 'H_HOST=${H_HOST#*@}']
      : []),
    ...(withBody
      ? ['DIGEST="SHA-256=$(printf \'%s\' "$BODY" | openssl dgst -sha256 -binary | openssl base64 -A)"']
      : []),
    ...(lengthName
      ? ['H_CONTENT_LENGTH=$(printf \'%s\' "$BODY" | wc -c | tr -d \' \')']
      : []),
    `SIG=$(printf '${format}' ${args.join(' ')} \\`,
    `  | openssl dgst -${hash} -hmac "$SECRET" -binary | openssl base64 -A)`,
    'curl -X "$METHOD" -H "Date: $DATE" \\',
    ...others.map((h) => `  -H "${h.name}: $${h.variable}" \\`),
    // The host as signed: curl's own leaves out a default port, and a user
    // and password, which the signed one would then not match.
    ...(hostName ? ['  -H "Host: $H_HOST" \\'] : []),
    // curl sends the length of the body itself, the same.
    ...(withBody ? ['  -H "Digest: $DIGEST" --data-binary "$BODY" \\'] : []),
    `  -H "Authorization: Signature keyId=\\"$KEY_ID\\",algorithm=\\"${algorithm}\\",headers=\\"${signed}\\",signature=\\"$SIG\\"" \\`,
    '  "$GATEWAY$REQ_PATH"',
  ].join('\n');
};

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

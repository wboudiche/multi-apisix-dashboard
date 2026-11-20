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
import { generateSecret } from './auth-clients';

export const OIDC_PLUGIN = 'openid-connect';

/** The fields of openid-connect most routes set, shown first. */
export const OIDC_PRIMARY_FIELDS = ['discovery', 'client_id', 'client_secret'];

/**
 * How callers sign in, in place of bearer_only: people sent to the
 * provider's login page and kept signed in by a cookie, or applications
 * that send a token they already hold.
 */
export type OidcMode = 'login' | 'token';

export const oidcMode = (config: Record<string, unknown>): OidcMode =>
  config.bearer_only === true ? 'token' : 'login';

/** The configuration with the mode chosen: bearer_only left out for a login. */
export const withOidcMode = (
  config: Record<string, unknown>,
  mode: OidcMode
): Record<string, unknown> => {
  const next = { ...config };
  if (mode === 'token') next.bearer_only = true;
  else delete next.bearer_only;
  return next;
};

/** The shortest session secret the gateway takes. */
const SESSION_SECRET_MIN = 16;

/**
 * The configuration as it is saved: the discovery address without the
 * spaces a paste brings, which the gateway would fetch as they are; and,
 * when it signs people in with a page, a session secret - the gateway keeps
 * them signed in with a cookie it encrypts with it, and refuses the route
 * without one of 16 characters or more. Generated, since nobody has to know
 * it; one already long enough is kept, or every session would end.
 */
export const finishOidc = (config: Record<string, unknown>): Record<string, unknown> => {
  const next =
    typeof config.discovery === 'string' && config.discovery !== config.discovery.trim()
      ? { ...config, discovery: config.discovery.trim() }
      : config;
  if (oidcMode(next) === 'token') return next;
  const session =
    next.session && typeof next.session === 'object'
      ? (next.session as Record<string, unknown>)
      : {};
  if (typeof session.secret === 'string' && session.secret.length >= SESSION_SECRET_MIN) {
    return next;
  }
  return { ...next, session: { ...session, secret: generateSecret(16) } };
};

/** Whether a value is an address the gateway and the browser can both fetch. */
export const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** What a discovery document says, as far as the form has a use for it. */
export type DiscoveryCheck = {
  issuer?: string;
  /** What the mode chosen needs and the provider does not offer. */
  problems: ('noAuthorization' | 'noToken' | 'noKeys' | 'noVerification')[];
};

const has = (doc: Record<string, unknown>, key: string) =>
  typeof doc[key] === 'string' && (doc[key] as string).length > 0;

/**
 * Whether a discovery document serves the mode chosen, the way the gateway
 * uses it. A login needs the provider's authorization and token endpoints,
 * and its keys (jwks_uri) to check the ID token it gets back, unless the
 * route holds a public key. A token handed in is checked one way only: with
 * the route's public key when it has one, else with the provider's keys
 * when use_jwks is on - the provider's introspection is then never asked -
 * else by introspection. Null when the document is not an OpenID
 * configuration at all.
 */
export const checkDiscovery = (
  doc: unknown,
  config: Record<string, unknown>
): DiscoveryCheck | null => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (!has(d, 'issuer')) return null;
  const problems: DiscoveryCheck['problems'] = [];
  const publicKey = has(config, 'public_key');
  if (oidcMode(config) === 'login') {
    if (!has(d, 'authorization_endpoint')) problems.push('noAuthorization');
    if (!has(d, 'token_endpoint')) problems.push('noToken');
    if (!publicKey && !has(d, 'jwks_uri')) problems.push('noKeys');
  } else if (publicKey) {
    // Checked with the route's own key: nothing asked of the provider.
  } else if (config.use_jwks === true) {
    if (!has(d, 'jwks_uri')) problems.push('noKeys');
  } else if (!has(d, 'introspection_endpoint') && !has(config, 'introspection_endpoint')) {
    problems.push('noVerification');
  }
  return { issuer: d.issuer as string, problems };
};

/**
 * Whether a redirect_uri works for a login: without one, the gateway sends
 * people back to each page's own address plus /.apisix/redirect, which
 * changes from page to page and which providers refuse; a path alone is not
 * an address to register with the provider.
 */
export const redirectUriProblem = (
  config: Record<string, unknown>
): 'missing' | 'notAbsolute' | undefined => {
  const value = typeof config.redirect_uri === 'string' ? config.redirect_uri.trim() : '';
  if (!value) return 'missing';
  return isAbsoluteHttpUrl(value) ? undefined : 'notAbsolute';
};

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

/**
 * The configuration with a session secret, when it signs people in with a
 * page: the gateway keeps them signed in with a cookie it encrypts with it,
 * and refuses the route without one. Generated, since nobody has to know
 * it; one already set is kept, or every session would end.
 */
export const withSessionSecret = (config: Record<string, unknown>): Record<string, unknown> => {
  if (oidcMode(config) === 'token') return config;
  const session =
    config.session && typeof config.session === 'object'
      ? (config.session as Record<string, unknown>)
      : {};
  if (typeof session.secret === 'string' && session.secret.length > 0) return config;
  return { ...config, session: { ...session, secret: generateSecret(16) } };
};

/** What a discovery document says, as far as the form has a use for it. */
export type DiscoveryCheck = {
  issuer?: string;
  /** What the mode chosen needs and the provider does not offer. */
  problems: ('noAuthorization' | 'noToken' | 'noVerification')[];
};

const has = (doc: Record<string, unknown>, key: string) =>
  typeof doc[key] === 'string' && (doc[key] as string).length > 0;

/**
 * Whether a discovery document serves the mode chosen. A login needs the
 * provider's authorization and token endpoints; a token handed in needs a
 * way to check it - the provider's introspection, or its keys when the
 * route verifies the signature itself (use_jwks), or a public key the route
 * holds. Null when the document is not an OpenID configuration at all.
 */
export const checkDiscovery = (
  doc: unknown,
  config: Record<string, unknown>
): DiscoveryCheck | null => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (!has(d, 'issuer')) return null;
  const problems: DiscoveryCheck['problems'] = [];
  if (oidcMode(config) === 'login') {
    if (!has(d, 'authorization_endpoint')) problems.push('noAuthorization');
    if (!has(d, 'token_endpoint')) problems.push('noToken');
  } else {
    const introspection = has(d, 'introspection_endpoint') || has(config, 'introspection_endpoint');
    const keys = config.use_jwks === true && has(d, 'jwks_uri');
    if (!introspection && !keys && !has(config, 'public_key')) problems.push('noVerification');
  }
  return { issuer: d.issuer as string, problems };
};

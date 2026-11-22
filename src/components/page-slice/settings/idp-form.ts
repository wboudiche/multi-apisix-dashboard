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
import type { IdentityProvider, IdentityProviderInput } from '@/apis/idps';

/** What the Add/Edit form holds; the secret is only ever what was typed. */
export type IdpFormState = {
  name: string;
  base_url: string;
  realm: string;
  admin_client_id: string;
  admin_client_secret: string;
  client_id_prefix: string;
  instance_ids: string[];
  developers_can_create: boolean;
  redirect_domains: string[];
};

export const emptyIdpForm = (): IdpFormState => ({
  name: '',
  base_url: '',
  realm: '',
  admin_client_id: '',
  admin_client_secret: '',
  client_id_prefix: '',
  instance_ids: [],
  developers_can_create: false,
  redirect_domains: [],
});

/** The form of a stored connection: its secret is never known, so it starts empty. */
export const formFromIdp = (p: IdentityProvider): IdpFormState => ({
  name: p.name,
  base_url: p.base_url,
  realm: p.realm,
  admin_client_id: p.admin_client_id,
  admin_client_secret: '',
  client_id_prefix: p.client_id_prefix,
  instance_ids: p.instance_ids,
  developers_can_create: p.developers_can_create,
  redirect_domains: p.redirect_domains ?? [],
});

/**
 * The request a form stands for. Domains are DNS names, which the backend
 * wants lowercase and without blanks or repeats; the rest is sent as typed
 * and the backend says what it refuses.
 */
export const inputFromForm = (form: IdpFormState): IdentityProviderInput => {
  const domains = form.redirect_domains
    .map((d) => d.trim().toLowerCase())
    .filter((d, i, all) => d !== '' && all.indexOf(d) === i);
  return {
    name: form.name.trim(),
    base_url: form.base_url.trim(),
    realm: form.realm.trim(),
    admin_client_id: form.admin_client_id.trim(),
    admin_client_secret: form.admin_client_secret,
    client_id_prefix: form.client_id_prefix.trim(),
    instance_ids: form.instance_ids,
    developers_can_create: form.developers_can_create,
    redirect_domains: domains,
  };
};

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
 * Straight to the dashboard's etcd, through its HTTP API, for specs that need
 * data the backend's API can no longer produce - the leftovers of an older
 * version, as the maintenance sweep finds them.
 */
const ETCD = process.env['E2E_ETCD_URL'] ?? 'http://127.0.0.1:2379';
const ROOT = '/apisix-dashboard';

const b64 = (s: string) => Buffer.from(s).toString('base64');

const call = async (op: 'put' | 'range' | 'deleterange', body: Record<string, string>) => {
  const res = await fetch(`${ETCD}/v3/kv/${op}`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`etcd ${op} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as { kvs?: unknown[] };
};

/** Writes `value`, as JSON, at a key under the dashboard's prefix. */
export const etcdPut = (key: string, value: unknown) =>
  call('put', { key: b64(`${ROOT}${key}`), value: b64(JSON.stringify(value)) });

export const etcdExists = async (key: string) =>
  ((await call('range', { key: b64(`${ROOT}${key}`) })).kvs ?? []).length > 0;

/** Deletes exactly one key. */
export const etcdDelete = (key: string) => call('deleterange', { key: b64(`${ROOT}${key}`) });

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

import i18n from '@/config/i18n';

export type PluginCategory =
  | 'authentication'
  | 'traffic-control'
  | 'observability'
  | 'transformation'
  | 'security'
  | 'serverless'
  | 'logging'
  | 'protocol'
  | 'ai'
  | 'other';

export type PluginMeta = {
  category: PluginCategory;
  /** What the plugin does, as a key: the picker shows it in the page's language. */
  descriptionKey?: string;
};

export const CATEGORY_COLORS: Record<PluginCategory, string> = {
  'authentication': 'violet',
  'traffic-control': 'blue',
  'observability': 'teal',
  'transformation': 'orange',
  'security': 'red',
  'serverless': 'cyan',
  'logging': 'green',
  'protocol': 'indigo',
  'ai': 'grape',
  'other': 'gray',
};

export const CATEGORY_ORDER: PluginCategory[] = [
  'authentication',
  'security',
  'traffic-control',
  'transformation',
  'observability',
  'logging',
  'serverless',
  'protocol',
  'ai',
  'other',
];

const PLUGIN_METADATA_MAP: Record<string, PluginMeta> = {
  // --- Authentication ---
  'key-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.key-auth' },
  'basic-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.basic-auth' },
  'jwt-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.jwt-auth' },
  'hmac-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.hmac-auth' },
  'ldap-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.ldap-auth' },
  'cas-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.cas-auth' },
  'openid-connect': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.openid-connect' },
  'forward-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.forward-auth' },
  'wolf-rbac': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.wolf-rbac' },
  'authz-keycloak': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.authz-keycloak' },
  'authz-casbin': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.authz-casbin' },
  'authz-casdoor': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.authz-casdoor' },
  'opa': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.opa' },
  'multi-auth': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.multi-auth' },
  'jwe-decrypt': { category: 'authentication', descriptionKey: 'form.plugins.descriptions.jwe-decrypt' },

  // --- Traffic Control ---
  'limit-req': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.limit-req' },
  'limit-count': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.limit-count' },
  'limit-conn': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.limit-conn' },
  'traffic-split': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.traffic-split' },
  'api-breaker': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.api-breaker' },
  'proxy-mirror': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.proxy-mirror' },
  'proxy-cache': { category: 'traffic-control', descriptionKey: 'form.plugins.descriptions.proxy-cache' },

  // --- Security ---
  'cors': { category: 'security', descriptionKey: 'form.plugins.descriptions.cors' },
  'ip-restriction': { category: 'security', descriptionKey: 'form.plugins.descriptions.ip-restriction' },
  'ua-restriction': { category: 'security', descriptionKey: 'form.plugins.descriptions.ua-restriction' },
  'referer-restriction': { category: 'security', descriptionKey: 'form.plugins.descriptions.referer-restriction' },
  'consumer-restriction': { category: 'security', descriptionKey: 'form.plugins.descriptions.consumer-restriction' },
  'csrf': { category: 'security', descriptionKey: 'form.plugins.descriptions.csrf' },
  'uri-blocker': { category: 'security', descriptionKey: 'form.plugins.descriptions.uri-blocker' },
  'request-validation': { category: 'security', descriptionKey: 'form.plugins.descriptions.request-validation' },
  'chaitin-waf': { category: 'security', descriptionKey: 'form.plugins.descriptions.chaitin-waf' },

  // --- Transformation ---
  'proxy-rewrite': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.proxy-rewrite' },
  'response-rewrite': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.response-rewrite' },
  'redirect': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.redirect' },
  'gzip': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.gzip' },
  'body-transformer': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.body-transformer' },
  'fault-injection': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.fault-injection' },
  'mocking': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.mocking' },
  'degraphql': { category: 'transformation', descriptionKey: 'form.plugins.descriptions.degraphql' },

  // --- Observability ---
  'prometheus': { category: 'observability', descriptionKey: 'form.plugins.descriptions.prometheus' },
  'zipkin': { category: 'observability', descriptionKey: 'form.plugins.descriptions.zipkin' },
  'datadog': { category: 'observability', descriptionKey: 'form.plugins.descriptions.datadog' },
  'request-id': { category: 'observability', descriptionKey: 'form.plugins.descriptions.request-id' },
  'skywalking': { category: 'observability', descriptionKey: 'form.plugins.descriptions.skywalking' },

  // --- Logging ---
  'http-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.http-logger' },
  'kafka-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.kafka-logger' },
  'tcp-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.tcp-logger' },
  'udp-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.udp-logger' },
  'syslog': { category: 'logging', descriptionKey: 'form.plugins.descriptions.syslog' },
  'file-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.file-logger' },
  'elasticsearch-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.elasticsearch-logger' },
  'loki-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.loki-logger' },
  'clickhouse-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.clickhouse-logger' },
  'skywalking-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.skywalking-logger' },
  'splunk-hec-logging': { category: 'logging', descriptionKey: 'form.plugins.descriptions.splunk-hec-logging' },
  'rocketmq-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.rocketmq-logger' },
  'loggly': { category: 'logging', descriptionKey: 'form.plugins.descriptions.loggly' },
  'google-cloud-logging': { category: 'logging', descriptionKey: 'form.plugins.descriptions.google-cloud-logging' },
  'sls-logger': { category: 'logging', descriptionKey: 'form.plugins.descriptions.sls-logger' },
  'tencent-cloud-cls': { category: 'logging', descriptionKey: 'form.plugins.descriptions.tencent-cloud-cls' },
  'lago': { category: 'logging', descriptionKey: 'form.plugins.descriptions.lago' },

  // --- Protocol Conversion ---
  'grpc-transcode': { category: 'protocol', descriptionKey: 'form.plugins.descriptions.grpc-transcode' },
  'grpc-web': { category: 'protocol', descriptionKey: 'form.plugins.descriptions.grpc-web' },
  'http-dubbo': { category: 'protocol', descriptionKey: 'form.plugins.descriptions.http-dubbo' },
  'kafka-proxy': { category: 'protocol', descriptionKey: 'form.plugins.descriptions.kafka-proxy' },

  // --- Serverless ---
  'aws-lambda': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.aws-lambda' },
  'azure-functions': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.azure-functions' },
  'openwhisk': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.openwhisk' },
  'openfunction': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.openfunction' },
  'serverless-pre-function': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.serverless-pre-function' },
  'serverless-post-function': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.serverless-post-function' },

  // --- External Plugins ---
  'ext-plugin-pre-req': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.ext-plugin-pre-req' },
  'ext-plugin-post-req': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.ext-plugin-post-req' },
  'ext-plugin-post-resp': { category: 'serverless', descriptionKey: 'form.plugins.descriptions.ext-plugin-post-resp' },

  // --- AI ---
  'ai-proxy': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-proxy' },
  'ai-proxy-multi': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-proxy-multi' },
  'ai-prompt-template': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-prompt-template' },
  'ai-prompt-decorator': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-prompt-decorator' },
  'ai-prompt-guard': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-prompt-guard' },
  'ai-rate-limiting': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-rate-limiting' },
  'ai-request-rewrite': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-request-rewrite' },
  'ai': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai' },
  'ai-rag': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-rag' },
  'ai-aliyun-content-moderation': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-aliyun-content-moderation' },
  'ai-aws-content-moderation': { category: 'ai', descriptionKey: 'form.plugins.descriptions.ai-aws-content-moderation' },

  // --- Misc ---
  'example-plugin': { category: 'other', descriptionKey: 'form.plugins.descriptions.example-plugin' },
  'inspect': { category: 'other', descriptionKey: 'form.plugins.descriptions.inspect' },
  'real-ip': { category: 'other', descriptionKey: 'form.plugins.descriptions.real-ip' },
  'client-control': { category: 'other', descriptionKey: 'form.plugins.descriptions.client-control' },
  'proxy-control': { category: 'other', descriptionKey: 'form.plugins.descriptions.proxy-control' },
  'public-api': { category: 'other', descriptionKey: 'form.plugins.descriptions.public-api' },
  'workflow': { category: 'other', descriptionKey: 'form.plugins.descriptions.workflow' },
  'attach-consumer-label': { category: 'other', descriptionKey: 'form.plugins.descriptions.attach-consumer-label' },
  'echo': { category: 'other', descriptionKey: 'form.plugins.descriptions.echo' },
  'mcp-bridge': { category: 'other', descriptionKey: 'form.plugins.descriptions.mcp-bridge' },
};

export const getPluginMeta = (name: string): PluginMeta => {
  return PLUGIN_METADATA_MAP[name] || { category: 'other' as PluginCategory };
};

export const getPluginCategory = (name: string): PluginCategory => {
  return getPluginMeta(name).category;
};

/**
 * What a plugin does, in the language of the page: the catalogue's words for
 * a plugin it knows, the gateway's schema's - English, and not ours to
 * translate - for one it does not.
 */
export const getPluginDescription = (name: string, schemaDescription?: string): string => {
  const key = getPluginMeta(name).descriptionKey;
  // eslint-disable-next-line local/readable-key -- spelled in PLUGIN_METADATA_MAP
  if (key) return i18n.t(key as never);
  return schemaDescription ?? '';
};

export const groupPluginsByCategory = (plugins: string[]): Record<PluginCategory, string[]> => {
  const groups: Record<PluginCategory, string[]> = {
    'authentication': [],
    'traffic-control': [],
    'observability': [],
    'transformation': [],
    'security': [],
    'serverless': [],
    'logging': [],
    'protocol': [],
    'ai': [],
    'other': [],
  };
  for (const name of plugins) {
    const cat = getPluginCategory(name);
    groups[cat].push(name);
  }
  return groups;
};

export const summarizePluginConfig = (name: string, config: object): string => {
  if (!config || typeof config !== 'object') return '';
  const entries = Object.entries(config);
  if (entries.length === 0) return '';

  const cat = getPluginCategory(name);

  if (cat === 'traffic-control') {
    const c = config as Record<string, unknown>;
    if (c.rate !== undefined) return `rate: ${c.rate}, burst: ${c.burst ?? 0}`;
    if (c.count !== undefined) return `count: ${c.count}/${c.time_window ?? 60}s`;
    if (c.conn !== undefined) return `conn: ${c.conn}, burst: ${c.burst ?? 0}`;
  }

  if (cat === 'security') {
    const c = config as Record<string, unknown>;
    if (c.whitelist) return i18n.t('form.plugins.summary.allowed', { number: (c.whitelist as unknown[]).length });
    if (c.denylist) return i18n.t('form.plugins.summary.denied', { number: (c.denylist as unknown[]).length });
    if (c.blacklist) return i18n.t('form.plugins.summary.denied', { number: (c.blacklist as unknown[]).length });
    if (c.allow_origins) return `origins: ${c.allow_origins}`;
  }

  if (cat === 'authentication') {
    const c = config as Record<string, unknown>;
    if (c.header) return `header: ${c.header}`;
    if (c.client_id) return `client: ${c.client_id}`;
    if (c.uri) return `uri: ${c.uri}`;
  }

  if (cat === 'logging') {
    const c = config as Record<string, unknown>;
    if (c.uri) return `→ ${c.uri}`;
    if (c.host) return `→ ${c.host}:${c.port ?? ''}`;
    if (c.brokers) return i18n.t('form.plugins.summary.brokers', { number: (c.brokers as unknown[]).length });
    if (c.endpoint_addrs) {
      return i18n.t('form.plugins.summary.endpoints', { number: (c.endpoint_addrs as unknown[]).length });
    }
  }

  if (entries.length <= 3) {
    return entries
      .map(([k, v]) => {
        if (typeof v === 'object') return `${k}: {...}`;
        return `${k}: ${v}`;
      })
      .join(', ');
  }

  return i18n.t('form.plugins.summary.fieldsConfigured', { number: entries.length });
};

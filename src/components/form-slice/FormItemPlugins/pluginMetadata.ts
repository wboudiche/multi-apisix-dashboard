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
  description: string;
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
  'key-auth': { category: 'authentication', description: 'Authenticates requests using an API key header' },
  'basic-auth': { category: 'authentication', description: 'HTTP Basic Authentication' },
  'jwt-auth': { category: 'authentication', description: 'Authenticates requests using JSON Web Tokens' },
  'hmac-auth': { category: 'authentication', description: 'HMAC-based authentication ensuring request integrity' },
  'ldap-auth': { category: 'authentication', description: 'Authenticates requests against an LDAP directory' },
  'cas-auth': { category: 'authentication', description: 'Authentication via CAS 2.0 identity provider' },
  'openid-connect': { category: 'authentication', description: 'Integrates with OIDC identity providers' },
  'forward-auth': { category: 'authentication', description: 'Delegates authentication to an external service' },
  'wolf-rbac': { category: 'authentication', description: 'Role-based access control using Wolf server' },
  'authz-keycloak': { category: 'authentication', description: 'Enforces authorization policies via Keycloak' },
  'authz-casbin': { category: 'authentication', description: 'Authorization based on Casbin access control models' },
  'authz-casdoor': { category: 'authentication', description: 'Centralized authentication via Casdoor with OAuth2' },
  'opa': { category: 'authentication', description: 'Policy-based authorization via Open Policy Agent' },
  'multi-auth': { category: 'authentication', description: 'Enables multiple authentication methods on a route' },
  'jwe-decrypt': { category: 'authentication', description: 'Decrypts JWE-encrypted authorization headers' },

  // --- Traffic Control ---
  'limit-req': { category: 'traffic-control', description: 'Rate limits using the leaky bucket algorithm' },
  'limit-count': { category: 'traffic-control', description: 'Rate limits by request count within a fixed time window' },
  'limit-conn': { category: 'traffic-control', description: 'Limits concurrent connections per key' },
  'traffic-split': { category: 'traffic-control', description: 'Splits traffic across multiple upstreams for canary releases' },
  'api-breaker': { category: 'traffic-control', description: 'Circuit breaker to protect upstream from cascading failures' },
  'proxy-mirror': { category: 'traffic-control', description: 'Duplicates traffic to a mirror server' },
  'proxy-cache': { category: 'traffic-control', description: 'Caches upstream responses based on configurable TTL' },

  // --- Security ---
  'cors': { category: 'security', description: 'Enable Cross-Origin Resource Sharing' },
  'ip-restriction': { category: 'security', description: 'Allow or deny access by client IP address' },
  'ua-restriction': { category: 'security', description: 'Restricts access based on User-Agent patterns' },
  'referer-restriction': { category: 'security', description: 'Restricts access based on the Referer header' },
  'consumer-restriction': { category: 'security', description: 'Restricts route access to specific consumers' },
  'csrf': { category: 'security', description: 'Protects against cross-site request forgery' },
  'uri-blocker': { category: 'security', description: 'Blocks requests matching URI regex patterns' },
  'request-validation': { category: 'security', description: 'Validates request body against JSON Schema' },
  'chaitin-waf': { category: 'security', description: 'Web application firewall via Chaitin SafeLine' },

  // --- Transformation ---
  'proxy-rewrite': { category: 'transformation', description: 'Rewrite URI before proxying to upstream' },
  'response-rewrite': { category: 'transformation', description: 'Modify response headers or body' },
  'redirect': { category: 'transformation', description: 'Configures HTTP redirects with status codes' },
  'gzip': { category: 'transformation', description: 'Dynamically compresses responses using gzip' },
  'body-transformer': { category: 'transformation', description: 'Transforms request/response bodies using templates' },
  'fault-injection': { category: 'transformation', description: 'Injects faults for testing' },
  'mocking': { category: 'transformation', description: 'Returns mock responses without forwarding to upstream' },
  'degraphql': { category: 'transformation', description: 'Exposes GraphQL queries as RESTful endpoints' },

  // --- Observability ---
  'prometheus': { category: 'observability', description: 'Exposes metrics in Prometheus format' },
  'zipkin': { category: 'observability', description: 'Distributed tracing via Zipkin' },
  'datadog': { category: 'observability', description: 'Pushes custom metrics to Datadog via DogStatsD' },
  'request-id': { category: 'observability', description: 'Adds a unique ID to each request for tracing' },
  'skywalking': { category: 'observability', description: 'Distributed tracing via Apache SkyWalking' },

  // --- Logging ---
  'http-logger': { category: 'logging', description: 'Pushes access logs to HTTP/HTTPS endpoints' },
  'kafka-logger': { category: 'logging', description: 'Pushes access logs to Apache Kafka' },
  'tcp-logger': { category: 'logging', description: 'Pushes access logs to a TCP server' },
  'udp-logger': { category: 'logging', description: 'Pushes access logs to a UDP server' },
  'syslog': { category: 'logging', description: 'Pushes access logs to a Syslog server' },
  'file-logger': { category: 'logging', description: 'Writes access logs to a local file' },
  'elasticsearch-logger': { category: 'logging', description: 'Pushes logs to Elasticsearch' },
  'loki-logger': { category: 'logging', description: 'Pushes logs to Grafana Loki' },
  'clickhouse-logger': { category: 'logging', description: 'Pushes logs to ClickHouse database' },
  'skywalking-logger': { category: 'logging', description: 'Pushes logs to Apache SkyWalking OAP server' },
  'splunk-hec-logging': { category: 'logging', description: 'Forwards logs to Splunk via HTTP Event Collector' },
  'rocketmq-logger': { category: 'logging', description: 'Pushes logs to Apache RocketMQ' },
  'loggly': { category: 'logging', description: 'Forwards logs to SolarWinds Loggly' },
  'google-cloud-logging': { category: 'logging', description: 'Sends logs to Google Cloud Logging' },
  'sls-logger': { category: 'logging', description: 'Pushes logs to Alibaba Cloud Log Service' },
  'tencent-cloud-cls': { category: 'logging', description: 'Forwards logs to Tencent Cloud Log Service' },
  'lago': { category: 'logging', description: 'API monetization and billing via Lago' },

  // --- Protocol Conversion ---
  'grpc-transcode': { category: 'protocol', description: 'Converts HTTP requests to gRPC calls' },
  'grpc-web': { category: 'protocol', description: 'Enables gRPC-Web protocol support for browsers' },
  'http-dubbo': { category: 'protocol', description: 'Converts HTTP requests to Dubbo protocol calls' },
  'kafka-proxy': { category: 'protocol', description: 'Configures Kafka upstream connections with SASL auth' },

  // --- Serverless ---
  'aws-lambda': { category: 'serverless', description: 'Proxies requests to AWS Lambda functions' },
  'azure-functions': { category: 'serverless', description: 'Proxies requests to Azure Functions' },
  'openwhisk': { category: 'serverless', description: 'Proxies requests to Apache OpenWhisk actions' },
  'openfunction': { category: 'serverless', description: 'Proxies requests to CNCF OpenFunction endpoints' },
  'serverless-pre-function': { category: 'serverless', description: 'Runs custom Lua functions before other plugins' },
  'serverless-post-function': { category: 'serverless', description: 'Runs custom Lua functions after other plugins' },

  // --- External Plugins ---
  'ext-plugin-pre-req': { category: 'serverless', description: 'Executes external plugins before built-in plugins' },
  'ext-plugin-post-req': { category: 'serverless', description: 'Executes external plugins after built-in plugins' },
  'ext-plugin-post-resp': { category: 'serverless', description: 'Executes external plugins after upstream response' },

  // --- AI ---
  'ai-proxy': { category: 'ai', description: 'Proxies requests to LLM providers' },
  'ai-proxy-multi': { category: 'ai', description: 'Load-balanced proxy to multiple LLM providers' },
  'ai-prompt-template': { category: 'ai', description: 'Pre-configured prompt templates with variable substitution' },
  'ai-prompt-decorator': { category: 'ai', description: 'Prepends or appends system prompts to LLM requests' },
  'ai-prompt-guard': { category: 'ai', description: 'Validates LLM prompts against allow/deny patterns' },
  'ai-rate-limiting': { category: 'ai', description: 'Token-based rate limiting for LLM requests' },
  'ai-request-rewrite': { category: 'ai', description: 'Uses an LLM to transform request bodies' },
  'ai': { category: 'ai', description: 'Base AI plugin for common AI functionality' },
  'ai-rag': { category: 'ai', description: 'Retrieval-Augmented Generation for LLM requests' },
  'ai-aliyun-content-moderation': { category: 'ai', description: 'Content moderation via Alibaba Cloud AI' },
  'ai-aws-content-moderation': { category: 'ai', description: 'Content moderation via AWS Comprehend' },

  // --- Misc ---
  'example-plugin': { category: 'other', description: 'Example plugin for development and testing' },
  'inspect': { category: 'other', description: 'Dynamic debugging plugin for Lua code inspection' },
  'real-ip': { category: 'other', description: 'Sets client real IP from a request header' },
  'client-control': { category: 'other', description: 'Controls client request behavior such as body size limits' },
  'proxy-control': { category: 'other', description: 'Controls proxy behavior such as request buffering' },
  'public-api': { category: 'other', description: 'Exposes internal APISIX API endpoints publicly' },
  'workflow': { category: 'other', description: 'Conditionally executes actions based on request matching' },
  'attach-consumer-label': { category: 'other', description: 'Attaches consumer labels as headers to requests' },
  'echo': { category: 'other', description: 'Debug plugin that modifies response body' },
  'mcp-bridge': { category: 'other', description: 'Bridges Model Context Protocol requests for AI tools' },
};

export const getPluginMeta = (name: string): PluginMeta => {
  return PLUGIN_METADATA_MAP[name] || { category: 'other' as PluginCategory, description: '' };
};

export const getPluginCategory = (name: string): PluginCategory => {
  return getPluginMeta(name).category;
};

export const getPluginDescription = (name: string, schemaDescription?: string): string => {
  if (schemaDescription) return schemaDescription;
  return getPluginMeta(name).description;
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
    if (c.whitelist) return `${(c.whitelist as unknown[]).length} allowed`;
    if (c.denylist) return `${(c.denylist as unknown[]).length} denied`;
    if (c.blacklist) return `${(c.blacklist as unknown[]).length} denied`;
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
    if (c.brokers) return `${(c.brokers as unknown[]).length} broker(s)`;
    if (c.endpoint_addrs) return `${(c.endpoint_addrs as unknown[]).length} endpoint(s)`;
  }

  if (entries.length <= 3) {
    return entries
      .map(([k, v]) => {
        if (typeof v === 'object') return `${k}: {...}`;
        return `${k}: ${v}`;
      })
      .join(', ');
  }

  return `${entries.length} fields configured`;
};

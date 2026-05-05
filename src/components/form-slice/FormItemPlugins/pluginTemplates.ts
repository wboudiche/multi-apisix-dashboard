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
export type PluginTemplate = {
  label: string;
  plugin: string;
  config: Record<string, unknown>;
  description: string;
};

export const PLUGIN_TEMPLATES: PluginTemplate[] = [
  // --- Traffic Control ---
  {
    label: 'Limit Request Rate',
    plugin: 'limit-req',
    config: { rate: 1, burst: 2, key: 'remote_addr', rejected_code: 503, key_type: 'var' },
    description: 'Rate limits using the leaky bucket algorithm',
  },
  {
    label: 'Limit Count',
    plugin: 'limit-count',
    config: { count: 100, time_window: 60, key: 'remote_addr', rejected_code: 429 },
    description: 'Rate limits by request count within a fixed time window',
  },
  {
    label: 'Limit Connections',
    plugin: 'limit-conn',
    config: { conn: 2, burst: 1, default_conn_delay: 0.1, key: 'remote_addr', rejected_code: 503 },
    description: 'Limits concurrent connections per key',
  },
  {
    label: 'Traffic Split',
    plugin: 'traffic-split',
    config: {
      rules: [{
        weighted_upstreams: [{
          upstream: { type: 'roundrobin', nodes: { '127.0.0.1:8081': 1 } },
          weight: 1,
        }],
      }],
    },
    description: 'Splits traffic across multiple upstreams for canary releases',
  },
  {
    label: 'API Breaker',
    plugin: 'api-breaker',
    config: {
      break_response_code: 502,
      unhealthy: { http_statuses: [500, 503], failures: 3 },
      healthy: { http_statuses: [200], successes: 1 },
    },
    description: 'Circuit breaker to protect upstream from cascading failures',
  },
  {
    label: 'Proxy Mirror',
    plugin: 'proxy-mirror',
    config: { host: 'http://127.0.0.1:9797', sample_ratio: 1 },
    description: 'Duplicates traffic to a mirror server',
  },
  {
    label: 'Proxy Cache',
    plugin: 'proxy-cache',
    config: { cache_strategy: 'disk', cache_zone: 'disk_cache_one', cache_ttl: 300 },
    description: 'Caches upstream responses based on configurable TTL',
  },
  // --- Authentication ---
  {
    label: 'Key Auth',
    plugin: 'key-auth',
    config: { header: 'apikey', query: 'apikey', hide_credentials: false },
    description: 'Authenticates requests using an API key header',
  },
  {
    label: 'Basic Auth',
    plugin: 'basic-auth',
    config: { hide_credentials: false },
    description: 'HTTP Basic Authentication',
  },
  {
    label: 'JWT Auth',
    plugin: 'jwt-auth',
    config: { header: 'authorization', query: 'jwt', hide_credentials: false },
    description: 'Authenticates requests using JSON Web Tokens',
  },
  {
    label: 'HMAC Auth',
    plugin: 'hmac-auth',
    config: { hide_credentials: false, signed_headers: ['date'] },
    description: 'HMAC-based authentication ensuring request integrity',
  },
  {
    label: 'LDAP Auth',
    plugin: 'ldap-auth',
    config: { base_dn: 'ou=users,dc=example,dc=org', ldap_uri: 'localhost:1389', uid: 'cn' },
    description: 'Authenticates requests against an LDAP directory',
  },
  {
    label: 'CAS Auth',
    plugin: 'cas-auth',
    config: {
      idp_uri: 'http://127.0.0.1:8080/realms/test/protocol/cas',
      cas_callback_uri: '/cas_callback',
      logout_uri: '/logout',
    },
    description: 'Authentication via CAS 2.0 identity provider',
  },
  {
    label: 'OpenID Connect',
    plugin: 'openid-connect',
    config: {
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
      discovery: 'https://your-provider/.well-known/openid-configuration',
      scope: 'openid profile',
      redirect_uri: '/callback',
    },
    description: 'Integrates with OIDC identity providers (Keycloak, Auth0, Okta)',
  },
  {
    label: 'Forward Auth',
    plugin: 'forward-auth',
    config: {
      uri: 'http://127.0.0.1:9080/auth',
      request_headers: ['Authorization'],
      upstream_headers: ['X-User-ID'],
    },
    description: 'Delegates authentication to an external service',
  },
  {
    label: 'Wolf RBAC',
    plugin: 'wolf-rbac',
    config: { server: 'http://127.0.0.1:12180', appid: 'restful' },
    description: 'Role-based access control using Wolf server',
  },
  {
    label: 'Keycloak Authorization',
    plugin: 'authz-keycloak',
    config: {
      token_endpoint: 'http://127.0.0.1:8090/realms/master/protocol/openid-connect/token',
      client_id: 'your-client-id',
      permissions: ['resource#scope'],
    },
    description: 'Enforces authorization policies via Keycloak',
  },
  {
    label: 'Casbin Authorization',
    plugin: 'authz-casbin',
    config: { model_path: '/path/to/model.conf', policy_path: '/path/to/policy.csv', username: 'user' },
    description: 'Authorization based on Casbin access control models',
  },
  {
    label: 'Casdoor Authorization',
    plugin: 'authz-casdoor',
    config: {
      endpoint_addr: 'http://localhost:8000',
      callback_url: 'http://localhost:9080/callback',
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
    },
    description: 'Centralized authentication via Casdoor with OAuth2',
  },
  {
    label: 'OPA Authorization',
    plugin: 'opa',
    config: { host: 'http://127.0.0.1:8181', policy: 'example' },
    description: 'Policy-based authorization via Open Policy Agent',
  },
  {
    label: 'Multi-Auth',
    plugin: 'multi-auth',
    config: { auth_plugins: [{ 'basic-auth': {} }, { 'key-auth': {} }] },
    description: 'Enables multiple authentication methods on a route',
  },
  {
    label: 'JWE Decrypt',
    plugin: 'jwe-decrypt',
    config: { header: 'Authorization', forward_header: 'Authorization', strict: true },
    description: 'Decrypts JWE-encrypted authorization headers',
  },
  // --- Security ---
  {
    label: 'CORS',
    plugin: 'cors',
    config: { allow_origins: '*', allow_methods: '**', allow_headers: '*', max_age: 5 },
    description: 'Enable Cross-Origin Resource Sharing',
  },
  {
    label: 'IP Restriction',
    plugin: 'ip-restriction',
    config: { whitelist: ['127.0.0.1', '192.168.0.0/24'] },
    description: 'Allow or deny access by client IP address',
  },
  {
    label: 'UA Restriction',
    plugin: 'ua-restriction',
    config: { denylist: ['(Baiduspider)/(\\d+)\\.(\\d+)'] },
    description: 'Restricts access based on User-Agent patterns',
  },
  {
    label: 'Referer Restriction',
    plugin: 'referer-restriction',
    config: { whitelist: ['*.example.com'], bypass_missing: true },
    description: 'Restricts access based on the Referer header',
  },
  {
    label: 'Consumer Restriction',
    plugin: 'consumer-restriction',
    config: { type: 'consumer_name', whitelist: ['consumer-1'] },
    description: 'Restricts route access to specific consumers',
  },
  {
    label: 'CSRF Protection',
    plugin: 'csrf',
    config: { key: 'edd1c9f034335f136f87ad84b625c8f1' },
    description: 'Protects against cross-site request forgery',
  },
  {
    label: 'URI Blocker',
    plugin: 'uri-blocker',
    config: { block_rules: ['root.exe', 'root.m+'], rejected_code: 403 },
    description: 'Blocks requests matching URI regex patterns',
  },
  {
    label: 'Request Validation',
    plugin: 'request-validation',
    config: {
      body_schema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      rejected_code: 400,
    },
    description: 'Validates request body against JSON Schema',
  },
  {
    label: 'Chaitin WAF',
    plugin: 'chaitin-waf',
    config: { mode: 'block', append_waf_resp_header: true },
    description: 'Web application firewall via Chaitin SafeLine',
  },
  // --- Transformation ---
  {
    label: 'Proxy Rewrite',
    plugin: 'proxy-rewrite',
    config: { regex_uri: ['^/prefix/(.*)', '/$1'] },
    description: 'Rewrite URI before proxying to upstream',
  },
  {
    label: 'Response Rewrite',
    plugin: 'response-rewrite',
    config: { headers: { set: { 'X-Custom-Header': 'value' } } },
    description: 'Modify response headers or body',
  },
  {
    label: 'Redirect',
    plugin: 'redirect',
    config: { uri: '/new-path', ret_code: 301 },
    description: 'Configures HTTP redirects with status codes',
  },
  {
    label: 'Gzip Compression',
    plugin: 'gzip',
    config: { min_length: 20, comp_level: 1 },
    description: 'Dynamically compresses responses using gzip',
  },
  {
    label: 'Body Transformer',
    plugin: 'body-transformer',
    config: { request: { input_format: 'json', template: '{"foo":"{{name}}"}' } },
    description: 'Transforms request/response bodies using templates',
  },
  {
    label: 'Fault Injection',
    plugin: 'fault-injection',
    config: { abort: { http_status: 403, body: 'Fault Injection!\n' } },
    description: 'Injects faults (delays or aborts) for testing',
  },
  {
    label: 'Mocking',
    plugin: 'mocking',
    config: {
      response_status: 200,
      content_type: 'application/json',
      response_example: '{"message":"mocked response"}',
    },
    description: 'Returns mock responses without forwarding to upstream',
  },
  {
    label: 'DeGraphQL',
    plugin: 'degraphql',
    config: { query: '{\n  persons {\n    id\n    name\n  }\n}' },
    description: 'Exposes GraphQL queries as RESTful endpoints',
  },
  // --- Observability ---
  {
    label: 'Prometheus',
    plugin: 'prometheus',
    config: { prefer_name: true },
    description: 'Exposes metrics in Prometheus format',
  },
  {
    label: 'Zipkin',
    plugin: 'zipkin',
    config: { endpoint: 'http://127.0.0.1:9411/api/v2/spans', sample_ratio: 1, service_name: 'APISIX' },
    description: 'Distributed tracing via Zipkin',
  },
  {
    label: 'Datadog',
    plugin: 'datadog',
    config: { prefer_name: true },
    description: 'Pushes custom metrics to Datadog via DogStatsD',
  },
  {
    label: 'Request ID',
    plugin: 'request-id',
    config: { header_name: 'X-Request-Id', include_in_response: true, algorithm: 'uuid' },
    description: 'Adds a unique ID to each request for tracing',
  },
  // --- Logging ---
  {
    label: 'HTTP Logger',
    plugin: 'http-logger',
    config: { uri: 'http://example.com/logs' },
    description: 'Pushes access logs to HTTP/HTTPS endpoints',
  },
  {
    label: 'Kafka Logger',
    plugin: 'kafka-logger',
    config: { brokers: [{ host: '127.0.0.1', port: 9092 }], kafka_topic: 'apisix-logs' },
    description: 'Pushes access logs to Apache Kafka',
  },
  {
    label: 'TCP Logger',
    plugin: 'tcp-logger',
    config: { host: '127.0.0.1', port: 5044 },
    description: 'Pushes access logs to a TCP server',
  },
  {
    label: 'UDP Logger',
    plugin: 'udp-logger',
    config: { host: '127.0.0.1', port: 3000 },
    description: 'Pushes access logs to a UDP server',
  },
  {
    label: 'Syslog',
    plugin: 'syslog',
    config: { host: '127.0.0.1', port: 514 },
    description: 'Pushes access logs to a Syslog server',
  },
  {
    label: 'File Logger',
    plugin: 'file-logger',
    config: { path: 'logs/file.log' },
    description: 'Writes access logs to a local file',
  },
  {
    label: 'Elasticsearch Logger',
    plugin: 'elasticsearch-logger',
    config: { endpoint_addrs: ['http://127.0.0.1:9200'], field: { index: 'gateway' } },
    description: 'Pushes logs to Elasticsearch',
  },
  {
    label: 'Loki Logger',
    plugin: 'loki-logger',
    config: { endpoint_addrs: ['http://127.0.0.1:3100'], tenant_id: 'fake', log_labels: { job: 'apisix' } },
    description: 'Pushes logs to Grafana Loki',
  },
  {
    label: 'ClickHouse Logger',
    plugin: 'clickhouse-logger',
    config: {
      user: 'default',
      password: '',
      database: 'default',
      logtable: 'access_log',
      endpoint_addrs: ['http://127.0.0.1:8123'],
    },
    description: 'Pushes logs to ClickHouse database',
  },
  {
    label: 'SkyWalking Logger',
    plugin: 'skywalking-logger',
    config: { endpoint_addr: 'http://127.0.0.1:12800' },
    description: 'Pushes logs to Apache SkyWalking OAP server',
  },
  {
    label: 'Splunk HEC Logging',
    plugin: 'splunk-hec-logging',
    config: { endpoint: { uri: 'http://127.0.0.1:8088/services/collector', token: 'your-hec-token' } },
    description: 'Forwards logs to Splunk via HTTP Event Collector',
  },
  {
    label: 'RocketMQ Logger',
    plugin: 'rocketmq-logger',
    config: { nameserver_list: ['127.0.0.1:9876'], topic: 'apisix-logs' },
    description: 'Pushes logs to Apache RocketMQ',
  },
  {
    label: 'Loggly',
    plugin: 'loggly',
    config: { customer_token: 'your-customer-token' },
    description: 'Forwards logs to SolarWinds Loggly',
  },
  {
    label: 'Google Cloud Logging',
    plugin: 'google-cloud-logging',
    config: {
      auth_config: {
        project_id: 'your-project',
        client_email: 'sa@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nyour-key\n-----END RSA PRIVATE KEY-----',
      },
    },
    description: 'Sends logs to Google Cloud Logging',
  },
  {
    label: 'SLS Logger',
    plugin: 'sls-logger',
    config: {
      host: '100.100.99.135',
      port: 10009,
      project: 'your_project',
      logstore: 'your_logstore',
      access_key_id: 'your_access_key_id',
      access_key_secret: 'your_access_key_secret',
    },
    description: 'Pushes logs to Alibaba Cloud Log Service',
  },
  {
    label: 'Tencent Cloud CLS',
    plugin: 'tencent-cloud-cls',
    config: {
      cls_host: 'ap-guangzhou.cls.tencentyun.com',
      cls_topic: 'your-topic-id',
      secret_id: 'your-secret-id',
      secret_key: 'your-secret-key',
    },
    description: 'Forwards logs to Tencent Cloud Log Service',
  },
  {
    label: 'Lago',
    plugin: 'lago',
    config: {
      endpoint_addrs: ['http://lago:3000'],
      token: 'your-lago-api-key',
      event_transaction_id: '${http_x_request_id}',
      event_subscription_id: '${http_x_consumer_username}',
      event_code: 'api_call',
    },
    description: 'API monetization and billing via Lago',
  },
  // --- Protocol Conversion ---
  {
    label: 'gRPC Transcode',
    plugin: 'grpc-transcode',
    config: { proto_id: '1', service: 'helloworld.Greeter', method: 'SayHello' },
    description: 'Converts HTTP requests to gRPC calls',
  },
  {
    label: 'gRPC Web',
    plugin: 'grpc-web',
    config: {},
    description: 'Enables gRPC-Web protocol support for browsers',
  },
  {
    label: 'HTTP to Dubbo',
    plugin: 'http-dubbo',
    config: { service_name: 'org.example.DemoService', service_version: '0.0.0', method: 'sayHello' },
    description: 'Converts HTTP requests to Dubbo protocol calls',
  },
  {
    label: 'Kafka Proxy',
    plugin: 'kafka-proxy',
    config: { sasl: { username: 'user', password: 'pwd' } },
    description: 'Configures Kafka upstream connections with SASL auth',
  },
  // --- Serverless ---
  {
    label: 'AWS Lambda',
    plugin: 'aws-lambda',
    config: {
      function_uri: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/default/your-function',
      authorization: { apikey: 'your-api-key' },
    },
    description: 'Proxies requests to AWS Lambda functions',
  },
  {
    label: 'Azure Functions',
    plugin: 'azure-functions',
    config: {
      function_uri: 'https://your-app.azurewebsites.net/api/HttpTrigger',
      authorization: { apikey: 'your-api-key' },
    },
    description: 'Proxies requests to Azure Functions',
  },
  {
    label: 'OpenWhisk',
    plugin: 'openwhisk',
    config: {
      api_host: 'http://localhost:3233',
      service_token: 'xxx:xxx',
      namespace: 'guest',
      action: 'test',
    },
    description: 'Proxies requests to Apache OpenWhisk actions',
  },
  {
    label: 'OpenFunction',
    plugin: 'openfunction',
    config: { function_uri: 'http://localhost:3233/default/function-sample/test' },
    description: 'Proxies requests to CNCF OpenFunction endpoints',
  },
  {
    label: 'Serverless Pre-Function',
    plugin: 'serverless-pre-function',
    config: {
      phase: 'rewrite',
      functions: ['return function(conf, ctx) ngx.log(ngx.WARN, "pre-function") end'],
    },
    description: 'Runs custom Lua functions before other plugins',
  },
  {
    label: 'Serverless Post-Function',
    plugin: 'serverless-post-function',
    config: {
      phase: 'header_filter',
      functions: ['return function(conf, ctx) ngx.log(ngx.WARN, "post-function") end'],
    },
    description: 'Runs custom Lua functions after other plugins',
  },
  // --- External Plugins ---
  {
    label: 'Ext Plugin Pre-Request',
    plugin: 'ext-plugin-pre-req',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
    description: 'Executes external plugins before built-in plugins',
  },
  {
    label: 'Ext Plugin Post-Request',
    plugin: 'ext-plugin-post-req',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
    description: 'Executes external plugins after built-in plugins',
  },
  {
    label: 'Ext Plugin Post-Response',
    plugin: 'ext-plugin-post-resp',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
    description: 'Executes external plugins after upstream response',
  },
  // --- AI ---
  {
    label: 'AI Proxy',
    plugin: 'ai-proxy',
    config: {
      provider: 'openai',
      auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
      options: { model: 'gpt-4' },
    },
    description: 'Proxies requests to LLM providers (OpenAI, Anthropic, etc.)',
  },
  {
    label: 'AI Proxy Multi',
    plugin: 'ai-proxy-multi',
    config: {
      instances: [{
        name: 'primary',
        provider: 'openai',
        weight: 1,
        auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
        options: { model: 'gpt-4' },
      }],
    },
    description: 'Load-balanced proxy to multiple LLM providers',
  },
  {
    label: 'AI Prompt Template',
    plugin: 'ai-prompt-template',
    config: {
      templates: [{
        name: 'default',
        template: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: '{{prompt}}' }],
        },
      }],
    },
    description: 'Pre-configured prompt templates with variable substitution',
  },
  {
    label: 'AI Prompt Decorator',
    plugin: 'ai-prompt-decorator',
    config: { prepend: [{ role: 'system', content: 'You are a helpful assistant.' }] },
    description: 'Prepends or appends system prompts to LLM requests',
  },
  {
    label: 'AI Prompt Guard',
    plugin: 'ai-prompt-guard',
    config: { deny_patterns: ['badword'], match_all_roles: false },
    description: 'Validates LLM prompts against allow/deny patterns',
  },
  {
    label: 'AI Rate Limiting',
    plugin: 'ai-rate-limiting',
    config: { limit: 300, time_window: 60, limit_strategy: 'total_tokens', rejected_code: 429 },
    description: 'Token-based rate limiting for LLM requests',
  },
  {
    label: 'AI Request Rewrite',
    plugin: 'ai-request-rewrite',
    config: {
      prompt: 'Transform the request body as needed',
      provider: 'openai',
      auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
      options: { model: 'gpt-4' },
    },
    description: 'Uses an LLM to transform request bodies',
  },
  // --- Misc ---
  {
    label: 'Real IP',
    plugin: 'real-ip',
    config: { source: 'http_x_forwarded_for', trusted_addresses: ['127.0.0.0/24'] },
    description: 'Sets client real IP from a request header',
  },
  {
    label: 'Client Control',
    plugin: 'client-control',
    config: { max_body_size: 10485760 },
    description: 'Controls client request behavior such as body size limits',
  },
  {
    label: 'Proxy Control',
    plugin: 'proxy-control',
    config: { request_buffering: true },
    description: 'Controls proxy behavior such as request buffering',
  },
  {
    label: 'Public API',
    plugin: 'public-api',
    config: { uri: '/apisix/prometheus/metrics' },
    description: 'Exposes internal APISIX API endpoints publicly',
  },
  {
    label: 'Workflow',
    plugin: 'workflow',
    config: {
      rules: [{
        case: [['uri', '==', '/blocked']],
        actions: [['return', { code: 403 }]],
      }],
    },
    description: 'Conditionally executes actions based on request matching',
  },
  {
    label: 'Attach Consumer Label',
    plugin: 'attach-consumer-label',
    config: { headers: { 'X-Consumer-Department': '$department' } },
    description: 'Attaches consumer labels as headers to requests',
  },
  {
    label: 'Echo',
    plugin: 'echo',
    config: { before_body: 'before the body modification' },
    description: 'Debug plugin that modifies response body',
  },
  {
    label: 'MCP Bridge',
    plugin: 'mcp-bridge',
    config: {},
    description: 'Bridges Model Context Protocol requests for AI tools',
  },
];

/**
 * Consumer-specific plugin templates.
 * These use consumer-side config (credentials), not route-side config (validation rules).
 */
export const CONSUMER_PLUGIN_TEMPLATES: PluginTemplate[] = [
  {
    label: 'Key Auth',
    plugin: 'key-auth',
    config: { key: 'my-api-key' },
    description: 'Set the API key credential for this consumer',
  },
  {
    label: 'Basic Auth',
    plugin: 'basic-auth',
    config: { username: 'my-user', password: 'my-password' },
    description: 'Set Basic Auth credentials for this consumer',
  },
  {
    label: 'JWT Auth',
    plugin: 'jwt-auth',
    config: { key: 'my-jwt-key', secret: 'my-jwt-secret' },
    description: 'Set JWT signing credentials for this consumer',
  },
  {
    label: 'HMAC Auth',
    plugin: 'hmac-auth',
    config: { key_id: 'my-key-id', secret_key: 'my-secret-key' },
    description: 'Set HMAC signing credentials for this consumer',
  },
  {
    label: 'LDAP Auth',
    plugin: 'ldap-auth',
    config: { user_dn: 'cn=user,dc=example,dc=com' },
    description: 'Set LDAP distinguished name for this consumer',
  },
];

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
 * A starting configuration for a plugin, offered in its editor. The editor
 * shows only the configuration: the name and the description a template once
 * had were shown nowhere, and the picker reads its descriptions from
 * pluginMetadata.ts.
 */
export type PluginTemplate = {
  plugin: string;
  config: Record<string, unknown>;
};

export const PLUGIN_TEMPLATES: PluginTemplate[] = [
  // --- Traffic Control ---
  {
    plugin: 'limit-req',
    config: { rate: 1, burst: 2, key: 'remote_addr', rejected_code: 503, key_type: 'var' },
  },
  {
    plugin: 'limit-count',
    config: { count: 100, time_window: 60, key: 'remote_addr', rejected_code: 429 },
  },
  {
    plugin: 'limit-conn',
    config: { conn: 2, burst: 1, default_conn_delay: 0.1, key: 'remote_addr', rejected_code: 503 },
  },
  {
    plugin: 'traffic-split',
    config: {
      rules: [{
        weighted_upstreams: [{
          upstream: { type: 'roundrobin', nodes: { '127.0.0.1:8081': 1 } },
          weight: 1,
        }],
      }],
    },
  },
  {
    plugin: 'api-breaker',
    config: {
      break_response_code: 502,
      unhealthy: { http_statuses: [500, 503], failures: 3 },
      healthy: { http_statuses: [200], successes: 1 },
    },
  },
  {
    plugin: 'proxy-mirror',
    config: { host: 'http://127.0.0.1:9797', sample_ratio: 1 },
  },
  {
    plugin: 'proxy-cache',
    config: { cache_strategy: 'disk', cache_zone: 'disk_cache_one', cache_ttl: 300 },
  },
  // --- Authentication ---
  {
    plugin: 'key-auth',
    config: { header: 'apikey', query: 'apikey', hide_credentials: false },
  },
  {
    plugin: 'basic-auth',
    config: { hide_credentials: false },
  },
  {
    plugin: 'jwt-auth',
    config: { header: 'authorization', query: 'jwt', hide_credentials: false },
  },
  {
    plugin: 'hmac-auth',
    config: { hide_credentials: false, signed_headers: ['date'] },
  },
  {
    plugin: 'ldap-auth',
    config: { base_dn: 'ou=users,dc=example,dc=org', ldap_uri: 'localhost:1389', uid: 'cn' },
  },
  {
    plugin: 'cas-auth',
    config: {
      idp_uri: 'http://127.0.0.1:8080/realms/test/protocol/cas',
      cas_callback_uri: '/cas_callback',
      logout_uri: '/logout',
    },
  },
  {
    plugin: 'openid-connect',
    config: {
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
      discovery: 'https://your-provider/.well-known/openid-configuration',
      scope: 'openid profile',
      redirect_uri: '/callback',
    },
  },
  {
    plugin: 'forward-auth',
    config: {
      uri: 'http://127.0.0.1:9080/auth',
      request_headers: ['Authorization'],
      upstream_headers: ['X-User-ID'],
    },
  },
  {
    plugin: 'wolf-rbac',
    config: { server: 'http://127.0.0.1:12180', appid: 'restful' },
  },
  {
    plugin: 'authz-keycloak',
    config: {
      token_endpoint: 'http://127.0.0.1:8090/realms/master/protocol/openid-connect/token',
      client_id: 'your-client-id',
      permissions: ['resource#scope'],
    },
  },
  {
    plugin: 'authz-casbin',
    config: { model_path: '/path/to/model.conf', policy_path: '/path/to/policy.csv', username: 'user' },
  },
  {
    plugin: 'authz-casdoor',
    config: {
      endpoint_addr: 'http://localhost:8000',
      callback_url: 'http://localhost:9080/callback',
      client_id: 'your-client-id',
      client_secret: 'your-client-secret',
    },
  },
  {
    plugin: 'opa',
    config: { host: 'http://127.0.0.1:8181', policy: 'example' },
  },
  {
    plugin: 'multi-auth',
    config: { auth_plugins: [{ 'basic-auth': {} }, { 'key-auth': {} }] },
  },
  {
    plugin: 'jwe-decrypt',
    config: { header: 'Authorization', forward_header: 'Authorization', strict: true },
  },
  // --- Security ---
  {
    plugin: 'cors',
    config: { allow_origins: '*', allow_methods: '**', allow_headers: '*', max_age: 5 },
  },
  {
    plugin: 'ip-restriction',
    config: { whitelist: ['127.0.0.1', '192.168.0.0/24'] },
  },
  {
    plugin: 'ua-restriction',
    config: { denylist: ['(Baiduspider)/(\\d+)\\.(\\d+)'] },
  },
  {
    plugin: 'referer-restriction',
    config: { whitelist: ['*.example.com'], bypass_missing: true },
  },
  {
    plugin: 'consumer-restriction',
    config: { type: 'consumer_name', whitelist: ['consumer-1'] },
  },
  {
    plugin: 'csrf',
    config: { key: 'edd1c9f034335f136f87ad84b625c8f1' },
  },
  {
    plugin: 'uri-blocker',
    config: { block_rules: ['root.exe', 'root.m+'], rejected_code: 403 },
  },
  {
    plugin: 'request-validation',
    config: {
      body_schema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      rejected_code: 400,
    },
  },
  {
    plugin: 'chaitin-waf',
    config: { mode: 'block', append_waf_resp_header: true },
  },
  // --- Transformation ---
  {
    plugin: 'proxy-rewrite',
    config: { regex_uri: ['^/prefix/(.*)', '/$1'] },
  },
  {
    plugin: 'response-rewrite',
    config: { headers: { set: { 'X-Custom-Header': 'value' } } },
  },
  {
    plugin: 'redirect',
    config: { uri: '/new-path', ret_code: 301 },
  },
  {
    plugin: 'gzip',
    config: { min_length: 20, comp_level: 1 },
  },
  {
    plugin: 'body-transformer',
    config: { request: { input_format: 'json', template: '{"foo":"{{name}}"}' } },
  },
  {
    plugin: 'fault-injection',
    // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
    config: { abort: { http_status: 403, body: 'Fault Injection!\n' } },
  },
  {
    plugin: 'mocking',
    config: {
      response_status: 200,
      content_type: 'application/json',
      response_example: '{"message":"mocked response"}',
    },
  },
  {
    plugin: 'degraphql',
    config: { query: '{\n  persons {\n    id\n    name\n  }\n}' },
  },
  // --- Observability ---
  {
    plugin: 'prometheus',
    config: { prefer_name: true },
  },
  {
    plugin: 'zipkin',
    config: { endpoint: 'http://127.0.0.1:9411/api/v2/spans', sample_ratio: 1, service_name: 'APISIX' },
  },
  {
    plugin: 'datadog',
    config: { prefer_name: true },
  },
  {
    plugin: 'request-id',
    config: { header_name: 'X-Request-Id', include_in_response: true, algorithm: 'uuid' },
  },
  // --- Logging ---
  {
    plugin: 'http-logger',
    config: { uri: 'http://example.com/logs' },
  },
  {
    plugin: 'kafka-logger',
    config: { brokers: [{ host: '127.0.0.1', port: 9092 }], kafka_topic: 'apisix-logs' },
  },
  {
    plugin: 'tcp-logger',
    config: { host: '127.0.0.1', port: 5044 },
  },
  {
    plugin: 'udp-logger',
    config: { host: '127.0.0.1', port: 3000 },
  },
  {
    plugin: 'syslog',
    config: { host: '127.0.0.1', port: 514 },
  },
  {
    plugin: 'file-logger',
    config: { path: 'logs/file.log' },
  },
  {
    plugin: 'elasticsearch-logger',
    config: { endpoint_addrs: ['http://127.0.0.1:9200'], field: { index: 'gateway' } },
  },
  {
    plugin: 'loki-logger',
    config: { endpoint_addrs: ['http://127.0.0.1:3100'], tenant_id: 'fake', log_labels: { job: 'apisix' } },
  },
  {
    plugin: 'clickhouse-logger',
    config: {
      user: 'default',
      password: '',
      database: 'default',
      logtable: 'access_log',
      endpoint_addrs: ['http://127.0.0.1:8123'],
    },
  },
  {
    plugin: 'skywalking-logger',
    config: { endpoint_addr: 'http://127.0.0.1:12800' },
  },
  {
    plugin: 'splunk-hec-logging',
    config: { endpoint: { uri: 'http://127.0.0.1:8088/services/collector', token: 'your-hec-token' } },
  },
  {
    plugin: 'rocketmq-logger',
    config: { nameserver_list: ['127.0.0.1:9876'], topic: 'apisix-logs' },
  },
  {
    plugin: 'loggly',
    config: { customer_token: 'your-customer-token' },
  },
  {
    plugin: 'google-cloud-logging',
    config: {
      auth_config: {
        project_id: 'your-project',
        client_email: 'sa@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nyour-key\n-----END RSA PRIVATE KEY-----',
      },
    },
  },
  {
    plugin: 'sls-logger',
    config: {
      host: '100.100.99.135',
      port: 10009,
      project: 'your_project',
      logstore: 'your_logstore',
      access_key_id: 'your_access_key_id',
      access_key_secret: 'your_access_key_secret',
    },
  },
  {
    plugin: 'tencent-cloud-cls',
    config: {
      cls_host: 'ap-guangzhou.cls.tencentyun.com',
      cls_topic: 'your-topic-id',
      secret_id: 'your-secret-id',
      secret_key: 'your-secret-key',
    },
  },
  {
    plugin: 'lago',
    config: {
      endpoint_addrs: ['http://lago:3000'],
      token: 'your-lago-api-key',
      event_transaction_id: '${http_x_request_id}',
      event_subscription_id: '${http_x_consumer_username}',
      event_code: 'api_call',
    },
  },
  // --- Protocol Conversion ---
  {
    plugin: 'grpc-transcode',
    config: { proto_id: '1', service: 'helloworld.Greeter', method: 'SayHello' },
  },
  {
    plugin: 'grpc-web',
    config: {},
  },
  {
    plugin: 'http-dubbo',
    config: { service_name: 'org.example.DemoService', service_version: '0.0.0', method: 'sayHello' },
  },
  {
    plugin: 'kafka-proxy',
    config: { sasl: { username: 'user', password: 'pwd' } },
  },
  // --- Serverless ---
  {
    plugin: 'aws-lambda',
    config: {
      function_uri: 'https://your-api-id.execute-api.us-east-1.amazonaws.com/default/your-function',
      authorization: { apikey: 'your-api-key' },
    },
  },
  {
    plugin: 'azure-functions',
    config: {
      function_uri: 'https://your-app.azurewebsites.net/api/HttpTrigger',
      authorization: { apikey: 'your-api-key' },
    },
  },
  {
    plugin: 'openwhisk',
    config: {
      api_host: 'http://localhost:3233',
      service_token: 'xxx:xxx',
      namespace: 'guest',
      action: 'test',
    },
  },
  {
    plugin: 'openfunction',
    config: { function_uri: 'http://localhost:3233/default/function-sample/test' },
  },
  {
    plugin: 'serverless-pre-function',
    config: {
      phase: 'rewrite',
      functions: ['return function(conf, ctx) ngx.log(ngx.WARN, "pre-function") end'],
    },
  },
  {
    plugin: 'serverless-post-function',
    config: {
      phase: 'header_filter',
      functions: ['return function(conf, ctx) ngx.log(ngx.WARN, "post-function") end'],
    },
  },
  // --- External Plugins ---
  {
    plugin: 'ext-plugin-pre-req',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
  },
  {
    plugin: 'ext-plugin-post-req',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
  },
  {
    plugin: 'ext-plugin-post-resp',
    config: { conf: [{ name: 'ext-plugin-A', value: '{"enable":"feature"}' }] },
  },
  // --- AI ---
  {
    plugin: 'ai-proxy',
    config: {
      provider: 'openai',
      // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
      auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
      options: { model: 'gpt-4' },
    },
  },
  {
    plugin: 'ai-proxy-multi',
    config: {
      instances: [{
        name: 'primary',
        provider: 'openai',
        weight: 1,
        // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
        auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
        options: { model: 'gpt-4' },
      }],
    },
  },
  {
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
  },
  {
    plugin: 'ai-prompt-decorator',
    // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
    config: { prepend: [{ role: 'system', content: 'You are a helpful assistant.' }] },
  },
  {
    plugin: 'ai-prompt-guard',
    config: { deny_patterns: ['badword'], match_all_roles: false },
  },
  {
    plugin: 'ai-rate-limiting',
    config: { limit: 300, time_window: 60, limit_strategy: 'total_tokens', rejected_code: 429 },
  },
  {
    plugin: 'ai-request-rewrite',
    config: {
      // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
      prompt: 'Transform the request body as needed',
      provider: 'openai',
      // eslint-disable-next-line local/no-prose-literal -- configuration sent to the gateway, not text the page shows
      auth: { header: { Authorization: 'Bearer YOUR_API_KEY' } },
      options: { model: 'gpt-4' },
    },
  },
  // --- Misc ---
  {
    plugin: 'real-ip',
    config: { source: 'http_x_forwarded_for', trusted_addresses: ['127.0.0.0/24'] },
  },
  {
    plugin: 'client-control',
    config: { max_body_size: 10485760 },
  },
  {
    plugin: 'proxy-control',
    config: { request_buffering: true },
  },
  {
    plugin: 'public-api',
    config: { uri: '/apisix/prometheus/metrics' },
  },
  {
    plugin: 'workflow',
    config: {
      rules: [{
        case: [['uri', '==', '/blocked']],
        actions: [['return', { code: 403 }]],
      }],
    },
  },
  {
    plugin: 'attach-consumer-label',
    config: { headers: { 'X-Consumer-Department': '$department' } },
  },
  {
    plugin: 'echo',
    config: { before_body: 'before the body modification' },
  },
  {
    plugin: 'mcp-bridge',
    config: {},
  },
];

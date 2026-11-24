// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package handlers

import (
	"bytes"
	"encoding/json"
	"testing"
)

// canon re-encodes a JSON text so two texts that differ only in key order or
// spacing compare equal.
func canon(t *testing.T, s string) string {
	t.Helper()
	d := json.NewDecoder(bytes.NewReader([]byte(s)))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		t.Fatalf("not JSON: %s: %v", s, err)
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func TestRedactCredentials(t *testing.T) {
	tests := []struct {
		name         string
		resourceType string
		in, want     string
	}{
		{
			name:         "route detail: openid-connect secrets at depth",
			resourceType: "routes",
			in: `{"key":"/apisix/routes/r1","value":{"id":"r1","uri":"/x","plugins":{"openid-connect":{
				"client_id":"c","client_secret":"s3cr3t","session":{"secret":"sess"},
				"client_rsa_private_key":"PEM","discovery":"http://kc"}}}}`,
			want: `{"key":"/apisix/routes/r1","value":{"id":"r1","uri":"/x","plugins":{"openid-connect":{
				"client_id":"c","client_secret":"***","session":{"secret":"***"},
				"client_rsa_private_key":"***","discovery":"http://kc"}}}}`,
		},
		{
			name:         "route list: every row, limit-count key kept",
			resourceType: "routes",
			in: `{"total":2,"list":[
				{"key":"/apisix/routes/1","value":{"plugins":{"key-auth":{"key":"k1"},"limit-count":{"key":"remote_addr","count":1}}}},
				{"key":"/apisix/routes/2","value":{"plugins":{"basic-auth":{"password":"p"}}}}]}`,
			want: `{"total":2,"list":[
				{"key":"/apisix/routes/1","value":{"plugins":{"key-auth":{"key":"***"},"limit-count":{"key":"remote_addr","count":1}}}},
				{"key":"/apisix/routes/2","value":{"plugins":{"basic-auth":{"password":"***"}}}}]}`,
		},
		{
			name:         "consumer: auth plugin credentials",
			resourceType: "consumers",
			in: `{"key":"/apisix/consumers/u","value":{"username":"u","plugins":{
				"key-auth":{"key":"kk"},"basic-auth":{"username":"u","password":"pw"},
				"jwt-auth":{"key":"jk","secret":"js","private_key":"PK","public_key":"PUB"},
				"hmac-auth":{"key_id":"id","secret_key":"hs"}}}}`,
			want: `{"key":"/apisix/consumers/u","value":{"username":"u","plugins":{
				"key-auth":{"key":"***"},"basic-auth":{"username":"u","password":"***"},
				"jwt-auth":{"key":"jk","secret":"***","private_key":"***","public_key":"PUB"},
				"hmac-auth":{"key_id":"id","secret_key":"***"}}}}`,
		},
		{
			name:         "consumer credentials list",
			resourceType: "consumers",
			in:           `{"total":1,"list":[{"key":"/apisix/consumers/u/credentials/c1","value":{"plugins":{"key-auth":{"key":"ck"}}}}]}`,
			want:         `{"total":1,"list":[{"key":"/apisix/consumers/u/credentials/c1","value":{"plugins":{"key-auth":{"key":"***"}}}}]}`,
		},
		{
			name:         "service, plugin_config, global_rule plugins",
			resourceType: "global_rules",
			in:           `{"key":"/apisix/global_rules/1","value":{"plugins":{"openid-connect":{"client_secret":"g"},"x":{"redis_password":"r"}}}}`,
			want:         `{"key":"/apisix/global_rules/1","value":{"plugins":{"openid-connect":{"client_secret":"***"},"x":{"redis_password":"***"}}}}`,
		},
		{
			name:         "a secret that is an object or an array is replaced whole",
			resourceType: "plugin_configs",
			in:           `{"value":{"plugins":{"p":{"client_secret":{"a":1},"secret":["a","b"]}}}}`,
			want:         `{"value":{"plugins":{"p":{"client_secret":"***","secret":"***"}}}}`,
		},
		{
			name:         "null and empty values stay as they are",
			resourceType: "routes",
			in:           `{"value":{"plugins":{"openid-connect":{"client_secret":"","session":{"secret":null},"client_key":{}}}}}`,
			want:         `{"value":{"plugins":{"openid-connect":{"client_secret":"","session":{"secret":null},"client_key":{}}}}}`,
		},
		{
			name:         "ssl detail: key and keys, cert kept",
			resourceType: "ssls",
			in:           `{"key":"/apisix/ssls/1","value":{"cert":"C","key":"K","certs":["C2"],"keys":["K2"],"snis":["a"]}}`,
			want:         `{"key":"/apisix/ssls/1","value":{"cert":"C","key":"***","certs":["C2"],"keys":"***","snis":["a"]}}`,
		},
		{
			name:         "ssl list: the row's etcd key is not the private key",
			resourceType: "ssls",
			in:           `{"total":1,"list":[{"key":"/apisix/ssls/1","value":{"cert":"C","key":"K"}}]}`,
			want:         `{"total":1,"list":[{"key":"/apisix/ssls/1","value":{"cert":"C","key":"***"}}]}`,
		},
		{
			name:         "a key at the top of a route is not a credential",
			resourceType: "routes",
			in:           `{"key":"/apisix/routes/1","value":{"key":"x","keys":["y"]}}`,
			want:         `{"key":"/apisix/routes/1","value":{"key":"x","keys":["y"]}}`,
		},
		{
			name:         "vault secret: token",
			resourceType: "secrets",
			in:           `{"key":"/apisix/secrets/vault/1","value":{"uri":"http://v","prefix":"p","token":"hvs"}}`,
			want:         `{"key":"/apisix/secrets/vault/1","value":{"uri":"http://v","prefix":"p","token":"***"}}`,
		},
		{
			name:         "aws secret: secret_access_key",
			resourceType: "secrets",
			in:           `{"total":1,"list":[{"key":"/apisix/secrets/aws/1","value":{"access_key_id":"a","secret_access_key":"s"}}]}`,
			want:         `{"total":1,"list":[{"key":"/apisix/secrets/aws/1","value":{"access_key_id":"a","secret_access_key":"***"}}]}`,
		},
		{
			name:         "empty table as an object",
			resourceType: "routes",
			in:           `{"total":0,"list":{}}`,
			want:         `{"total":0,"list":{}}`,
		},
		{
			name:         "large numbers keep their precision",
			resourceType: "routes",
			in:           `{"value":{"priority":12345678901234567890,"plugins":{"key-auth":{"key":"k"}}}}`,
			want:         `{"value":{"priority":12345678901234567890,"plugins":{"key-auth":{"key":"***"}}}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := redactCredentials(tt.resourceType, []byte(tt.in))
			if err != nil {
				t.Fatalf("refused: %v", err)
			}
			if canon(t, string(got)) != canon(t, tt.want) {
				t.Errorf("got  %s\nwant %s", got, canon(t, tt.want))
			}
		})
	}
}

func TestRedactCredentialsRefusesWhatItCannotRead(t *testing.T) {
	// Not one JSON value: what it holds cannot be told, so none of it is
	// answered to a caller who must not read a credential.
	for _, in := range []string{`not json`, `{"a":1} {}`, `{"a":1} x`, "\x1f\x8b\x08\x00garbage", `{"a":`} {
		if got, err := redactCredentials("routes", []byte(in)); err == nil {
			t.Errorf("%q came back as %q", in, got)
		}
	}
}

func TestRedactCredentialsAnswersAnEmptyBodyAsItIs(t *testing.T) {
	for _, in := range []string{``, "  \n"} {
		if got, err := redactCredentials("routes", []byte(in)); err != nil || string(got) != in {
			t.Errorf("%q: %q, %v", in, got, err)
		}
	}
}

func TestRedactCredentialsLeavesAnAnswerWithNothingToHideAsItWas(t *testing.T) {
	in := `{"value": {"uri":"/x",  "id":"1"}}`
	if got, err := redactCredentials("routes", []byte(in)); err != nil || string(got) != in {
		t.Errorf("rewritten: %s, %v", got, err)
	}
}

// Every field APISIX 3.16 declares in a plugin's encrypt_fields, and the
// plugins whose credentials it does not encrypt, each where the plugin keeps
// it. Each config also holds a field of the same plugin that must stay.
func TestRedactCredentialsByPlugin(t *testing.T) {
	tests := []struct{ plugin, in, want string }{
		{"key-auth", `{"key":"S","hide_credentials":true}`, `{"key":"***","hide_credentials":true}`},
		{"basic-auth", `{"username":"u","password":"S"}`, `{"username":"u","password":"***"}`},
		{"jwt-auth", `{"key":"k","secret":"S","private_key":"S","public_key":"P"}`, `{"key":"k","secret":"***","private_key":"***","public_key":"P"}`},
		{"hmac-auth", `{"key_id":"k","secret_key":"S"}`, `{"key_id":"k","secret_key":"***"}`},
		{"openid-connect", `{"client_id":"c","client_secret":"S","client_rsa_private_key":"S","session":{"secret":"S"}}`, `{"client_id":"c","client_secret":"***","client_rsa_private_key":"***","session":{"secret":"***"}}`},
		{"authz-keycloak", `{"client_id":"c","client_secret":"S"}`, `{"client_id":"c","client_secret":"***"}`},
		{"authz-casdoor", `{"client_id":"c","client_secret":"S"}`, `{"client_id":"c","client_secret":"***"}`},
		{"csrf", `{"key":"S","expires":7200}`, `{"key":"***","expires":7200}`},
		{"jwe-decrypt", `{"key":"S","secret":"S","header":"h"}`, `{"key":"***","secret":"***","header":"h"}`},
		{"elasticsearch-logger", `{"field":{"index":"i"},"auth":{"username":"u","password":"S"}}`, `{"field":{"index":"i"},"auth":{"username":"u","password":"***"}}`},
		{"clickhouse-logger", `{"user":"u","password":"S"}`, `{"user":"u","password":"***"}`},
		{"kafka-proxy", `{"sasl":{"username":"u","password":"S"}}`, `{"sasl":{"username":"u","password":"***"}}`},
		{"kafka-logger", `{"brokers":[{"host":"h","sasl_config":{"user":"u","password":"S"}}]}`, `{"brokers":[{"host":"h","sasl_config":{"user":"u","password":"***"}}]}`},
		{"lago", `{"endpoint_addrs":["a"],"token":"S"}`, `{"endpoint_addrs":["a"],"token":"***"}`},
		{"openwhisk", `{"namespace":"n","service_token":"S"}`, `{"namespace":"n","service_token":"***"}`},
		{"rocketmq-logger", `{"topic":"t","access_key":"S","secret_key":"S"}`, `{"topic":"t","access_key":"***","secret_key":"***"}`},
		{"google-cloud-logging", `{"auth_config":{"client_email":"e","private_key":"S"}}`, `{"auth_config":{"client_email":"e","private_key":"***"}}`},
		{"ai-aliyun-content-moderation", `{"access_key_id":"i","access_key_secret":"S"}`, `{"access_key_id":"i","access_key_secret":"***"}`},
		{"sls-logger", `{"access_key_id":"i","access_key_secret":"S"}`, `{"access_key_id":"i","access_key_secret":"***"}`},
		{"tencent-cloud-cls", `{"secret_id":"i","secret_key":"S"}`, `{"secret_id":"i","secret_key":"***"}`},
		{"error-log-logger", `{"clickhouse":{"user":"u","password":"S"}}`, `{"clickhouse":{"user":"u","password":"***"}}`},
		{"http-logger", `{"uri":"http://l","auth_header":"S"}`, `{"uri":"http://l","auth_header":"***"}`},
		{"loggly", `{"customer_token":"S","severity":"INFO"}`, `{"customer_token":"***","severity":"INFO"}`},
		{"splunk-hec-logging", `{"endpoint":{"uri":"u","token":"S"}}`, `{"endpoint":{"uri":"u","token":"***"}}`},
		{"ai-proxy", `{"provider":"openai","auth":{"header":{"X-Custom":"S"}}}`, `{"provider":"openai","auth":"***"}`},
		{"ai-proxy-multi", `{"instances":[{"name":"a","auth":{"query":{"k":"S"}}}]}`, `{"instances":[{"name":"a","auth":"***"}]}`},
		{"ai-request-rewrite", `{"prompt":"p","auth":{"header":{"X-Custom":"S"}}}`, `{"prompt":"p","auth":"***"}`},
		{"aws-lambda", `{"function_uri":"f","authorization":{"iam":{"accesskey":"S","secretkey":"S"}}}`, `{"function_uri":"f","authorization":"***"}`},
		{"azure-functions", `{"function_uri":"f","authorization":{"apikey":"S"}}`, `{"function_uri":"f","authorization":"***"}`},
		{"openfunction", `{"function_uri":"f","authorization":{"service_token":"S"}}`, `{"function_uri":"f","authorization":"***"}`},
		{"limit-count", `{"key":"remote_addr","redis_password":"S"}`, `{"key":"remote_addr","redis_password":"***"}`},
		{"proxy-rewrite", `{"headers":{"set":{"Authorization":"S","X-Api-Key":"S","X-Trace":"t"}}}`, `{"headers":{"set":{"Authorization":"***","X-Api-Key":"***","X-Trace":"t"}}}`},
	}
	for _, tt := range tests {
		t.Run(tt.plugin, func(t *testing.T) {
			in := `{"value":{"plugins":{"` + tt.plugin + `":` + tt.in + `}}}`
			want := `{"value":{"plugins":{"` + tt.plugin + `":` + tt.want + `}}}`
			got, err := redactCredentials("routes", []byte(in))
			if err != nil {
				t.Fatalf("refused: %v", err)
			}
			if canon(t, string(got)) != canon(t, want) {
				t.Errorf("got  %s\nwant %s", got, canon(t, want))
			}
		})
	}
}

// The generic names, wherever they are and whatever the plugin.
func TestRedactCredentialsByName(t *testing.T) {
	for _, name := range []string{
		"secret", "client_secret", "x_secret", "secret_key", "password", "redis_password",
		"private_key", "tls_private_key", "client_key", "secret_access_key", "token",
		"session_token", "api_key", "apikey", "access_key", "aws_access_key",
		"Authorization", "proxy-authorization", "x-api-key", "api-key",
	} {
		in := `{"value":{"plugins":{"some-plugin":{"nested":{"` + name + `":"S"}}}}}`
		got, err := redactCredentials("routes", []byte(in))
		if err != nil || bytes.Contains(got, []byte(`"S"`)) {
			t.Errorf("%s kept: %s %v", name, got, err)
		}
	}
	for _, name := range []string{"key", "keys", "key_id", "access_key_id", "secret_id", "public_key", "token_endpoint", "username"} {
		in := `{"value":{"plugins":{"some-plugin":{"` + name + `":"S"}}}}`
		got, err := redactCredentials("routes", []byte(in))
		if err != nil || string(got) != in {
			t.Errorf("%s redacted: %s %v", name, got, err)
		}
	}
}

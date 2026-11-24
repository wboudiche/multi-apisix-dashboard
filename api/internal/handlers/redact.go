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
	"errors"
	"io"
	"strings"
)

// redactedMarker stands in for a credential a caller may read the resource of
// but not write (#463). Reading a route is not meant to be enough to act as
// its client: with an openid-connect client_secret or a consumer's key, a
// viewer could call the API the route protects.
const redactedMarker = "***"

// credentialField reports whether a field holds a credential by its name
// alone, wherever it is: the plugin settings of a route, service, consumer,
// credential, plugin config or global rule use these names, and so do the
// headers a plugin sets (proxy-rewrite's Authorization). Case and the dash of
// a header name do not count: X-Auth-Token reads as x_auth_token.
func credentialField(name string) bool {
	n := strings.ReplaceAll(strings.ToLower(name), "-", "_")
	switch n {
	case "secret", "client_secret", "password", "private_key", "client_key",
		// hmac-auth's, an AWS secret manager's. Not every secret_*: tencent's
		// secret_id is the identifier beside its secret_key.
		"secret_key", "secret_access_key",
		"token", "api_key", "apikey", "access_key", "x_api_key",
		"authorization", "cookie",
		// An upstream health check's headers, "Authorization: Bearer ..."
		// strings: whole, as a header's name is in its value.
		"req_headers":
		return true
	}
	return strings.HasSuffix(n, "_secret") ||
		strings.HasSuffix(n, "_private_key") ||
		strings.HasSuffix(n, "_password") ||
		strings.HasSuffix(n, "_token") ||
		strings.HasSuffix(n, "_access_key") ||
		// proxy-authorization, openid-connect's http_proxy_authorization.
		strings.HasSuffix(n, "_authorization")
}

// pluginCredentialPaths are where each plugin keeps its credentials, as paths
// inside the plugin's own object; an array on the way means each of its
// elements. A path names a credential the field names above may not: a bare
// "key" is limit-count's "remote_addr" as often as a key-auth key, and
// ai-proxy's "auth" holds headers of any name.
//
// The first group is APISIX 3.16's encrypt_fields, the fields it declares as
// secrets to encrypt at rest (read from apisix/plugins/*.lua of the
// apache/apisix:3.16.0 image). The second is credentials APISIX does not
// encrypt.
var pluginCredentialPaths = map[string][]string{
	"key-auth":   {"key"},
	"basic-auth": {"password"},
	"jwt-auth":   {"secret", "private_key"},
	"hmac-auth":  {"secret_key"},
	"openid-connect": {"client_secret", "client_rsa_private_key", "session.secret",
		"proxy_opts.http_proxy_authorization", "proxy_opts.https_proxy_authorization"},
	"authz-keycloak":               {"client_secret"},
	"authz-casdoor":                {"client_secret"},
	"csrf":                         {"key"},
	"jwe-decrypt":                  {"key", "secret"},
	"elasticsearch-logger":         {"auth.password"},
	"clickhouse-logger":            {"password"},
	"kafka-proxy":                  {"sasl.password"},
	"lago":                         {"token"},
	"openwhisk":                    {"service_token"},
	"rocketmq-logger":              {"secret_key"},
	"google-cloud-logging":         {"auth_config.private_key"},
	"ai-aliyun-content-moderation": {"access_key_secret"},
	"sls-logger":                   {"access_key_secret"},
	"tencent-cloud-cls":            {"secret_key"},
	"error-log-logger":             {"clickhouse.password"},

	"kafka-logger":       {"brokers.sasl_config.password"},
	"http-logger":        {"auth_header"},
	"loggly":             {"customer_token"},
	"splunk-hec-logging": {"endpoint.token"},
	"ai-proxy":           {"auth"},
	"ai-proxy-multi":     {"instances.auth"},
	"ai-request-rewrite": {"auth"},
	"aws-lambda":         {"authorization"},
	"azure-functions":    {"authorization"},
	"openfunction":       {"authorization"},
}

// resourceCredentialFields are the fields that are a credential only at the
// top of a resource of one type: an SSL's private keys, a vault's token.
// redactedTypes are the resource types whose answers hold data a reader may
// not act with. Not plugins: a plugin's schema names its credentials, as
// properties a form is built from, and holds none.
var redactedTypes = map[string]bool{
	"routes": true, "services": true, "upstreams": true, "consumers": true,
	"consumer_groups": true, "stream_routes": true, "plugin_configs": true,
	"global_rules": true, "ssls": true, "secrets": true, "plugin_metadata": true,
	"protos": true,
}

var resourceCredentialFields = map[string]map[string]bool{
	"ssls":    {"key": true, "keys": true},
	"secrets": {"token": true},
}

// redactPath replaces the credential at path inside node, through every
// element of an array on the way.
func redactPath(node any, path []string) bool {
	switch n := node.(type) {
	case []any:
		changed := false
		for _, el := range n {
			if redactPath(el, path) {
				changed = true
			}
		}
		return changed
	case map[string]any:
		if len(path) > 1 {
			return redactPath(n[path[0]], path[1:])
		}
		if filled(n[path[0]]) {
			n[path[0]] = redactedMarker
			return true
		}
	}
	return false
}

// filled reports whether v holds something to hide: a null or an empty value
// says only that nothing is set, which the form shows as such.
func filled(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return t != ""
	case []any:
		return len(t) > 0
	case map[string]any:
		return len(t) > 0
	}
	return true
}

// redactTree replaces, in place and at any depth, the value of every
// credential field by redactedMarker. here are the fields that are a
// credential in this object only (see resourceCredentialFields); plugins says
// the object is a plugins map, each field of which is a plugin's settings
// (see pluginCredentialPaths). A field matched whole is replaced whole,
// whatever its type. It reports whether anything changed.
func redactTree(v any, here map[string]bool, plugins bool) bool {
	changed := false
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			if (credentialField(k) || here[k]) && filled(child) {
				t[k] = redactedMarker
				changed = true
				continue
			}
			if plugins {
				for _, path := range pluginCredentialPaths[k] {
					if redactPath(child, strings.Split(path, ".")) {
						changed = true
					}
				}
			}
			if redactTree(child, nil, k == "plugins") {
				changed = true
			}
		}
	case []any:
		for _, child := range t {
			if redactTree(child, nil, false) {
				changed = true
			}
		}
	}
	return changed
}

// redactRow redacts one resource as the Admin API answers it: a detail
// {key, value} or a list row of the same shape, whose value is the resource
// itself. The row's own "key" is the etcd key, not an SSL's private key, so
// the fields that are a credential at the top of a resource apply to the
// value only.
func redactRow(resourceType string, row any) bool {
	m, ok := row.(map[string]any)
	if !ok {
		return redactTree(row, nil, false)
	}
	if value, ok := m["value"].(map[string]any); ok {
		changed := redactTree(value, resourceCredentialFields[resourceType], false)
		for k, child := range m {
			if k != "value" && redactTree(child, nil, false) {
				changed = true
			}
		}
		return changed
	}
	return redactTree(m, resourceCredentialFields[resourceType], false)
}

// redactValue redacts a decoded Admin API answer: a list {total, list} or a
// single resource.
func redactValue(resourceType string, v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return redactTree(v, nil, false)
	}
	list, ok := m["list"].([]any)
	if !ok {
		return redactRow(resourceType, m)
	}
	changed := false
	for _, row := range list {
		if redactRow(resourceType, row) {
			changed = true
		}
	}
	return changed
}

// errUnreadable is an answer redactCredentials cannot read, and so cannot
// tell free of credentials.
var errUnreadable = errors.New("the gateway's answer could not be read")

// redactCredentials answers body with every credential replaced by
// redactedMarker, for a caller who may read the resource but not write it.
// One with nothing to hide, or nothing at all, comes back byte for byte. One
// that is not one JSON value is refused with errUnreadable rather than passed
// through: what it holds cannot be told, so it is not for this caller.
func redactCredentials(resourceType string, body []byte) ([]byte, error) {
	if len(bytes.TrimSpace(body)) == 0 {
		return body, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	// Numbers as written: a float64 would turn an id beyond 2^53 into its
	// neighbour (see injectTeamID).
	decoder.UseNumber()
	var v any
	if err := decoder.Decode(&v); err != nil {
		return nil, errUnreadable
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errUnreadable
	}
	if !redactValue(resourceType, v) {
		return body, nil
	}
	out, err := json.Marshal(v)
	if err != nil {
		return nil, errUnreadable
	}
	return out, nil
}

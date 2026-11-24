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
// credential, plugin config or global rule all use these names.
func credentialField(name string) bool {
	switch name {
	case "secret", "client_secret", "password", "private_key", "client_key", "secret_access_key":
		return true
	}
	return strings.HasSuffix(name, "_secret") ||
		strings.HasSuffix(name, "_private_key") ||
		strings.HasSuffix(name, "_password") ||
		// hmac-auth's secret_key, an AWS secret manager's secret_access_key.
		strings.HasPrefix(name, "secret_")
}

// pluginCredentialFields are the fields that are a credential only inside one
// plugin: a bare "key" is limit-count's "remote_addr" as often as a key-auth
// key.
var pluginCredentialFields = map[string]map[string]bool{
	"key-auth": {"key": true},
}

// resourceCredentialFields are the fields that are a credential only at the
// top of a resource of one type: an SSL's private keys, a vault's token.
var resourceCredentialFields = map[string]map[string]bool{
	"ssls":    {"key": true, "keys": true},
	"secrets": {"token": true},
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
// credential field by redactedMarker. here are the fields that are a credential
// in this object only (see pluginCredentialFields). A field matched whole is
// replaced whole, whatever its type. It reports whether anything changed.
func redactTree(v any, here map[string]bool) bool {
	changed := false
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			if (credentialField(k) || here[k]) && filled(child) {
				t[k] = redactedMarker
				changed = true
				continue
			}
			if redactTree(child, pluginCredentialFields[k]) {
				changed = true
			}
		}
	case []any:
		for _, child := range t {
			if redactTree(child, nil) {
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
		return redactTree(row, nil)
	}
	if value, ok := m["value"].(map[string]any); ok {
		changed := redactTree(value, resourceCredentialFields[resourceType])
		for k, child := range m {
			if k != "value" && redactTree(child, nil) {
				changed = true
			}
		}
		return changed
	}
	return redactTree(m, resourceCredentialFields[resourceType])
}

// redactValue redacts a decoded Admin API answer: a list {total, list} or a
// single resource.
func redactValue(resourceType string, v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return redactTree(v, nil)
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

// redactCredentials answers body with every credential replaced by
// redactedMarker, for a caller who may read the resource but not write it.
// A body that is not one JSON value is passed through, as is one with
// nothing to hide - byte for byte, so the answer only changes when a
// credential had to go.
func redactCredentials(resourceType string, body []byte) []byte {
	decoder := json.NewDecoder(bytes.NewReader(body))
	// Numbers as written: a float64 would turn an id beyond 2^53 into its
	// neighbour (see injectTeamID).
	decoder.UseNumber()
	var v any
	if err := decoder.Decode(&v); err != nil {
		return body
	}
	if _, err := decoder.Token(); err != io.EOF {
		return body
	}
	if !redactValue(resourceType, v) {
		return body
	}
	out, err := json.Marshal(v)
	if err != nil {
		return body
	}
	return out
}

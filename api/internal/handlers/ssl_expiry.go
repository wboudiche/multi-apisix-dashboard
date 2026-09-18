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
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"time"
)

// dashboardCertNotAfterField and dashboardCertIssuerField carry what a
// certificate says about itself, for the SSL list to show.
//
// APISIX stores the PEM and nothing else: its SSL object is cert, key, snis
// and the timestamps of the write. So "expires in 12 days" is not a field to
// read, it is the certificate parsed - which the browser cannot do without a
// dependency, and which crypto/x509 does here in a few lines (#145).
//
// Prefixed like every other dashboard-added field, so stripDashboardFields
// takes them back out of anything a client sends us.
const (
	dashboardCertNotAfterField = dashboardFieldPrefix + "cert_not_after"
	dashboardCertIssuerField   = dashboardFieldPrefix + "cert_issuer"
)

// annotateCertificate adds a certificate's expiry and issuer to an SSL list
// row's value.
//
// Silent on anything it cannot read: a value with no cert, a PEM that does not
// decode, a certificate that does not parse. The list is about the gateway's
// SSLs, and one unreadable entry is not a reason to fail the page - the column
// simply has nothing to say about that row.
func annotateCertificate(val map[string]interface{}) {
	cert, ok := val["cert"].(string)
	if !ok || cert == "" {
		return
	}

	// The first CERTIFICATE block, not the first block: what APISIX stores can
	// carry a chain, and a key pasted in front of it decodes as a PEM block
	// that is not a certificate at all. Anything after the leaf is its issuers,
	// which outlive it and would read as years of comfort.
	rest := []byte(cert)
	var parsed *x509.Certificate
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			return
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		var err error
		parsed, err = x509.ParseCertificate(block.Bytes)
		if err != nil {
			return
		}
		break
	}

	// RFC 3339 in UTC: a timestamp the browser can read without knowing what
	// the server's locale is.
	val[dashboardCertNotAfterField] = parsed.NotAfter.UTC().Format(time.RFC3339)
	if issuer := parsed.Issuer.CommonName; issuer != "" {
		val[dashboardCertIssuerField] = issuer
	}
}

// annotateCertificateList adds the expiry to every row of an SSL list
// response.
//
// The body is returned unchanged if it is not the list shape this expects:
// APISIX's answer is the answer, and a list the dashboard could not annotate is
// still a list the operator asked for.
func annotateCertificateList(body []byte) []byte {
	// Into a map rather than a struct, and with UseNumber, for the two reasons
	// stripDashboardFields gives: a field this does not know about is APISIX's
	// to keep, and re-marshalling a float64 rewrites an id beyond 2^53 to a
	// neighbouring value.
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var payload map[string]interface{}
	if err := decoder.Decode(&payload); err != nil {
		return body
	}

	rows, ok := payload["list"].([]interface{})
	if !ok {
		return body
	}

	for _, row := range rows {
		item, ok := row.(map[string]interface{})
		if !ok {
			continue
		}
		if val, ok := item["value"].(map[string]interface{}); ok {
			annotateCertificate(val)
		}
	}

	annotated, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return annotated
}

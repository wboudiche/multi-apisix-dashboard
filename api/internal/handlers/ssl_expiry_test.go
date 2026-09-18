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
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"strings"
	"testing"
	"time"
)

// selfSigned builds a certificate expiring at `notAfter`, PEM-encoded as APISIX
// stores it.
func selfSigned(t *testing.T, issuer string, notAfter time.Time) string {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating a key: %v", err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "example.test"},
		NotBefore:    notAfter.Add(-24 * time.Hour),
		NotAfter:     notAfter,
	}
	// x509 takes the issuer from the signing certificate's subject, not from
	// the template's Issuer field - which is why this signs with a parent.
	parent := x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: issuer},
		NotBefore:    template.NotBefore,
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &parent, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("creating a certificate: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

// What the SSL list can say about a certificate, given that APISIX stores the
// PEM and nothing else.
func TestCertificateAnnotation(t *testing.T) {
	expiry := time.Date(2030, 5, 21, 12, 0, 0, 0, time.UTC)

	t.Run("reads the expiry a certificate carries", func(t *testing.T) {
		val := map[string]interface{}{"cert": selfSigned(t, "Test CA", expiry)}
		annotateCertificate(val)

		if got := val[dashboardCertNotAfterField]; got != "2030-05-21T12:00:00Z" {
			t.Errorf("%s = %v, want 2030-05-21T12:00:00Z", dashboardCertNotAfterField, got)
		}
		if got := val[dashboardCertIssuerField]; got != "Test CA" {
			t.Errorf("%s = %v, want Test CA", dashboardCertIssuerField, got)
		}
	})

	// A self-signed certificate is its own issuer, which is worth showing as
	// such rather than as nothing.
	t.Run("keeps a self-signed certificate's own name as its issuer", func(t *testing.T) {
		val := map[string]interface{}{"cert": selfSigned(t, "example.test", expiry)}
		annotateCertificate(val)

		if got := val[dashboardCertIssuerField]; got != "example.test" {
			t.Errorf("%s = %v, want example.test", dashboardCertIssuerField, got)
		}
	})

	// One unreadable row is not a reason to fail a page: the column has
	// nothing to say about it, and the rest of the list is unaffected.
	for _, tt := range []struct {
		name string
		val  map[string]interface{}
	}{
		{"no cert at all", map[string]interface{}{"id": "ssl-1"}},
		{"an empty cert", map[string]interface{}{"cert": ""}},
		{"something that is not PEM", map[string]interface{}{"cert": "not a certificate"}},
		{"PEM that is not a certificate", map[string]interface{}{
			"cert": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte("nonsense")})),
		}},
		{"a cert that is not a string", map[string]interface{}{"cert": 42}},
	} {
		t.Run("says nothing about "+tt.name, func(t *testing.T) {
			annotateCertificate(tt.val)

			if _, ok := tt.val[dashboardCertNotAfterField]; ok {
				t.Errorf("%s was set for %s", dashboardCertNotAfterField, tt.name)
			}
			if _, ok := tt.val[dashboardCertIssuerField]; ok {
				t.Errorf("%s was set for %s", dashboardCertIssuerField, tt.name)
			}
		})
	}
}

// A list response keeps everything it came with: this walks the rows it knows
// about and leaves the rest of the body alone.
func TestCertificateListAnnotationKeepsTheRestOfTheBody(t *testing.T) {
	cert := selfSigned(t, "Test CA", time.Date(2030, 5, 21, 12, 0, 0, 0, time.UTC))
	body := []byte(`{"list":[{"value":{"id":"ssl-1","cert":` +
		mustJSON(t, cert) + `}}],"total":1,"__warning":"held"}`)

	annotated := string(annotateCertificateList(body))

	for _, want := range []string{
		`"__warning":"held"`,
		`"total":1`,
		`"` + dashboardCertNotAfterField + `":"2030-05-21T12:00:00Z"`,
	} {
		if !strings.Contains(annotated, want) {
			t.Errorf("annotated body lost %s: %s", want, annotated)
		}
	}
}

// Bodies that are not the list this walks are returned untouched: an answer
// the dashboard could not annotate is still the answer APISIX gave.
func TestCertificateListAnnotationLeavesOtherBodiesAlone(t *testing.T) {
	for _, body := range []string{
		`{"total":0}`,
		`{"value":{"id":"ssl-1"}}`,
		`[]`,
		`not json at all`,
		`{"list":"not a list"}`,
	} {
		if got := string(annotateCertificateList([]byte(body))); got != body {
			t.Errorf("annotateCertificateList(%s) = %s, want it unchanged", body, got)
		}
	}
}

// A chain, or a key pasted in front of the certificate: the leaf is what the
// list is about, and the issuers that follow it outlive it.
func TestCertificateAnnotationReadsTheLeafOfAChain(t *testing.T) {
	leaf := selfSigned(t, "Test CA", time.Date(2027, 1, 2, 3, 4, 5, 0, time.UTC))
	ca := selfSigned(t, "Root", time.Date(2040, 1, 2, 3, 4, 5, 0, time.UTC))
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte("not a key")}))

	for name, cert := range map[string]string{
		"leaf then issuer": leaf + ca,
		"key then leaf":    key + leaf,
	} {
		t.Run(name, func(t *testing.T) {
			val := map[string]interface{}{"cert": cert}
			annotateCertificate(val)

			if got := val[dashboardCertNotAfterField]; got != "2027-01-02T03:04:05Z" {
				t.Errorf("%s = %v, want the leaf's expiry", dashboardCertNotAfterField, got)
			}
		})
	}
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encoding: %v", err)
	}
	return string(encoded)
}

// The fields are dashboard-added, so they must carry the prefix that gets them
// stripped back out of anything a client sends us - APISIX rejects unknown
// properties.
func TestCertificateFieldsAreStrippable(t *testing.T) {
	body := []byte(`{"cert":"x","` + dashboardCertNotAfterField + `":"2030-05-21T12:00:00Z","` +
		dashboardCertIssuerField + `":"Test CA"}`)

	stripped := string(stripDashboardFields(body))
	for _, field := range []string{dashboardCertNotAfterField, dashboardCertIssuerField} {
		if strings.Contains(stripped, field) {
			t.Errorf("%s survived stripDashboardFields: %s", field, stripped)
		}
	}
}

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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseWsdlImportLocations(t *testing.T) {
	xml := []byte(`<definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
	  <wsdl:import location="abstract.wsdl"/>
	  <xsd:import schemaLocation="types.xsd"/>
	  <wsdl:import location="http://example.com/other.wsdl"/>
	</definitions>`)
	got := parseWsdlImportLocations(xml)
	if len(got) != 2 || got[0] != "abstract.wsdl" || got[1] != "http://example.com/other.wsdl" {
		t.Fatalf("unexpected locations: %#v", got)
	}
}

func TestFetchRejectsBlockedHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewWsdlHandler()
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url=http://169.254.169.254/latest", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway && w.Code != http.StatusBadRequest {
		t.Fatalf("expected blocked host to fail, got %d", w.Code)
	}
}

func TestFetchRejectsBadScheme(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewWsdlHandler()
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url=file:///etc/passwd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for file scheme, got %d", w.Code)
	}
}

func TestFetchRecursiveHappyPath(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mux := http.NewServeMux()
	mux.HandleFunc("/service.wsdl", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"><wsdl:import location="abstract.wsdl"/></definitions>`))
	})
	mux.HandleFunc("/abstract.wsdl", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<definitions/>`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Test-only handler whose client trusts the loopback test server.
	h := newWsdlHandlerWithClient(srv.Client())
	r := gin.New()
	r.GET("/fetch", h.Fetch)

	req := httptest.NewRequest(http.MethodGet, "/fetch?url="+srv.URL+"/service.wsdl", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Entry string            `json:"entry"`
		Docs  map[string]string `json:"docs"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Docs) != 2 {
		t.Fatalf("expected 2 docs, got %d", len(resp.Docs))
	}
	if !strings.Contains(resp.Docs[resp.Entry], "wsdl:import") {
		t.Fatalf("entry doc missing")
	}
}

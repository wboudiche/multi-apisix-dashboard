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

package services

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// One client now serves every request of a connection: these pin how its
// token is shared between concurrent callers.

func TestKeycloakConcurrentCallersShareOneTokenFetch(t *testing.T) {
	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			atomic.AddInt32(&tokens, 1)
			time.Sleep(100 * time.Millisecond)
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client())
	var wg sync.WaitGroup
	errs := make([]error, 10)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = c.DeleteClient(context.Background(), "a")
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := atomic.LoadInt32(&tokens); n != 1 {
		t.Fatalf("token requests=%d", n)
	}
}

func TestKeycloakWaiterHonoursItsContext(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			<-release
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	defer close(release)
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client())

	// A first caller starts the fetch and hangs on it.
	go func() { _ = c.DeleteClient(context.Background(), "a") }()
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := c.DeleteClient(ctx, "b")
	if !errors.Is(err, ErrKeycloakUnavailable) {
		t.Fatalf("err=%v", err)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("waited %v past its deadline", waited)
	}
}

func TestKeycloakTokenFailureIsSharedForAWhile(t *testing.T) {
	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokens, 1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_client"}`))
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).(*keycloakClient)
	now := time.Now()
	var mu sync.Mutex
	c.now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	for i := 0; i < 3; i++ {
		if err := c.TestAccess(context.Background()); !errors.Is(err, ErrKeycloakAuth) {
			t.Fatalf("call %d: err=%v", i, err)
		}
	}
	if n := atomic.LoadInt32(&tokens); n != 1 {
		t.Fatalf("token requests inside the window=%d", n)
	}
	mu.Lock()
	now = now.Add(tokenFailureTTL + time.Second)
	mu.Unlock()
	_ = c.TestAccess(context.Background())
	if n := atomic.LoadInt32(&tokens); n != 2 {
		t.Fatalf("token requests after the window=%d", n)
	}
}

func TestKeycloak401KeepsATokenAnotherCallerReplaced(t *testing.T) {
	var tokens int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			atomic.AddInt32(&tokens, 1)
			_, _ = w.Write([]byte(`{"access_token":"tok-new","expires_in":300}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c := NewKeycloakClient(kcProvider(srv.URL), srv.Client()).(*keycloakClient)
	// Another caller already replaced the token this one saw rejected.
	c.token, c.expiry = "tok-new", time.Now().Add(time.Hour)
	tok, err := c.bearer(context.Background(), "tok-old")
	if err != nil || tok != "tok-new" {
		t.Fatalf("tok=%q err=%v", tok, err)
	}
	if n := atomic.LoadInt32(&tokens); n != 0 {
		t.Fatalf("refetched a token already replaced (%d requests)", n)
	}
	// The rejected token itself is refetched.
	c.token = "tok-old"
	if tok, err := c.bearer(context.Background(), "tok-old"); err != nil || tok != "tok-new" {
		t.Fatalf("tok=%q err=%v", tok, err)
	}
	if n := atomic.LoadInt32(&tokens); n != 1 {
		t.Fatalf("token requests=%d", n)
	}
}

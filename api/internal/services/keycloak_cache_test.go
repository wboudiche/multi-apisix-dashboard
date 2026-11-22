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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// builtKC is a KeycloakAPI told apart by the number it was built with.
type builtKC struct {
	KeycloakAPI
	n int64
}

func TestKeycloakClientsReuseUntilUpdated(t *testing.T) {
	var built atomic.Int64
	cache := NewKeycloakClients(func(*models.IdentityProvider) KeycloakAPI {
		return &builtKC{n: built.Add(1)}
	})
	t0 := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	p := &models.IdentityProvider{ID: "a", UpdatedAt: models.NullTime(t0)}

	first := cache.For(p)
	again := *p // a fresh read of the same record
	if cache.For(&again) != first || built.Load() != 1 {
		t.Fatalf("same (id, updated_at) built %d clients", built.Load())
	}

	updated := *p
	updated.UpdatedAt = models.NullTime(t0.Add(time.Second))
	second := cache.For(&updated)
	if second == first || built.Load() != 2 {
		t.Fatalf("an update kept the old client (built %d)", built.Load())
	}
	if cache.For(&updated) != second || built.Load() != 2 {
		t.Fatalf("the updated client was not kept (built %d)", built.Load())
	}

	other := &models.IdentityProvider{ID: "b", UpdatedAt: models.NullTime(t0)}
	if cache.For(other) == second || built.Load() != 3 {
		t.Fatalf("another connection shared a client (built %d)", built.Load())
	}
}

func TestKeycloakClientsConcurrent(t *testing.T) {
	var built atomic.Int64
	cache := NewKeycloakClients(func(*models.IdentityProvider) KeycloakAPI {
		return &builtKC{n: built.Add(1)}
	})
	p := &models.IdentityProvider{ID: "a", UpdatedAt: models.NullTime(time.Unix(1, 0))}
	var wg sync.WaitGroup
	got := make([]KeycloakAPI, 32)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cp := *p
			got[i] = cache.For(&cp)
		}(i)
	}
	wg.Wait()
	if built.Load() != 1 {
		t.Fatalf("built %d clients for one connection", built.Load())
	}
	for _, c := range got {
		if c != got[0] {
			t.Fatal("callers got different clients")
		}
	}
}

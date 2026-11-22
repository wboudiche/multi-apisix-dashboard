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
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// KeycloakClients keeps one Keycloak client per connection, so the service
// account token a client caches serves every request until it expires,
// instead of each request fetching its own. A client is rebuilt when the
// connection's updated_at changes: every update of the connection - its
// address, realm, admin client or secret - sets it. Safe for concurrent use.
//
// A deleted connection's client stays until the process restarts; there is
// one per connection ever made, and nothing reaches it once the connection is
// gone, since a client is only looked up through a connection read from etcd.
type KeycloakClients struct {
	build func(*models.IdentityProvider) KeycloakAPI

	mu      sync.Mutex
	clients map[string]cachedKeycloak
}

type cachedKeycloak struct {
	updatedAt time.Time
	client    KeycloakAPI
}

// NewKeycloakClients returns a cache that builds clients with build.
func NewKeycloakClients(build func(*models.IdentityProvider) KeycloakAPI) *KeycloakClients {
	return &KeycloakClients{build: build, clients: map[string]cachedKeycloak{}}
}

// For returns the client of the connection as it stands.
func (k *KeycloakClients) For(p *models.IdentityProvider) KeycloakAPI {
	updatedAt := time.Time(p.UpdatedAt)
	k.mu.Lock()
	defer k.mu.Unlock()
	if c, ok := k.clients[p.ID]; ok && c.updatedAt.Equal(updatedAt) {
		return c.client
	}
	client := k.build(p)
	k.clients[p.ID] = cachedKeycloak{updatedAt: updatedAt, client: client}
	return client
}

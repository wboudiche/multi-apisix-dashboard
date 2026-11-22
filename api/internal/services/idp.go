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
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// kvStore is the slice of EtcdClient the identity provider store uses, so a
// test can stand in for etcd.
type kvStore interface {
	GetJSON(ctx context.Context, key string, dest interface{}) error
	PutJSON(ctx context.Context, key string, value interface{}) error
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) (map[string][]byte, error)
}

var (
	ErrIdPNotFound   = errors.New("identity provider not found")
	ErrIdPInvalid    = errors.New("invalid identity provider")
	ErrIdPLocked     = errors.New("identity provider is locked")
	ErrIdPHasClients = errors.New("identity provider still has clients")
)

// maxRedirectDomains caps the redirect domains of one connection.
const maxRedirectDomains = 20

// redirectDomainPattern: lowercase DNS labels of letters, digits and dashes
// (not at either end), separated by single dots.
var redirectDomainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$`)

var idpPrefixPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// IdPUpdate is a partial update: a nil field is left as stored. A nil or empty
// AdminClientSecret keeps the stored secret.
type IdPUpdate struct {
	Name                *string
	BaseURL             *string
	Realm               *string
	AdminClientID       *string
	AdminClientSecret   *string
	ClientIDPrefix      *string
	InstanceIDs         *[]string
	DevelopersCanCreate *bool
	RedirectDomains     *[]string
}

// IdPService stores Keycloak connections and the registry of clients created
// through them.
type IdPService struct {
	store kvStore
}

func NewIdPService(store kvStore) *IdPService {
	return &IdPService{store: store}
}

// validateIdP checks a connection. Its messages never include the secret.
func validateIdP(p *models.IdentityProvider) error {
	invalid := func(reason string) error { return fmt.Errorf("%w: %s", ErrIdPInvalid, reason) }
	if p.Type != models.IdPTypeKeycloak {
		return invalid("type must be keycloak")
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return invalid("base_url must be an absolute http(s) URL")
	}
	if strings.HasPrefix(strings.TrimRight(u.Path, "/"), "/realms") {
		return invalid("base_url must be the server root, without /realms/<realm>")
	}
	if strings.TrimSpace(p.Realm) == "" {
		return invalid("realm is required")
	}
	if strings.TrimSpace(p.AdminClientID) == "" {
		return invalid("admin_client_id is required")
	}
	if p.AdminClientSecret == "" {
		return invalid("admin_client_secret is required")
	}
	if !idpPrefixPattern.MatchString(p.ClientIDPrefix) {
		return invalid("client_id_prefix must be 1 to 32 lowercase letters, digits or dashes, starting with a letter or digit")
	}
	if len(p.RedirectDomains) > maxRedirectDomains {
		return invalid(fmt.Sprintf("at most %d redirect domains", maxRedirectDomains))
	}
	for _, d := range p.RedirectDomains {
		if len(d) > 253 || !redirectDomainPattern.MatchString(d) {
			return invalid("redirect_domains must be lowercase DNS names, without scheme, port, wildcard or leading dot")
		}
		// An all-digit last label ("1", "0.1") could stand for an IP address.
		if last := d[strings.LastIndex(d, ".")+1:]; strings.Trim(last, "0123456789") == "" {
			return invalid("the last label of a redirect domain cannot be all digits")
		}
	}
	return nil
}

// Create validates and stores a new connection, setting its ID, type and dates.
func (s *IdPService) Create(ctx context.Context, p *models.IdentityProvider) error {
	if p.Type == "" {
		p.Type = models.IdPTypeKeycloak
	}
	if err := validateIdP(p); err != nil {
		return err
	}
	now := models.NullTime(time.Now())
	p.ID = uuid.New().String()
	p.CreatedAt = now
	p.UpdatedAt = now
	return s.store.PutJSON(ctx, models.KeyPrefixIdPs+p.ID, p)
}

// Get returns one connection, or ErrIdPNotFound.
func (s *IdPService) Get(ctx context.Context, id string) (*models.IdentityProvider, error) {
	var p models.IdentityProvider
	if err := s.store.GetJSON(ctx, models.KeyPrefixIdPs+id, &p); err != nil {
		return nil, err
	}
	if p.ID == "" { // EtcdClient.GetJSON leaves dest empty for a missing key
		return nil, ErrIdPNotFound
	}
	return &p, nil
}

func (s *IdPService) List(ctx context.Context) ([]*models.IdentityProvider, error) {
	entries, err := s.store.List(ctx, models.KeyPrefixIdPs)
	if err != nil {
		return nil, err
	}
	out := make([]*models.IdentityProvider, 0, len(entries))
	for _, raw := range entries {
		var p models.IdentityProvider
		if err := json.Unmarshal(raw, &p); err != nil {
			continue
		}
		out = append(out, &p)
	}
	return out, nil
}

// ForInstance returns the connections linked to an instance.
func (s *IdPService) ForInstance(ctx context.Context, instanceID string) ([]*models.IdentityProvider, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	out := []*models.IdentityProvider{}
	for _, p := range all {
		if p.LinkedTo(instanceID) {
			out = append(out, p)
		}
	}
	return out, nil
}

// Update applies a partial update. Once clients exist for the connection, what
// locates them (base URL, realm, prefix) and the instances that have some are
// frozen.
func (s *IdPService) Update(ctx context.Context, id string, u IdPUpdate) (*models.IdentityProvider, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	before := *p

	if u.Name != nil {
		p.Name = *u.Name
	}
	if u.BaseURL != nil {
		p.BaseURL = *u.BaseURL
	}
	if u.Realm != nil {
		p.Realm = *u.Realm
	}
	if u.AdminClientID != nil {
		p.AdminClientID = *u.AdminClientID
	}
	if u.AdminClientSecret != nil && *u.AdminClientSecret != "" {
		p.AdminClientSecret = *u.AdminClientSecret
	}
	if u.ClientIDPrefix != nil {
		p.ClientIDPrefix = *u.ClientIDPrefix
	}
	if u.InstanceIDs != nil {
		p.InstanceIDs = *u.InstanceIDs
	}
	if u.DevelopersCanCreate != nil {
		p.DevelopersCanCreate = *u.DevelopersCanCreate
	}
	if u.RedirectDomains != nil {
		p.RedirectDomains = *u.RedirectDomains
	}
	if err := validateIdP(p); err != nil {
		return nil, err
	}

	locating := p.BaseURL != before.BaseURL || p.Realm != before.Realm || p.ClientIDPrefix != before.ClientIDPrefix
	dropped := false
	for _, inst := range before.InstanceIDs {
		if !p.LinkedTo(inst) {
			dropped = true
		}
	}
	if locating || dropped {
		entries, err := s.clientsOf(ctx, id)
		if err != nil {
			return nil, err
		}
		depend := 0
		for _, c := range entries {
			if locating || !p.LinkedTo(c.InstanceID) {
				depend++
			}
		}
		if depend > 0 {
			return nil, fmt.Errorf("%w: %d clients depend on it", ErrIdPLocked, depend)
		}
	}

	// The stored secret must not follow the connection to a new destination:
	// whoever repoints it has to enter the secret again.
	destinationChanged := p.BaseURL != before.BaseURL || p.Realm != before.Realm || p.AdminClientID != before.AdminClientID
	if destinationChanged && (u.AdminClientSecret == nil || *u.AdminClientSecret == "") {
		return nil, fmt.Errorf("%w: the secret must be entered again when the URL, realm or admin client changes", ErrIdPInvalid)
	}

	p.UpdatedAt = models.NullTime(time.Now())
	if err := s.store.PutJSON(ctx, models.KeyPrefixIdPs+id, p); err != nil {
		return nil, err
	}
	return p, nil
}

// Delete removes a connection. With registry entries it needs force, which also
// removes the entries (never the Keycloak clients themselves).
func (s *IdPService) Delete(ctx context.Context, id string, force bool) error {
	if _, err := s.Get(ctx, id); err != nil {
		return err
	}
	entries, err := s.clientsOf(ctx, id)
	if err != nil {
		return err
	}
	if len(entries) > 0 && !force {
		return fmt.Errorf("%w: %d clients depend on it", ErrIdPHasClients, len(entries))
	}
	for _, c := range entries {
		if err := s.store.Delete(ctx, models.IdPClientKey(id, c.KeycloakUUID)); err != nil {
			return err
		}
	}
	return s.store.Delete(ctx, models.KeyPrefixIdPs+id)
}

// RecordClient stores a registry entry for a client just created in Keycloak.
func (s *IdPService) RecordClient(ctx context.Context, c *models.IdPClient) error {
	if c.CreatedAt.IsZero() {
		c.CreatedAt = models.NullTime(time.Now())
	}
	return s.store.PutJSON(ctx, models.IdPClientKey(c.IdPID, c.KeycloakUUID), c)
}

// ListClients returns the registry entries of an instance, or all of them when
// instanceID is empty.
func (s *IdPService) ListClients(ctx context.Context, instanceID string) ([]*models.IdPClient, error) {
	out, err := s.readClients(ctx, models.KeyPrefixIdPClients)
	if err != nil || instanceID == "" {
		return out, err
	}
	kept := out[:0]
	for _, c := range out {
		if c.InstanceID == instanceID {
			kept = append(kept, c)
		}
	}
	return kept, nil
}

// FindClient returns the entry of a Keycloak client UUID on an instance, or
// ErrIdPNotFound when the dashboard did not create it for that instance.
func (s *IdPService) FindClient(ctx context.Context, instanceID, uuid string) (*models.IdPClient, error) {
	entries, err := s.ListClients(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	for _, c := range entries {
		if c.KeycloakUUID == uuid {
			return c, nil
		}
	}
	return nil, ErrIdPNotFound
}

// DetachRoute clears the route create time of every entry of an instance made
// for the route, once the route is deleted: a route later created under the
// same id, even within the same second, then inherits nothing. The entries keep
// their route id, and are admin-only from then on. It returns how many changed.
func (s *IdPService) DetachRoute(ctx context.Context, instanceID, routeID string) (int, error) {
	entries, err := s.ListClients(ctx, instanceID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, c := range entries {
		if c.RouteID != routeID || c.RouteCreateTime == 0 {
			continue
		}
		c.RouteCreateTime = 0
		if err := s.store.PutJSON(ctx, models.IdPClientKey(c.IdPID, c.KeycloakUUID), c); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// ForgetInstance drops what the connections hold of an instance that was
// deleted: the registry entries of its clients, which nothing could remove
// any more (deleting a client needs an active instance), and its link to every
// connection, which those entries would otherwise lock. The Keycloak clients
// themselves are left in Keycloak; their client ids are logged so an operator
// can remove them there. It returns how many entries were dropped.
func (s *IdPService) ForgetInstance(ctx context.Context, instanceID string) (int, error) {
	entries, err := s.ListClients(ctx, instanceID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, c := range entries {
		if err := s.store.Delete(ctx, models.IdPClientKey(c.IdPID, c.KeycloakUUID)); err != nil {
			return n, err
		}
		n++
		log.Printf("[idp] instance %s was deleted: client %s is no longer tracked and stays in Keycloak",
			instanceID, c.ClientID)
	}
	linked, err := s.ForInstance(ctx, instanceID)
	if err != nil {
		return n, err
	}
	for _, p := range linked {
		kept := make([]string, 0, len(p.InstanceIDs))
		for _, id := range p.InstanceIDs {
			if id != instanceID {
				kept = append(kept, id)
			}
		}
		p.InstanceIDs = kept
		p.UpdatedAt = models.NullTime(time.Now())
		if err := s.store.PutJSON(ctx, models.KeyPrefixIdPs+p.ID, p); err != nil {
			return n, err
		}
	}
	return n, nil
}

func (s *IdPService) DeleteClient(ctx context.Context, c *models.IdPClient) error {
	return s.store.Delete(ctx, models.IdPClientKey(c.IdPID, c.KeycloakUUID))
}

// clientsOf returns the registry entries of one connection.
func (s *IdPService) clientsOf(ctx context.Context, idpID string) ([]*models.IdPClient, error) {
	return s.readClients(ctx, models.KeyPrefixIdPClients+idpID+"/")
}

func (s *IdPService) readClients(ctx context.Context, prefix string) ([]*models.IdPClient, error) {
	entries, err := s.store.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	out := make([]*models.IdPClient, 0, len(entries))
	for _, raw := range entries {
		var c models.IdPClient
		if err := json.Unmarshal(raw, &c); err != nil {
			continue
		}
		out = append(out, &c)
	}
	return out, nil
}

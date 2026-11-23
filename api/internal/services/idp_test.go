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
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// fakeKV is an in-memory kvStore. Like EtcdClient, GetJSON leaves dest untouched
// for a missing key. failPut makes every PutJSON fail.
type fakeKV struct {
	data    map[string][]byte
	failPut bool
}

func newFakeKV() *fakeKV { return &fakeKV{data: map[string][]byte{}} }

func (f *fakeKV) GetJSON(_ context.Context, key string, dest interface{}) error {
	v, ok := f.data[key]
	if !ok {
		return nil
	}
	return json.Unmarshal(v, dest)
}

func (f *fakeKV) PutJSON(_ context.Context, key string, value interface{}) error {
	if f.failPut {
		return errors.New("put failed")
	}
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f.data[key] = b
	return nil
}

func (f *fakeKV) Delete(_ context.Context, key string) error {
	delete(f.data, key)
	return nil
}

func (f *fakeKV) List(_ context.Context, prefix string) (map[string][]byte, error) {
	out := map[string][]byte{}
	for k, v := range f.data {
		if strings.HasPrefix(k, prefix) {
			out[k] = v
		}
	}
	return out, nil
}

func validIdP() *models.IdentityProvider {
	return &models.IdentityProvider{
		Name:              "corp",
		Type:              models.IdPTypeKeycloak,
		BaseURL:           "https://sso.example.com",
		Realm:             "corp",
		AdminClientID:     "dashboard",
		AdminClientSecret: "s3cret-value",
		ClientIDPrefix:    "apisix-",
		InstanceIDs:       []string{"inst-a", "inst-b"},
	}
}

func TestValidateIdP(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(p *models.IdentityProvider)
		ok     bool
	}{
		{"valid", func(p *models.IdentityProvider) {}, true},
		{"type lemonldap", func(p *models.IdentityProvider) { p.Type = "lemonldap" }, false},
		{"base url without scheme", func(p *models.IdentityProvider) { p.BaseURL = "sso.example.com" }, false},
		{"base url ends in realms", func(p *models.IdentityProvider) { p.BaseURL = "https://sso/realms/x" }, false},
		{"empty realm", func(p *models.IdentityProvider) { p.Realm = "" }, false},
		{"empty admin client id", func(p *models.IdentityProvider) { p.AdminClientID = "" }, false},
		{"empty admin secret", func(p *models.IdentityProvider) { p.AdminClientSecret = "" }, false},
		{"uppercase prefix", func(p *models.IdentityProvider) { p.ClientIDPrefix = "Apisix_" }, false},
		{"empty prefix", func(p *models.IdentityProvider) { p.ClientIDPrefix = "" }, false},
		{"redirect domains valid", func(p *models.IdentityProvider) {
			p.RedirectDomains = []string{"example.com", "a-b.example.org", "localhost"}
		}, true},
		{"redirect domain uppercase", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"Example.com"} }, false},
		{"redirect domain wildcard", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"*.example.com"} }, false},
		{"redirect domain leading dot", func(p *models.IdentityProvider) { p.RedirectDomains = []string{".example.com"} }, false},
		{"redirect domain trailing dot", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"example.com."} }, false},
		{"redirect domain scheme", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"https://example.com"} }, false},
		{"redirect domain port", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"example.com:8443"} }, false},
		{"redirect domain empty", func(p *models.IdentityProvider) { p.RedirectDomains = []string{""} }, false},
		{"redirect domain empty label", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"a..b"} }, false},
		{"redirect domain numeric last label", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"0.1"} }, false},
		{"redirect domain single digit", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"1"} }, false},
		{"redirect domain digits inside last label", func(p *models.IdentityProvider) { p.RedirectDomains = []string{"corp.1a"} }, true},
		{"redirect domains 20", func(p *models.IdentityProvider) { p.RedirectDomains = manyDomains(20) }, true},
		{"redirect domains 21", func(p *models.IdentityProvider) { p.RedirectDomains = manyDomains(21) }, false},
		{"gateway url unset", func(p *models.IdentityProvider) { p.GatewayBaseURL = "" }, true},
		{"gateway url valid", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://keycloak:8080" }, true},
		{"gateway url with path", func(p *models.IdentityProvider) { p.GatewayBaseURL = "https://sso.internal/auth" }, true},
		{"gateway url without scheme", func(p *models.IdentityProvider) { p.GatewayBaseURL = "keycloak:8080" }, false},
		{"gateway url ftp", func(p *models.IdentityProvider) { p.GatewayBaseURL = "ftp://keycloak" }, false},
		{"gateway url ends in realms", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://keycloak/realms/x" }, false},
		{"gateway url with credentials", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://u:p@keycloak" }, false},
		{"gateway url with query", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://keycloak?x=1" }, false},
		{"gateway url with fragment", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://keycloak#x" }, false},
		{"gateway url with empty query", func(p *models.IdentityProvider) { p.GatewayBaseURL = "http://keycloak:8080?" }, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := validIdP()
			c.mutate(p)
			err := validateIdP(p)
			if c.ok && err != nil {
				t.Fatalf("want valid, got %v", err)
			}
			if !c.ok {
				if !errors.Is(err, ErrIdPInvalid) {
					t.Fatalf("want ErrIdPInvalid, got %v", err)
				}
				if strings.Contains(err.Error(), "s3cret-value") {
					t.Fatalf("error leaks the secret: %v", err)
				}
			}
		})
	}
}

func TestCreateSetsIDTypeAndDates(t *testing.T) {
	s := NewIdPService(newFakeKV())
	p := validIdP()
	p.Type = ""
	if err := s.Create(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	if p.ID == "" || p.Type != models.IdPTypeKeycloak || p.CreatedAt.IsZero() || p.UpdatedAt.IsZero() {
		t.Fatalf("not initialised: %+v", p)
	}
	got, err := s.Get(context.Background(), p.ID)
	if err != nil || got.Name != "corp" {
		t.Fatalf("get: %v %+v", err, got)
	}
	if _, err := s.Get(context.Background(), "nope"); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("want ErrIdPNotFound, got %v", err)
	}
}

func TestUpdateKeepsSecretWhenOmitted(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	name, empty := "renamed", ""
	for _, secret := range []*string{nil, &empty} {
		got, err := s.Update(ctx, p.ID, IdPUpdate{Name: &name, AdminClientSecret: secret})
		if err != nil {
			t.Fatal(err)
		}
		if got.AdminClientSecret != "s3cret-value" || got.Name != "renamed" {
			t.Fatalf("secret/name wrong: %+v", got)
		}
	}
	newSecret := "other"
	got, err := s.Update(ctx, p.ID, IdPUpdate{AdminClientSecret: &newSecret})
	if err != nil || got.AdminClientSecret != "other" {
		t.Fatalf("secret not replaced: %v %+v", err, got)
	}
}

func TestUpdateRejectsInvalid(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	realm := ""
	if _, err := s.Update(ctx, p.ID, IdPUpdate{Realm: &realm}); !errors.Is(err, ErrIdPInvalid) {
		t.Fatalf("want ErrIdPInvalid, got %v", err)
	}
	if _, err := s.Update(ctx, "nope", IdPUpdate{}); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("want ErrIdPNotFound, got %v", err)
	}
}

func TestUpdateLockedOnceClientsExist(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordClient(ctx, &models.IdPClient{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1", ClientID: "apisix-x"}); err != nil {
		t.Fatal(err)
	}

	realm, base, prefix := "other", "https://other.example.com", "zz-"
	for name, u := range map[string]IdPUpdate{
		"realm":                {Realm: &realm},
		"base":                 {BaseURL: &base},
		"prefix":               {ClientIDPrefix: &prefix},
		"drop linked instance": {InstanceIDs: &[]string{"inst-b"}},
	} {
		_, err := s.Update(ctx, p.ID, u)
		if !errors.Is(err, ErrIdPLocked) {
			t.Fatalf("%s: want ErrIdPLocked, got %v", name, err)
		}
		if !strings.Contains(err.Error(), "1 clients depend on it") {
			t.Fatalf("%s: count missing: %v", name, err)
		}
	}

	name := "renamed"
	if _, err := s.Update(ctx, p.ID, IdPUpdate{Name: &name}); err != nil {
		t.Fatalf("name change: %v", err)
	}
	same := "corp"
	if _, err := s.Update(ctx, p.ID, IdPUpdate{Realm: &same}); err != nil {
		t.Fatalf("unchanged realm must not lock: %v", err)
	}
	if _, err := s.Update(ctx, p.ID, IdPUpdate{InstanceIDs: &[]string{"inst-a"}}); err != nil {
		t.Fatalf("dropping an instance without entries: %v", err)
	}
	if _, err := s.Update(ctx, p.ID, IdPUpdate{InstanceIDs: &[]string{"inst-a", "inst-c"}}); err != nil {
		t.Fatalf("adding an instance: %v", err)
	}
}

func TestDeleteRefusedWithClientsUnlessForced(t *testing.T) {
	ctx := context.Background()
	kv := newFakeKV()
	s := NewIdPService(kv)
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	other := validIdP()
	if err := s.Create(ctx, other); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*models.IdPClient{
		{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1"},
		{IdPID: other.ID, InstanceID: "inst-a", KeycloakUUID: "u2"},
	} {
		if err := s.RecordClient(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Delete(ctx, p.ID, false); !errors.Is(err, ErrIdPHasClients) {
		t.Fatalf("want ErrIdPHasClients, got %v", err)
	}
	if _, err := s.Get(ctx, p.ID); err != nil {
		t.Fatalf("connection must survive a refused delete: %v", err)
	}
	if err := s.Delete(ctx, p.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, p.ID); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("want gone, got %v", err)
	}
	left, _ := s.ListClients(ctx, "")
	if len(left) != 1 || left[0].IdPID != other.ID {
		t.Fatalf("only the other connection's entry must remain: %+v", left)
	}
	if err := s.Delete(ctx, other.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "nope", false); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("want ErrIdPNotFound, got %v", err)
	}
	// without entries, no force needed
	free := validIdP()
	_ = s.Create(ctx, free)
	if err := s.Delete(ctx, free.ID, false); err != nil {
		t.Fatal(err)
	}
}

func TestForInstance(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	a := validIdP()
	a.InstanceIDs = []string{"inst-a"}
	b := validIdP()
	b.InstanceIDs = []string{"inst-b"}
	for _, p := range []*models.IdentityProvider{a, b} {
		if err := s.Create(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	all, err := s.List(ctx)
	if err != nil || len(all) != 2 {
		t.Fatalf("list: %v %d", err, len(all))
	}
	got, err := s.ForInstance(ctx, "inst-b")
	if err != nil || len(got) != 1 || got[0].ID != b.ID {
		t.Fatalf("for instance: %v %+v", err, got)
	}
	none, _ := s.ForInstance(ctx, "inst-z")
	if len(none) != 0 {
		t.Fatalf("want none, got %+v", none)
	}
}

func TestFindClient(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	_ = s.Create(ctx, p)
	c := &models.IdPClient{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1", ClientID: "apisix-x"}
	if err := s.RecordClient(ctx, c); err != nil {
		t.Fatal(err)
	}
	if c.CreatedAt.IsZero() {
		t.Fatal("CreatedAt not set")
	}
	_ = s.RecordClient(ctx, &models.IdPClient{IdPID: p.ID, InstanceID: "inst-b", KeycloakUUID: "u2"})

	got, err := s.FindClient(ctx, "inst-a", "u1")
	if err != nil || got.ClientID != "apisix-x" {
		t.Fatalf("find: %v %+v", err, got)
	}
	if _, err := s.FindClient(ctx, "inst-b", "u1"); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("wrong instance: want ErrIdPNotFound, got %v", err)
	}
	if _, err := s.FindClient(ctx, "inst-a", "zzz"); !errors.Is(err, ErrIdPNotFound) {
		t.Fatalf("unknown uuid: want ErrIdPNotFound, got %v", err)
	}

	forA, _ := s.ListClients(ctx, "inst-a")
	all, _ := s.ListClients(ctx, "")
	if len(forA) != 1 || len(all) != 2 {
		t.Fatalf("list clients: %d %d", len(forA), len(all))
	}
	if err := s.DeleteClient(ctx, c); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	rest, _ := s.ListClients(ctx, "")
	for _, r := range rest {
		ids = append(ids, r.KeycloakUUID)
	}
	sort.Strings(ids)
	if len(ids) != 1 || ids[0] != "u2" {
		t.Fatalf("after delete: %v", ids)
	}
}

func TestUpdateRequiresSecretWhenDestinationChanges(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name       string
		update     IdPUpdate
		wantErr    bool
		wantSecret string
	}{
		{"base_url change without secret", IdPUpdate{BaseURL: str("https://evil.example.com")}, true, ""},
		{"base_url change with secret", IdPUpdate{BaseURL: str("https://new.example.com"), AdminClientSecret: str("fresh")}, false, "fresh"},
		{"base_url change with empty secret", IdPUpdate{BaseURL: str("https://evil.example.com"), AdminClientSecret: str("")}, true, ""},
		{"realm change without secret", IdPUpdate{Realm: str("other")}, true, ""},
		{"admin_client_id change without secret", IdPUpdate{AdminClientID: str("other")}, true, ""},
		{"same base_url resubmitted", IdPUpdate{BaseURL: str("https://sso.example.com")}, false, "s3cret-value"},
		{"name change", IdPUpdate{Name: str("renamed")}, false, "s3cret-value"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx := context.Background()
			s := NewIdPService(newFakeKV())
			p := validIdP()
			if err := s.Create(ctx, p); err != nil {
				t.Fatal(err)
			}
			got, err := s.Update(ctx, p.ID, c.update)
			stored, _ := s.Get(ctx, p.ID)
			if c.wantErr {
				if !errors.Is(err, ErrIdPInvalid) {
					t.Fatalf("want ErrIdPInvalid, got %v", err)
				}
				if strings.Contains(err.Error(), "s3cret-value") {
					t.Fatalf("error leaks the secret: %v", err)
				}
				if stored.AdminClientSecret != "s3cret-value" || stored.BaseURL != p.BaseURL {
					t.Fatalf("a refused update must not change the record: %+v", stored)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.AdminClientSecret != c.wantSecret || stored.AdminClientSecret != c.wantSecret {
				t.Fatalf("secret = %q, want %q", stored.AdminClientSecret, c.wantSecret)
			}
		})
	}
}

func manyDomains(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("d%d.example.com", i)
	}
	return out
}

func TestUpdateRedirectDomainsNeedsNoSecretAndIsNotLocked(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordClient(ctx, &models.IdPClient{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1"}); err != nil {
		t.Fatal(err)
	}
	d := []string{"example.com"}
	got, err := s.Update(ctx, p.ID, IdPUpdate{RedirectDomains: &d})
	if err != nil {
		t.Fatalf("update with clients and no secret: %v", err)
	}
	if len(got.RedirectDomains) != 1 || got.RedirectDomains[0] != "example.com" {
		t.Fatalf("domains %v", got.RedirectDomains)
	}
	bad := []string{"*.example.com"}
	if _, err := s.Update(ctx, p.ID, IdPUpdate{RedirectDomains: &bad}); !errors.Is(err, ErrIdPInvalid) {
		t.Fatalf("want invalid, got %v", err)
	}
}

func TestDetachRoute(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	_ = s.Create(ctx, p)
	for _, c := range []*models.IdPClient{
		{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1", RouteID: "r1", RouteCreateTime: 100},
		{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u2", RouteID: "r1", RouteCreateTime: 100},
		{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u3", RouteID: "r2", RouteCreateTime: 100},
		{IdPID: p.ID, InstanceID: "inst-b", KeycloakUUID: "u4", RouteID: "r1", RouteCreateTime: 100},
	} {
		if err := s.RecordClient(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	n, err := s.DetachRoute(ctx, "inst-a", "r1")
	if err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	want := map[string]int64{"u1": 0, "u2": 0, "u3": 100, "u4": 100}
	all, _ := s.ListClients(ctx, "")
	for _, c := range all {
		if c.RouteCreateTime != want[c.KeycloakUUID] {
			t.Errorf("%s: create time %d", c.KeycloakUUID, c.RouteCreateTime)
		}
		if c.KeycloakUUID == "u1" && c.RouteID != "r1" {
			t.Errorf("route id lost: %q", c.RouteID)
		}
	}
	if n, err := s.DetachRoute(ctx, "inst-a", "r1"); err != nil || n != 0 {
		t.Fatalf("second detach: n=%d err=%v", n, err)
	}
}

func TestForgetInstance(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	both := validIdP()
	both.InstanceIDs = []string{"inst-a", "inst-b"}
	onlyA := validIdP()
	onlyA.InstanceIDs = []string{"inst-a"}
	onlyB := validIdP()
	onlyB.InstanceIDs = []string{"inst-b"}
	for _, p := range []*models.IdentityProvider{both, onlyA, onlyB} {
		if err := s.Create(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := s.Get(ctx, both.ID)
	for _, c := range []*models.IdPClient{
		{IdPID: both.ID, InstanceID: "inst-a", KeycloakUUID: "u1", ClientID: "mad-1", RouteID: "r1"},
		{IdPID: onlyA.ID, InstanceID: "inst-a", KeycloakUUID: "u2", ClientID: "mad-2", RouteID: "r2"},
		{IdPID: both.ID, InstanceID: "inst-b", KeycloakUUID: "u3", ClientID: "mad-3", RouteID: "r1"},
	} {
		if err := s.RecordClient(ctx, c); err != nil {
			t.Fatal(err)
		}
	}

	n, err := s.ForgetInstance(ctx, "inst-a")
	if err != nil || n != 2 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	all, _ := s.ListClients(ctx, "")
	if len(all) != 1 || all[0].KeycloakUUID != "u3" {
		t.Fatalf("entries left: %+v", all)
	}
	for id, want := range map[string]string{both.ID: "inst-b", onlyA.ID: "", onlyB.ID: "inst-b"} {
		p, err := s.Get(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(p.InstanceIDs, ","); got != want {
			t.Errorf("%s linked to %q, want %q", p.ID, got, want)
		}
		if p.AdminClientSecret == "" {
			t.Errorf("%s lost its secret", p.ID)
		}
	}
	after, _ := s.Get(ctx, both.ID)
	if !time.Time(after.UpdatedAt).After(time.Time(before.UpdatedAt)) {
		t.Error("an unlinked connection keeps its updated_at, so its cached client would too")
	}

	// Nothing of the deleted instance holds the connection any more.
	none := []string{}
	if _, err := s.Update(ctx, onlyA.ID, IdPUpdate{InstanceIDs: &none}); err != nil {
		t.Fatalf("update after forget: %v", err)
	}
	if n, err := s.ForgetInstance(ctx, "inst-a"); err != nil || n != 0 {
		t.Fatalf("second forget: n=%d err=%v", n, err)
	}
}

func TestUpdateGatewayURLNeitherLocksNorAsksForTheSecret(t *testing.T) {
	ctx := context.Background()
	s := NewIdPService(newFakeKV())
	p := validIdP()
	if err := s.Create(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordClient(ctx, &models.IdPClient{IdPID: p.ID, InstanceID: "inst-a", KeycloakUUID: "u1", ClientID: "apisix-x"}); err != nil {
		t.Fatal(err)
	}
	// The routes already written keep their address; the secret never goes
	// to the gateway address, so neither the clients nor the secret are at stake.
	gw := "http://keycloak:8080"
	got, err := s.Update(ctx, p.ID, IdPUpdate{GatewayBaseURL: &gw})
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if got.GatewayBaseURL != gw || got.AdminClientSecret != "s3cret-value" {
		t.Fatalf("got %+v", got)
	}
	empty := ""
	got, err = s.Update(ctx, p.ID, IdPUpdate{GatewayBaseURL: &empty})
	if err != nil || got.GatewayBaseURL != "" {
		t.Fatalf("clear: %v %+v", err, got)
	}
	bad := "keycloak"
	if _, err := s.Update(ctx, p.ID, IdPUpdate{GatewayBaseURL: &bad}); !errors.Is(err, ErrIdPInvalid) {
		t.Fatalf("want ErrIdPInvalid, got %v", err)
	}
}

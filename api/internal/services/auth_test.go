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
	"encoding/json"
	"testing"
	"time"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// Until #300 nothing dated a user record. Both fields were serialized as Go's
// zero time, which is a date the page cannot tell from a real one.
func TestStampCreatedDatesTheRecord(t *testing.T) {
	now := time.Date(2026, 9, 27, 14, 5, 0, 0, time.UTC)
	user := &models.User{ID: "u1", Username: "someone"}

	stampCreated(user, now)

	if user.CreatedAt == nil || !user.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", user.CreatedAt, now)
	}
	if user.UpdatedAt == nil || !user.UpdatedAt.Equal(now) {
		t.Errorf("UpdatedAt = %v, want %v", user.UpdatedAt, now)
	}
}

func TestStampUpdatedKeepsTheCreationDate(t *testing.T) {
	created := time.Date(2026, 1, 2, 9, 0, 0, 0, time.UTC)
	later := created.Add(48 * time.Hour)
	user := &models.User{ID: "u1", CreatedAt: &created, UpdatedAt: &created}

	stampUpdated(user, later)

	if user.CreatedAt == nil || !user.CreatedAt.Equal(created) {
		t.Errorf("CreatedAt = %v, want it left at %v", user.CreatedAt, created)
	}
	if user.UpdatedAt == nil || !user.UpdatedAt.Equal(later) {
		t.Errorf("UpdatedAt = %v, want %v", user.UpdatedAt, later)
	}
}

// An account stored before anything stamped it has no creation date to keep.
// Updating it must not invent one: a fabricated date reads as a real one.
func TestStampUpdatedDoesNotInventAMissingCreationDate(t *testing.T) {
	user := &models.User{ID: "u1"}

	stampUpdated(user, time.Date(2026, 9, 27, 14, 5, 0, 0, time.UTC))

	if user.CreatedAt != nil {
		t.Errorf("CreatedAt = %v, want it left unset", user.CreatedAt)
	}
}

// A record with no date is served as null. As a value it was
// "0001-01-01T00:00:00Z", which every consumer that does not know the trap reads
// as a date: a sort puts it first, an export writes it down, a page shows
// 01/01/1 - which the Users page did (#300, #321).
func TestUndatedRecordsAreServedAsNull(t *testing.T) {
	for _, tt := range []struct {
		name   string
		record any
	}{
		{"user", &models.User{ID: "u1", Username: "someone"}},
		{"instance", &models.Instance{ID: "i1", Name: "local"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(tt.record)
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"created_at", "updated_at"} {
				value, present := got[field]
				if !present {
					t.Errorf("%s is missing: a consumer cannot tell it from a field it does not know", field)
					continue
				}
				if value != nil {
					t.Errorf("%s = %v, want null", field, value)
				}
			}
		})
	}
}

// And a dated one is served as the date it holds.
func TestDatedRecordsKeepTheirDate(t *testing.T) {
	now := time.Date(2026, 9, 28, 3, 30, 0, 0, time.UTC)
	body, err := json.Marshal(&models.User{ID: "u1", CreatedAt: &now, UpdatedAt: &now})
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		CreatedAt *time.Time `json:"created_at"`
		UpdatedAt *time.Time `json:"updated_at"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got.CreatedAt == nil || !got.CreatedAt.Equal(now) {
		t.Errorf("created_at = %v, want %v", got.CreatedAt, now)
	}
	if got.UpdatedAt == nil || !got.UpdatedAt.Equal(now) {
		t.Errorf("updated_at = %v, want %v", got.UpdatedAt, now)
	}
}

// An account stored before anything stamped it holds the zero time in etcd, and
// reads back as undated rather than as the year 1.
func TestAZeroTimeInEtcdReadsAsUndated(t *testing.T) {
	stored := []byte(`{"id":"u1","username":"someone","created_at":"0001-01-01T00:00:00Z","updated_at":"0001-01-01T00:00:00Z"}`)

	var user models.User
	if err := json.Unmarshal(stored, &user); err != nil {
		t.Fatal(err)
	}
	// It decodes to a pointer at the zero time, which is not nil - so the
	// API would serve it back as the year 1 unless it is read as undated.
	if user.CreatedAt != nil && !user.CreatedAt.IsZero() {
		t.Fatalf("CreatedAt = %v, want the zero time", user.CreatedAt)
	}
	if userAsRead(&user).CreatedAt != nil {
		t.Error("the zero time did not read as no date at all")
	}

	// And a real date is left where it is.
	now := time.Now()
	dated := models.User{ID: "u1", CreatedAt: &now}
	if got := userAsRead(&dated).CreatedAt; got == nil || !got.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", got, now)
	}
}

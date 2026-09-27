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

	if !user.CreatedAt.Equal(now) {
		t.Errorf("CreatedAt = %v, want %v", user.CreatedAt, now)
	}
	if !user.UpdatedAt.Equal(now) {
		t.Errorf("UpdatedAt = %v, want %v", user.UpdatedAt, now)
	}
	if user.CreatedAt.IsZero() {
		t.Error("CreatedAt is the zero time, which the page shows as 01/01/1")
	}
}

func TestStampUpdatedKeepsTheCreationDate(t *testing.T) {
	created := time.Date(2026, 1, 2, 9, 0, 0, 0, time.UTC)
	later := created.Add(48 * time.Hour)
	user := &models.User{ID: "u1", CreatedAt: created, UpdatedAt: created}

	stampUpdated(user, later)

	if !user.CreatedAt.Equal(created) {
		t.Errorf("CreatedAt = %v, want it left at %v", user.CreatedAt, created)
	}
	if !user.UpdatedAt.Equal(later) {
		t.Errorf("UpdatedAt = %v, want %v", user.UpdatedAt, later)
	}
}

// An account stored before anything stamped it has no creation date to keep.
// Updating it must not invent one: a fabricated date reads as a real one.
func TestStampUpdatedDoesNotInventAMissingCreationDate(t *testing.T) {
	user := &models.User{ID: "u1"}

	stampUpdated(user, time.Date(2026, 9, 27, 14, 5, 0, 0, time.UTC))

	if !user.CreatedAt.IsZero() {
		t.Errorf("CreatedAt = %v, want it left unset", user.CreatedAt)
	}
}

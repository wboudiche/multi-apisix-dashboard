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

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// ErrNoUsersRead is returned when the users could not be read as anything but
// an empty list. The backend always keeps at least one super_admin (#210), so an
// empty read is a failed one, and judged against it every assignment would look
// orphaned.
var ErrNoUsersRead = errors.New("no users could be read; refusing to judge assignments against an empty list")

// OrphanedAssignment is an instance assignment whose user no longer exists.
type OrphanedAssignment struct {
	Key        string `json:"key"`
	UserID     string `json:"user_id"`
	InstanceID string `json:"instance_id"`
	Role       string `json:"role,omitempty"`
	TeamID     string `json:"team_id,omitempty"`
}

// PurgeResult says what became of each key a purge was asked to delete.
type PurgeResult struct {
	Deleted []string          `json:"deleted"`
	Skipped map[string]string `json:"skipped"`
	Failed  map[string]string `json:"failed"`
}

// MaintenanceService finds and removes data that nothing refers to any more.
//
// Nothing is removed on its own initiative: a purge deletes only the keys it is
// given, each checked again at the time, so what goes is what an operator was
// shown and chose.
type MaintenanceService struct {
	etcd *EtcdClient
}

func NewMaintenanceService(etcd *EtcdClient) *MaintenanceService {
	return &MaintenanceService{etcd: etcd}
}

// FindOrphanedUserInstances lists the instance assignments whose user no longer
// exists. Deleting a user removes its assignments since #206; the ones left by
// deletions before that still put their users on teams (#209).
func (s *MaintenanceService) FindOrphanedUserInstances(ctx context.Context) ([]OrphanedAssignment, error) {
	orphans, _, err := s.readOrphanedUserInstances(ctx)
	return orphans, err
}

// readOrphanedUserInstances also returns every assignment key it read, so a
// purge can tell a key that is not orphaned from one that is not there at all.
func (s *MaintenanceService) readOrphanedUserInstances(ctx context.Context) ([]OrphanedAssignment, map[string][]byte, error) {
	// Assignments first, users second. A user created in between cannot have
	// an assignment in the first read, since a user is made before it is
	// assigned; read the other way round, its assignment would look orphaned.
	assignments, err := s.etcd.List(ctx, models.KeyPrefixUserInstances)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read instance assignments: %w", err)
	}
	users, err := s.etcd.List(ctx, models.KeyPrefixUsers)
	if err != nil {
		return nil, nil, fmt.Errorf("could not read users: %w", err)
	}
	orphans, err := orphanedAssignments(assignments, users)
	if err != nil {
		return nil, nil, err
	}
	return orphans, assignments, nil
}

// PurgeOrphanedUserInstances deletes the given assignment keys, each only if it
// is still orphaned when the purge runs. Keys that are not, that are already
// gone, or that are named twice are skipped, and each skip says why.
func (s *MaintenanceService) PurgeOrphanedUserInstances(ctx context.Context, keys []string) (*PurgeResult, error) {
	orphans, assignments, err := s.readOrphanedUserInstances(ctx)
	if err != nil {
		return nil, err
	}
	orphaned := make(map[string]bool, len(orphans))
	for _, o := range orphans {
		orphaned[o.Key] = true
	}

	result := &PurgeResult{
		Deleted: []string{},
		Skipped: map[string]string{},
		Failed:  map[string]string{},
	}
	seen := make(map[string]bool, len(keys))
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		if !orphaned[key] {
			result.Skipped[key] = "its user exists"
			if _, ok := assignments[key]; !ok {
				// Already gone - an earlier purge, or another admin's - or
				// never an assignment key. Not to be read as a living user's.
				result.Skipped[key] = "no such instance assignment"
			}
			continue
		}
		if err := s.etcd.Delete(ctx, key); err != nil {
			result.Failed[key] = err.Error()
			continue
		}
		result.Deleted = append(result.Deleted, key)
	}
	return result, nil
}

// orphanedAssignments decides which assignments have no user, given the raw
// keys and values under /user_instances/ and /users/. With no users at all it
// refuses to decide: that read has failed, and every assignment would look
// orphaned.
//
// A user counts as existing if its key does, whatever its record holds: a
// record that no longer parses is still a user, and its access is not this
// sweep's to take away. Ids are compared with their quotes stripped, because
// middleware/rbac.go still honours assignments an earlier bug wrote under a
// quoted id - "<id>", or "\"<id>\"" - and those belong to living users.
func orphanedAssignments(assignments, users map[string][]byte) ([]OrphanedAssignment, error) {
	if len(users) == 0 {
		return nil, ErrNoUsersRead
	}
	known := make(map[string]bool, len(users))
	for key, value := range users {
		known[unquoteID(strings.TrimPrefix(key, models.KeyPrefixUsers))] = true
		var user models.User
		if json.Unmarshal(value, &user) == nil && user.ID != "" {
			known[unquoteID(user.ID)] = true
		}
	}

	orphans := []OrphanedAssignment{}
	for key, value := range assignments {
		rest := strings.TrimPrefix(key, models.KeyPrefixUserInstances)
		userSegment, instanceID, ok := strings.Cut(rest, "/")
		if !ok || userSegment == "" {
			continue
		}
		if known[unquoteID(userSegment)] {
			continue
		}
		orphan := OrphanedAssignment{Key: key, UserID: userSegment, InstanceID: instanceID}
		var ui models.UserInstance
		if json.Unmarshal(value, &ui) == nil {
			orphan.Role = ui.Role
			orphan.TeamID = ui.TeamID
		}
		orphans = append(orphans, orphan)
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].Key < orphans[j].Key })
	return orphans, nil
}

func unquoteID(id string) string {
	return strings.Trim(id, `"\`)
}

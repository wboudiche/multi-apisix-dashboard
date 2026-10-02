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
	// TeamID is the first of TeamIDs, under the name it had when an
	// assignment held one team.
	TeamID  string   `json:"team_id,omitempty"`
	TeamIDs []string `json:"team_ids,omitempty"`
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
// given, each judged again when the purge runs and deleted only if it has not
// been written since, so what goes is what an operator was shown and chose.
type MaintenanceService struct {
	etcd    *EtcdClient
	lister  resourceLister
	deleter keyDeleter
}

// keyDeleter deletes a key only if it is unchanged since a read.
type keyDeleter interface {
	DeleteIfUnchanged(ctx context.Context, key string, modRevision int64) (deleted, exists bool, err error)
}

func NewMaintenanceService(etcd *EtcdClient) *MaintenanceService {
	return &MaintenanceService{etcd: etcd, lister: newAPISIXResourceLister(), deleter: etcd}
}

// FindOrphanedUserInstances lists the instance assignments whose user no longer
// exists. Deleting a user removes its assignments since #206; the ones left by
// deletions before that still put their users on teams (#209).
func (s *MaintenanceService) FindOrphanedUserInstances(ctx context.Context) ([]OrphanedAssignment, error) {
	orphans, _, _, err := s.readOrphanedUserInstances(ctx)
	return orphans, err
}

// readOrphanedUserInstances also returns every assignment it read, with its
// revision, so a purge can tell a key that is not orphaned from one that is not
// there at all, and leave one written since.
func (s *MaintenanceService) readOrphanedUserInstances(ctx context.Context) ([]OrphanedAssignment, map[string][]byte, map[string]int64, error) {
	// Assignments first, users second. A user created in between cannot have
	// an assignment in the first read, since a user is made before it is
	// assigned; read the other way round, its assignment would look orphaned.
	assignments, revisions, err := s.etcd.ListWithRevisions(ctx, models.KeyPrefixUserInstances)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not read instance assignments: %w", err)
	}
	users, err := s.etcd.List(ctx, models.KeyPrefixUsers)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not read users: %w", err)
	}
	orphans, err := orphanedAssignments(assignments, users)
	if err != nil {
		return nil, nil, nil, err
	}
	return orphans, assignments, revisions, nil
}

// PurgeOrphanedUserInstances deletes the given assignment keys, each only if it
// is still orphaned when the purge runs. Keys that are not, that are already
// gone, or that are named twice are skipped, and each skip says why.
func (s *MaintenanceService) PurgeOrphanedUserInstances(ctx context.Context, keys []string) (*PurgeResult, error) {
	orphans, assignments, revisions, err := s.readOrphanedUserInstances(ctx)
	if err != nil {
		return nil, err
	}
	orphaned := make(map[string]bool, len(orphans))
	for _, o := range orphans {
		orphaned[o.Key] = true
	}
	return s.purgeKeys(ctx, keys, orphaned, revisions, func(key string) string {
		if _, ok := assignments[key]; !ok {
			// Already gone - an earlier purge, or another admin's - or never
			// an assignment key. Not to be read as a living user's.
			return "no such instance assignment"
		}
		return "its user exists"
	}), nil
}

// purgeKeys deletes each key that is orphaned, once however often it is named,
// and says of every other key why it was skipped.
//
// A key is deleted only if it is unchanged since it was judged. Between the
// judgement and the delete, the purge may be asking other gateways for their
// resources, and a team can recreate a resource under a freed id in that time:
// its fresh record is written under the same key, and deleted unconditionally
// it would leave the new resource with no team.
func (s *MaintenanceService) purgeKeys(ctx context.Context, keys []string, orphaned map[string]bool, revisions map[string]int64, skipReason func(key string) string) *PurgeResult {
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
			result.Skipped[key] = skipReason(key)
			continue
		}
		deleted, exists, err := s.deleter.DeleteIfUnchanged(ctx, key, revisions[key])
		switch {
		case err != nil:
			result.Failed[key] = err.Error()
			continue
		case !deleted && exists:
			result.Skipped[key] = "written since it was checked"
			continue
		case !deleted:
			// Another purge got there first.
			result.Skipped[key] = "already deleted"
			continue
		}
		result.Deleted = append(result.Deleted, key)
	}
	return result
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
	known := livingUsers(users)

	orphans := []OrphanedAssignment{}
	for key, value := range assignments {
		rest := strings.TrimPrefix(key, models.KeyPrefixUserInstances)
		userSegment, instanceID, ok := strings.Cut(rest, "/")
		if !ok || userSegment == "" {
			continue
		}
		if _, alive := known[unquoteID(userSegment)]; alive {
			continue
		}
		orphan := OrphanedAssignment{Key: key, UserID: userSegment, InstanceID: instanceID}
		var ui models.UserInstance
		if json.Unmarshal(value, &ui) == nil {
			orphan.Role = ui.Role
			if len(ui.TeamIDs) > 0 {
				orphan.TeamID = ui.TeamIDs[0]
				orphan.TeamIDs = ui.TeamIDs
			}
		}
		orphans = append(orphans, orphan)
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].Key < orphans[j].Key })
	return orphans, nil
}

// livingUsers reads the users that exist out of their stored records: every id
// one answers to, quotes aside, with the name to call it by.
//
// A user answers to the id in its key and to the id in its record - an old bug
// wrote some of either in quotes - and a record that no longer parses is still
// a user, known by its key: it may be repaired, and a token it was issued
// keeps working until it expires. One reading for everything that asks "does
// this user exist": the orphan scan, which must not purge the assignments of
// a user that does, and a team delete, which must not go through from under
// one (#375). Two readings had already come apart on the record that does not
// parse.
//
// The name is the username, or the id itself for want of one - never a blank,
// and never the key of some other record. Where several records answer to one
// id, the record stored under that very id names it before one that answers
// to it by an alias - a key in quotes, or an id written in a record kept
// under another key - and among equals the one whose key sorts first, so that
// the same question gets the same answer twice.
func livingUsers(users map[string][]byte) map[string]string {
	keys := make([]string, 0, len(users))
	for key := range users {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	const (
		byItsOwnRecord = iota
		byAnAlias
		byItsID
	)
	type named struct {
		name string
		rank int
	}
	best := make(map[string]named, len(users))
	offer := func(id, name string, rank int) {
		if id == "" {
			return
		}
		if current, known := best[id]; !known || rank < current.rank {
			best[id] = named{name, rank}
		}
	}
	for _, key := range keys {
		written := strings.TrimPrefix(key, models.KeyPrefixUsers)
		keyID := unquoteID(written)
		offer(keyID, keyID, byItsID)

		var user models.User
		if json.Unmarshal(users[key], &user) != nil {
			continue
		}
		recordID := unquoteID(user.ID)
		offer(recordID, recordID, byItsID)
		if user.Username == "" {
			continue
		}
		if written == keyID {
			offer(keyID, user.Username, byItsOwnRecord)
		} else {
			offer(keyID, user.Username, byAnAlias)
		}
		if recordID != keyID {
			offer(recordID, user.Username, byAnAlias)
		}
	}

	names := make(map[string]string, len(best))
	for id, found := range best {
		names[id] = found.name
	}
	return names
}

func unquoteID(id string) string {
	return strings.Trim(id, `"\`)
}

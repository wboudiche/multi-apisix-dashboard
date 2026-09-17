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
	"reflect"
	"testing"
)

func assignment(role, team string) []byte {
	return []byte(`{"role":"` + role + `","team_id":"` + team + `"}`)
}

// An assignment is orphaned only when no user answers to its id, however that
// id was written (#209).
func TestOrphanedAssignments(t *testing.T) {
	users := map[string][]byte{
		"/users/alice": []byte(`{"id":"alice","username":"alice"}`),
		// A record that no longer parses is still a user.
		"/users/bob": []byte(`not json`),
		// Found by the id its record holds, not only by its key.
		"/users/legacy-key": []byte(`{"id":"carol"}`),
	}
	assignments := map[string][]byte{
		"/user_instances/alice/i1":       assignment("developer", "t1"),
		"/user_instances/bob/i1":         assignment("viewer", "t2"),
		"/user_instances/carol/i1":       assignment("developer", "t1"),
		`/user_instances/"alice"/i2`:     assignment("developer", "t1"),
		`/user_instances/"\"alice\""/i3`: assignment("developer", "t1"),
		"/user_instances/gone/i1":        assignment("developer", "t9"),
		"/user_instances/gone/i2":        []byte(`not json`),
		"/user_instances/malformed":      assignment("developer", "t1"),
	}

	got, err := orphanedAssignments(assignments, users)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []OrphanedAssignment{
		{Key: "/user_instances/gone/i1", UserID: "gone", InstanceID: "i1", Role: "developer", TeamID: "t9"},
		{Key: "/user_instances/gone/i2", UserID: "gone", InstanceID: "i2"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d orphans %+v, want %d %+v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("orphan %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestOrphanedAssignmentsWithNoAssignments(t *testing.T) {
	got, err := orphanedAssignments(map[string][]byte{}, map[string][]byte{"/users/alice": []byte(`{}`)})
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("got %#v, %v, want an empty, non-nil list", got, err)
	}
}

// With no users read at all, nothing is judged: that read failed, and against
// it every assignment would look orphaned (#209).
func TestOrphanedAssignmentsRefusesWithNoUsers(t *testing.T) {
	assignments := map[string][]byte{"/user_instances/alice/i1": assignment("developer", "t1")}

	got, err := orphanedAssignments(assignments, map[string][]byte{})

	if !errors.Is(err, ErrNoUsersRead) || got != nil {
		t.Fatalf("got %#v, %v, want no orphans and ErrNoUsersRead", got, err)
	}
}

type fakeDeleter struct {
	changed   map[string]bool
	gone      map[string]bool
	broken    map[string]bool
	deleted   []string
	revisions map[string]int64
}

func (f *fakeDeleter) DeleteIfUnchanged(_ context.Context, key string, modRevision int64) (bool, bool, error) {
	f.revisions[key] = modRevision
	switch {
	case f.broken[key]:
		return false, false, errors.New("etcd unavailable")
	case f.gone[key]:
		return false, false, nil
	case f.changed[key]:
		return false, true, nil
	}
	f.deleted = append(f.deleted, key)
	return true, true, nil
}

// A purge deletes an orphaned key once however often it is named, only at the
// revision it was judged at, leaves one written since, and says why of every
// key it did not delete.
func TestPurgeKeys(t *testing.T) {
	deleter := &fakeDeleter{
		changed:   map[string]bool{"rewritten": true},
		gone:      map[string]bool{"raced": true},
		broken:    map[string]bool{"broken": true},
		revisions: map[string]int64{},
	}
	s := &MaintenanceService{deleter: deleter}
	orphaned := map[string]bool{"orphan": true, "rewritten": true, "raced": true, "broken": true}
	revisions := map[string]int64{"orphan": 7, "rewritten": 8, "raced": 9, "broken": 10, "living": 11}

	got := s.purgeKeys(context.Background(), []string{"orphan", "living", "orphan", "rewritten", "raced", "broken"}, orphaned, revisions,
		func(key string) string { return "not orphaned: " + key })

	want := &PurgeResult{
		Deleted: []string{"orphan"},
		Skipped: map[string]string{
			"living":    "not orphaned: living",
			"rewritten": "written since it was checked",
			"raced":     "already deleted",
		},
		Failed: map[string]string{"broken": "etcd unavailable"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if !reflect.DeepEqual(deleter.deleted, []string{"orphan"}) {
		t.Errorf("deleted %v, want only orphan, once", deleter.deleted)
	}
	// Each delete is conditioned on the revision judged; nothing is attempted
	// for a key that was not orphaned.
	if wantRevisions := map[string]int64{"orphan": 7, "rewritten": 8, "raced": 9, "broken": 10}; !reflect.DeepEqual(deleter.revisions, wantRevisions) {
		t.Errorf("revisions %v, want %v", deleter.revisions, wantRevisions)
	}
}

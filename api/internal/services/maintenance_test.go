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
	"errors"
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

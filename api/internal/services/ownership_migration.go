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
	"sort"
	"strings"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/models"
)

// typesOwnedSince455 are the types that became team-owned in #455. Records of
// them written before then name whichever team an admin had selected at the
// time, not one anyone chose for the object.
var typesOwnedSince455 = map[string]bool{"plugin_configs": true, "ssls": true, "protos": true}

// recordsFromBeforeTeamOwnership returns, sorted, the keys among records that
// are ownership records of a type in typesOwnedSince455:
// /ownership/<instance>/<type>/<id>, exactly.
func recordsFromBeforeTeamOwnership(records map[string][]byte) []string {
	var stale []string
	for key := range records {
		parts := strings.Split(strings.TrimPrefix(key, models.KeyPrefixOwnership), "/")
		if len(parts) == 3 && parts[2] != "" && typesOwnedSince455[parts[1]] {
			stale = append(stale, key)
		}
	}
	sort.Strings(stale)
	return stale
}

// DropRecordsFromBeforeTeamOwnership deletes, once per etcd, the ownership
// records of the types that became team-owned in #455, so that objects made
// before are admin-only until an admin gives them a team, as the release says.
// A marker under /config/ keeps it from running again: a record written after
// the upgrade is a real owner. Safe to retry - nothing is marked until every
// deletion has gone through.
func (s *OwnershipService) DropRecordsFromBeforeTeamOwnership(ctx context.Context) (int, error) {
	marker := models.ConfigKeyTeamOwnedSince455
	if done, err := s.etcd.Get(ctx, marker); err != nil {
		return 0, err
	} else if done != nil {
		return 0, nil
	}
	records, err := s.etcd.List(ctx, models.KeyPrefixOwnership)
	if err != nil {
		return 0, err
	}
	stale := recordsFromBeforeTeamOwnership(records)
	for _, key := range stale {
		if err := s.etcd.Delete(ctx, key); err != nil {
			return 0, err
		}
	}
	return len(stale), s.etcd.PutJSON(ctx, marker, true)
}

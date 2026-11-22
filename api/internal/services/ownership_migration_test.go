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
	"reflect"
	"testing"
)

// Before #249 an admin with a team selected left an ownership record on every
// write, plugin configs, SSLs and protos included, naming whichever team was
// selected. Nothing read those records while the types were instance-wide;
// once they became team-owned (#455), they would decide in silence who sees
// the object. They are dropped once, so that what existed before is an
// admin's until an admin gives it a team. Records of the types teams owned
// all along are kept.
func TestRecordsFromBeforeTeamOwnership(t *testing.T) {
	team := []byte(`"t1"`)
	records := map[string][]byte{
		"/ownership/i1/ssls/s1":            team,
		"/ownership/i1/plugin_configs/pc1": team,
		"/ownership/i2/protos/p1":          team,
		"/ownership/i1/routes/r1":          team,
		"/ownership/i1/consumers/alice":    team,
		"/ownership/i1/stream_routes/sr1":  team,
		"/ownership/i1/global_rules/g1":    team,
		"/ownership/i1/ssls":               team,
		"/ownership/i1/sslsx/s1":           team,
	}
	want := []string{
		"/ownership/i1/plugin_configs/pc1",
		"/ownership/i1/ssls/s1",
		"/ownership/i2/protos/p1",
	}
	if got := recordsFromBeforeTeamOwnership(records); !reflect.DeepEqual(got, want) {
		t.Errorf("recordsFromBeforeTeamOwnership = %v, want %v", got, want)
	}
}

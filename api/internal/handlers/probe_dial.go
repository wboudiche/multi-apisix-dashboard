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

package handlers

import (
	"context"
	"net"

	"github.com/wboudiche/multi-apisix-dashboard/api/internal/probe"
)

// probeDialSlots is the ceiling, kept as a name here for the tests that assert
// against it. It lives in the probe package because the overview's fan-out is
// bounded by the same one (#330).
const probeDialSlots = probe.Slots

// acquireProbeSlot waits for one of the dashboard's outbound connection slots.
func acquireProbeSlot(ctx context.Context) (func(), error) {
	return probe.Acquire(ctx)
}

// probeDial opens one probe connection, within the ceiling.
//
// Tests replace dialContext, and go through here to reach it, so what they
// observe is what the ceiling allows.
func probeDial(ctx context.Context, network, addr string) (net.Conn, error) {
	release, err := acquireProbeSlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	return dialContext(ctx, network, addr)
}

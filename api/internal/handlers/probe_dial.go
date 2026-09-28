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
)

// probeDialSlots is how many connections the dashboard opens at once for the
// endpoints that dial on a caller's behalf: the connection test and the WSDL
// fetch, whatever the number of requests or the number of nodes in one.
//
// The bound is on connections because connections are the resource. A ceiling
// on requests alone leaves a hundred nodes per request behind it, and a ceiling
// per request leaves the requests unbounded - the first version of this change
// put a pool inside one request and made a hundred-node test thirteen times
// slower for it, which lengthened the window it held a request slot rather than
// bounding anything (#310).
const probeDialSlots = 64

var probeSlots = make(chan struct{}, probeDialSlots)

// acquireProbeSlot waits for one of the dashboard's outbound connection slots.
//
// It returns the context's error if the caller goes away, or the request runs
// out of its budget, while waiting - so a probe that never gets a slot reads as
// one that was not tried rather than as an upstream that is down.
func acquireProbeSlot(ctx context.Context) (func(), error) {
	select {
	case probeSlots <- struct{}{}:
		return func() { <-probeSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
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

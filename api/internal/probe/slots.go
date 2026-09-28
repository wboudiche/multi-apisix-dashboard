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

// Package probe holds the ceiling on the connections the dashboard opens on a
// caller's behalf.
//
// It is one ceiling, in one place, because the resource is one: the dashboard
// host's outbound connections. #310 bounded the three endpoints that dial for a
// caller - the connection test, the route test, the WSDL fetch - and the
// overview was left out of that accounting, one goroutine per registered
// instance and three Admin API calls each, on an endpoint any authenticated
// account can ask for (#330).
package probe

import (
	"context"
	"net"
	"sync"
)

// Slots is how many connections the endpoints a caller waits on may have open
// at once: the connection test, the route test, the WSDL fetch.
//
// OverviewSlots is the overview page's own share. Two buckets rather than one,
// although the resource is one: the overview is a page that refreshes itself,
// and a caller looping it would otherwise take every slot and leave the tests
// somebody is waiting on with none. The host's outbound connections are bounded
// by their sum.
const (
	Slots         = 64
	OverviewSlots = 16
)

var (
	slots         = make(chan struct{}, Slots)
	overviewSlots = make(chan struct{}, OverviewSlots)
)

// Acquire waits for a slot and returns the function that gives it back.
//
// It returns the context's error if the caller goes away, or its request runs
// out of budget, while waiting - so what never got a slot reads as work that
// was not done rather than as an answer.
func Acquire(ctx context.Context) (func(), error) { return acquire(ctx, slots) }

// AcquireOverview waits for one of the overview's own slots.
func AcquireOverview(ctx context.Context) (func(), error) { return acquire(ctx, overviewSlots) }

func acquire(ctx context.Context, pool chan struct{}) (func(), error) {
	select {
	case pool <- struct{}{}:
		return func() { <-pool }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// DialFunc is the shape of net.Dialer.DialContext and of an http.Transport's
// DialContext.
type DialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// Guard returns dial with a slot held for as long as the connection is open,
// for the HTTP clients that probe on a caller's behalf.
//
// For as long as it is open, not for the length of the dial: a slot released
// when the handshake finishes bounds how many connections are being opened at
// once and not how many exist, which is not the resource. An overview of eighty
// instances proved it - sixty-four dials at a time, eighty-four connections
// open (#330). A client guarded this way should not keep connections alive
// either: an idle one in the pool would hold a slot for nothing.
func Guard(dial DialFunc) DialFunc {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		release, err := Acquire(ctx)
		if err != nil {
			return nil, err
		}
		conn, err := dial(ctx, network, addr)
		if err != nil {
			release()
			return nil, err
		}
		return &slotConn{Conn: conn, release: release}, nil
	}
}

// slotConn gives its slot back when the connection closes, once however many
// times it is closed.
type slotConn struct {
	net.Conn
	release func()
	once    sync.Once
}

func (c *slotConn) Close() error {
	defer c.once.Do(c.release)
	return c.Conn.Close()
}

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

package probe

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"
)

// fillTheCeiling takes every slot, and gives them back when the test ends.
// Bounded, and registered before the first acquire: a leaked slot must fail
// here rather than park the package until go test's own timeout.
func fillTheCeiling(t *testing.T) (releaseOne func()) {
	t.Helper()

	var held []func()
	t.Cleanup(func() {
		for _, release := range held {
			release()
		}
	})

	for i := range Slots {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		release, err := Acquire(ctx)
		cancel()
		if err != nil {
			t.Fatalf("slot %d of %d: %v - a slot was leaked by an earlier test", i+1, Slots, err)
		}
		held = append(held, release)
	}
	// Releasing from the caller has to come out of the same slice the cleanup
	// walks, or a slot is given back twice and the cleanup waits for a token
	// nobody holds.
	return func() {
		if len(held) == 0 {
			return
		}
		held[len(held)-1]()
		held = held[:len(held)-1]
	}
}

func TestAcquireHoldsAtItsCeiling(t *testing.T) {
	releaseOne := fillTheCeiling(t)
	if got := InFlight(); got != Slots {
		t.Errorf("%d slots taken, want %d", got, Slots)
	}

	// The next one waits rather than opening a connection anyway.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	if _, err := Acquire(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("beyond the ceiling: err %v, want %v", err, context.DeadlineExceeded)
	}
	cancel()

	// And a slot given back lets the next one through.
	releaseOne()
	ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	release, err := Acquire(ctx)
	if err != nil {
		t.Fatalf("after a release: %v", err)
	}
	release()
}

func TestAcquireStopsWhenTheCallerGoesAway(t *testing.T) {
	// Every slot taken, so the next caller is the one waiting.
	fillTheCeiling(t)

	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan error, 1)
	go func() {
		_, err := Acquire(ctx)
		got <- err
	}()
	cancel()

	select {
	case err := <-got:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("err %v, want %v", err, context.Canceled)
		}
	case <-time.After(2 * time.Second):
		t.Error("the waiting caller was not released when its context was")
	}
}

// Guard is what the HTTP clients that probe are built with, so what it allows
// is what they open.
func TestGuardNeverOpensMoreThanTheCeiling(t *testing.T) {
	var mu sync.Mutex
	inFlight, peak, opened := 0, 0, 0

	guarded := Guard(func(_ context.Context, _, _ string) (net.Conn, error) {
		mu.Lock()
		inFlight++
		opened++
		if inFlight > peak {
			peak = inFlight
		}
		mu.Unlock()
		time.Sleep(2 * time.Millisecond)
		mu.Lock()
		inFlight--
		mu.Unlock()
		return nil, errors.New("connection refused")
	})

	// More than the ceiling at once, so a guard that let them through would
	// show it here.
	const callers = Slots * 2
	var wg sync.WaitGroup
	for range callers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = guarded(context.Background(), "tcp", "192.0.2.1:80")
		}()
	}
	wg.Wait()

	mu.Lock()
	gotPeak, gotOpened := peak, opened
	mu.Unlock()
	if gotOpened != callers {
		t.Errorf("opened %d of %d: the guard dropped connections instead of queueing them", gotOpened, callers)
	}
	if gotPeak > Slots {
		t.Errorf("%d connections at once, want at most %d", gotPeak, Slots)
	}
	if gotPeak < 2 {
		t.Errorf("peak of %d: they went one at a time, so this pins nothing", gotPeak)
	}
}

// The connection the guard hands back gives its slot up when it closes, and
// only once however many times it is closed - a second release would hand out a
// slot another caller is holding, and the ceiling would drift upwards with
// every reuse.
func TestGuardedConnectionReleasesOnceOnClose(t *testing.T) {
	guarded := Guard(func(context.Context, string, string) (net.Conn, error) {
		client, server := net.Pipe()
		t.Cleanup(func() { server.Close() })
		return client, nil
	})

	before := InFlight()
	conn, err := guarded(context.Background(), "tcp", "192.0.2.1:80")
	if err != nil {
		t.Fatal(err)
	}
	if got := InFlight(); got != before+1 {
		t.Errorf("%d slots taken while the connection is open, want %d", got, before+1)
	}

	if err := conn.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
	if got := InFlight(); got != before {
		t.Errorf("%d slots taken after the close, want %d", got, before)
	}

	// Closed again, as an http.Transport may: the slot is not given back twice.
	_ = conn.Close()
	if got := InFlight(); got != before {
		t.Errorf("%d slots taken after a second close, want %d - a slot was released twice", got, before)
	}
}

// A dial that fails gives the slot back too.
func TestGuardReleasesWhenTheDialFails(t *testing.T) {
	guarded := Guard(func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("connection refused")
	})

	before := InFlight()
	if _, err := guarded(context.Background(), "tcp", "192.0.2.1:80"); err == nil {
		t.Fatal("want an error")
	}
	if got := InFlight(); got != before {
		t.Errorf("%d slots taken after a failed dial, want %d", got, before)
	}
}

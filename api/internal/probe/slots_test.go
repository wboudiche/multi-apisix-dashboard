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

func TestAcquireHoldsAtItsCeiling(t *testing.T) {
	held := make([]func(), 0, Slots)
	t.Cleanup(func() {
		for _, release := range held {
			release()
		}
	})

	for i := range Slots {
		release, err := Acquire(context.Background())
		if err != nil {
			t.Fatalf("slot %d of %d: %v", i+1, Slots, err)
		}
		held = append(held, release)
	}
	if got := InFlight(); got != Slots {
		t.Errorf("%d slots taken, want %d", got, Slots)
	}

	// The next one waits rather than opening a connection anyway.
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := Acquire(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("beyond the ceiling: err %v, want %v", err, context.DeadlineExceeded)
	}

	// And a slot given back lets the next one through.
	held[0]()
	held = held[1:]
	release, err := Acquire(context.Background())
	if err != nil {
		t.Fatalf("after a release: %v", err)
	}
	held = append(held, release)
}

func TestAcquireStopsWhenTheCallerGoesAway(t *testing.T) {
	// Every slot taken, so the next caller is the one waiting.
	held := make([]func(), 0, Slots)
	for range Slots {
		release, err := Acquire(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, release)
	}
	t.Cleanup(func() {
		for _, release := range held {
			release()
		}
	})

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

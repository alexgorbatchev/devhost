package devtools

import (
	"sync"
	"testing"
	"time"
)

func TestActivityTracker_IsIdle(t *testing.T) {
	tracker := NewActivityTracker()
	timeout := 10 * time.Millisecond

	// Newly created tracker is not idle initially because lastActivity is set to time.Now()
	if tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker not to be idle initially")
	}

	// Wait for more than timeout
	time.Sleep(15 * time.Millisecond)
	if !tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker to be idle after waiting")
	}

	// Recording activity resets the timer
	tracker.RecordActivity()
	if tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker not to be idle immediately after recording activity")
	}

	time.Sleep(15 * time.Millisecond)
	if !tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker to be idle again")
	}
}

func TestActivityTracker_ActiveCount(t *testing.T) {
	tracker := NewActivityTracker()
	timeout := 10 * time.Millisecond

	// Incrementing active connection count keeps tracker from being idle
	tracker.IncrementActive()
	time.Sleep(15 * time.Millisecond)
	if tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker not to be idle while active count > 0")
	}

	// Decrementing active connection count resets the idle timer (F5 drops protection)
	tracker.DecrementActive()
	// Immediately after decrementing to 0, it shouldn't be idle even if we waited before
	if tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker not to be idle immediately after active count drops to 0")
	}

	time.Sleep(15 * time.Millisecond)
	if !tracker.IsIdle(timeout) {
		t.Fatalf("expected tracker to be idle after timeout since active count is 0")
	}
}

func TestActivityTracker_Concurrency(t *testing.T) {
	tracker := NewActivityTracker()
	var wg sync.WaitGroup

	// Concurrently record activity, increment and decrement active count
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tracker.RecordActivity()
			tracker.IncrementActive()
			tracker.DecrementActive()
		}()
	}

	wg.Wait()

	if tracker.activeCount != 0 {
		t.Fatalf("expected active count to be 0, got %d", tracker.activeCount)
	}
}

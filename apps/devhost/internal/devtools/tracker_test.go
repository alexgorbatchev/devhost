package devtools

import (
	"sync"
	"testing"
	"time"
)

func TestActivityTracker_IsIdle(t *testing.T) {
	tracker := NewActivityTracker()
	shortTimeout := 10 * time.Millisecond
	longTimeout := time.Hour

	// Newly created tracker is not idle initially because lastActivity is set to time.Now()
	if tracker.IsIdle(longTimeout) {
		t.Fatalf("expected tracker not to be idle initially")
	}

	// Wait for idle after short timeout
	waitForCondition(t, 5*time.Second, func() bool {
		return tracker.IsIdle(shortTimeout)
	})

	// Recording activity resets the timer
	tracker.RecordActivity()
	if tracker.IsIdle(longTimeout) {
		t.Fatalf("expected tracker not to be idle immediately after recording activity")
	}

	waitForCondition(t, 5*time.Second, func() bool {
		return tracker.IsIdle(shortTimeout)
	})
}

func TestActivityTracker_ActiveCount(t *testing.T) {
	tracker := NewActivityTracker()
	shortTimeout := 10 * time.Millisecond
	longTimeout := time.Hour

	// Incrementing active connection count keeps tracker from being idle
	tracker.IncrementActive()
	tracker.lastActivity.Store(time.Now().Add(-1 * time.Hour).UnixNano())
	if tracker.IsIdle(shortTimeout) {
		t.Fatalf("expected tracker not to be idle while active count > 0")
	}

	// Decrementing active connection count resets the idle timer (F5 drops protection)
	tracker.DecrementActive()
	// Immediately after decrementing to 0, it shouldn't be idle even if we waited before
	if tracker.IsIdle(longTimeout) {
		t.Fatalf("expected tracker not to be idle immediately after active count drops to 0")
	}

	waitForCondition(t, 5*time.Second, func() bool {
		return tracker.IsIdle(shortTimeout)
	})
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

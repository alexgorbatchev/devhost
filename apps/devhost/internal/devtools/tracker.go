package devtools

import (
	"sync"
	"sync/atomic"
	"time"
)

type ActivityTracker struct {
	mu           sync.Mutex
	lastActivity atomic.Int64 // Unix nanoseconds
	activeCount  int32
}

func NewActivityTracker() *ActivityTracker {
	t := &ActivityTracker{}
	t.lastActivity.Store(time.Now().UnixNano())
	return t
}

func (a *ActivityTracker) RecordActivity() {
	a.lastActivity.Store(time.Now().UnixNano())
}

func (a *ActivityTracker) IncrementActive() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.activeCount++
}

func (a *ActivityTracker) DecrementActive() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.activeCount--
	if a.activeCount < 0 {
		a.activeCount = 0
	}
	if a.activeCount == 0 {
		a.lastActivity.Store(time.Now().UnixNano()) // Restarts idle clock for F5 reload/reconnect buffer
	}
}

func (a *ActivityTracker) IsIdle(timeout time.Duration) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if timeout <= 0 {
		return false
	}
	if a.activeCount > 0 {
		return false
	}
	lastAct := time.Unix(0, a.lastActivity.Load())
	return time.Since(lastAct) > timeout
}

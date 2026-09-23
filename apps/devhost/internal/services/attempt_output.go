package services

import (
	"slices"
	"sync"
)

// attemptOutputLines keeps the most recent output lines of one start attempt so a failed start can be classified
// (for example as an auto-port bind collision). The stdout and stderr readers append concurrently.
type attemptOutputLines struct {
	mu    sync.Mutex
	lines []string
}

func (o *attemptOutputLines) append(line string) {
	if o == nil {
		return
	}

	o.mu.Lock()
	defer o.mu.Unlock()
	o.lines = append(o.lines, line)
	if len(o.lines) > maxAttemptOutputLines {
		o.lines = o.lines[len(o.lines)-maxAttemptOutputLines:]
	}
}

func (o *attemptOutputLines) snapshot() []string {
	if o == nil {
		return nil
	}

	o.mu.Lock()
	defer o.mu.Unlock()
	return slices.Clone(o.lines)
}

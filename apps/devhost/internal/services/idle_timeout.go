package services

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// idleWatch shuts the stack down after a stretch with neither routed traffic,
// which Caddy writes to the stack's access log, nor a devtools connection or
// terminal session. A reload can change, start, or stop it.
type idleWatch struct {
	control   *devtools.ControlServer
	logPath   string
	logWriter io.Writer
	label     func() string
	// expired receives the timeout that ran out; the stack loop shuts down.
	expired chan time.Duration

	mu      sync.Mutex
	timeout time.Duration
	cancel  context.CancelFunc
	done    chan struct{}
}

func newIdleWatch(control *devtools.ControlServer, logPath string, logWriter io.Writer, label func() string) *idleWatch {
	return &idleWatch{control: control, logPath: logPath, logWriter: logWriter, label: label, expired: make(chan time.Duration, 1)}
}

// resolveIdleTimeout returns the --idle-timeout flag when it is set, which
// wins over the manifest, and devtools.idleTimeout otherwise.
func resolveIdleTimeout(flag time.Duration, config manifest.DevtoolsConfig) time.Duration {
	if flag > 0 || config.IdleTimeout == "" {
		return flag
	}
	// Validation accepted the manifest, so its duration parses.
	timeout, _ := time.ParseDuration(config.IdleTimeout)
	return timeout
}

// set watches for timeout of idleness, or stops watching when it is zero. The
// idle period starts over, so turning the timeout on later does not shut down
// a stack that was merely quiet before.
func (w *idleWatch) set(timeout time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if timeout == w.timeout {
		return
	}
	w.stopLocked()
	w.timeout = timeout
	if timeout <= 0 {
		writeLogLine(w.logWriter, w.label(), "Idle timeout disabled.")
		return
	}
	writeLogLine(w.logWriter, w.label(), fmt.Sprintf("Idle timeout enabled: %s (will automatically shut down when inactive)", timeout))
	w.truncateLog()
	w.control.Tracker().RecordActivity()
	ctx, cancel := context.WithCancel(context.Background())
	w.cancel, w.done = cancel, make(chan struct{})
	go w.run(ctx, timeout, w.done)
}

func (w *idleWatch) stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked()
	w.timeout = 0
}

func (w *idleWatch) stopLocked() {
	if w.cancel == nil {
		return
	}
	w.cancel()
	<-w.done
	w.cancel, w.done = nil, nil
}

func (w *idleWatch) truncateLog() {
	_ = os.MkdirAll(filepath.Dir(w.logPath), 0o755) // A missing log only delays seeing traffic.
	if runtime.GOOS == "windows" {
		return
	}
	if f, err := os.OpenFile(w.logPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644); err == nil {
		_ = f.Close() // The file is only truncated; a close error loses nothing.
	}
}

// run polls the access log and the activity tracker. Intervals scale with the
// timeout, down to 10ms, so short test timeouts and long ones both work.
func (w *idleWatch) run(ctx context.Context, timeout time.Duration, done chan<- struct{}) {
	defer close(done)
	stat := time.NewTicker(scaledIdleInterval(2*time.Second, timeout))
	defer stat.Stop()
	check := time.NewTicker(scaledIdleInterval(5*time.Second, timeout))
	defer check.Stop()
	var lastModTime time.Time
	if info, err := os.Stat(w.logPath); err == nil {
		lastModTime = info.ModTime()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-stat.C:
			info, err := os.Stat(w.logPath)
			if err != nil {
				continue
			}
			if modTime := info.ModTime(); lastModTime.IsZero() {
				lastModTime = modTime
			} else if modTime.After(lastModTime) {
				lastModTime = modTime
				w.control.Tracker().RecordActivity()
			}
		case <-check.C:
			if w.control.Tracker().IsIdle(timeout) && !w.control.HasActiveTerminalSessions() {
				select {
				case w.expired <- timeout:
				default:
				}
				return
			}
		}
	}
}

func scaledIdleInterval(longest time.Duration, timeout time.Duration) time.Duration {
	if timeout >= longest {
		return longest
	}
	return max(timeout/2, 10*time.Millisecond)
}

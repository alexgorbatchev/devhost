---
created_on: Wed Jun 03 2026
last_modified: Wed Jun 03 2026
status: current
---

# Design Document: Auto-Shutdown Idle Timeout

## Table of Contents

- [1. Objective and non-goals](#1-objective-and-non-goals)
- [2. Current codebase baseline](#2-current-codebase-baseline)
- [3. Non-negotiable constraints](#3-non-negotiable-constraints)
- [4. Exact architecture choice](#4-exact-architecture-choice)
- [5. Data model / schema](#5-data-model--schema)
- [6. Types and contracts](#6-types-and-contracts)
- [7. Exact file plan](#7-exact-file-plan)
- [8. Runtime behavior](#8-runtime-behavior)
- [9. Validation rules](#9-validation-rules)
- [10. Exact API surface](#10-exact-api-surface)
- [11. Implementation order](#11-implementation-order)
- [12. Testing plan](#12-testing-plan)
- [13. Out-of-scope / rejection list](#13-out-of-scope--rejection-list)
- [14. Definition of done](#14-definition-of-done)

---

## 1. Objective and non-goals

### Objective

This design defines an automatic idle-timeout shutdown feature for individual, isolated running instances of the `devhost` background daemon. To prevent background resource leaks (CPU, RAM, battery), the daemon monitors both Caddy proxy application traffic (stack-isolated) and persistent devtools control WebSocket connections. It cleanly terminates the entire stack and all of its managed child processes when no activity has occurred for a configured `--idle-timeout` duration.

### Non-goals

- **No global cross-stack timeout tracking:** The timeout manages only the stack processes and routing ports started by a single `devhost` command instance.
- **No client-side heartbeats:** No polling or heartbeat messages are sent from the browser to keep the daemon alive.

---

## 2. Current codebase baseline

1. **Stack Lifecycle and Supervision:**
   - The Go daemon starts child processes under a `Supervisor` or `Stack` context in `apps/devhost/internal/services/stack.go` and blocks on a `select` statement waiting for process exits or system interrupt signals (SIGINT, SIGTERM, SIGHUP).

2. **Caddy Routing and Logging:**
   - In `apps/devhost/internal/caddy/routes.go`, `renderHostRouteSiteBlock` renders Caddy configuration blocks. Access logging is currently disabled globally (`output discard`) in `caddyfile.go`.

---

## 3. Non-negotiable constraints

- **Isomorphic Isolation (Parallel Stacks Independence):** Multiple `devhost` instances must run completely independently. Caddy access logs must be isolated per stack (e.g. `<caddy-paths>/logs/<stack_name>_access.log`) so that traffic to one project stack does not reset the idle timer of another parallel project.
- **F5 Reload & Reconnect Buffer (F5 Drop Protection):** When a user reloads a browser tab, active WebSockets momentarily drop to 0. If the stack was already idle beyond the timeout, a naive check would instantly shut down the daemon. To prevent this, when active connections drop to 0, `lastActivity` is updated to `time.Now()`, restarting the idle timer and providing a full timeout buffer.
- **Atomic Concurrency (No Go Data Races):** Recording and checking activity timestamps across multiple concurrent goroutines (HTTP handers, WebSocket handlers, and the background monitor ticker) must use thread-safe atomic operations to prevent corrupted timestamp reads and memory panics.
- **No Inode Loss on Caddy Reloads:** Caddy reloads/restarts recreate or truncate log files. To prevent losing track of files (as occurs when `fsnotify` remains bound to deleted/orphaned file inodes), the daemon must use a periodic polling loop (`os.Stat` checking `FileInfo.ModTime()`) to monitor file activity.
- **Windows Portability (Sharing Violations):** On Windows, Caddy's open write handles prevent `devhost` from truncating or modifying log files on startup. The daemon must never attempt to write to or truncate Caddy's active log files; it must only read their metadata (`ModTime`) without locking.
- **Interactive Terminal Protection:** The daemon must never shut down if there is an active interactive terminal session (`ControlServer.terminalSessions`), even if no HTTP requests are arriving.

---

## 4. Exact architecture choice

- Parse `--idle-timeout` (env: `DEVHOST_IDLE_TIMEOUT`) in `manifestOptions`.
- Parse `devtools.idleTimeout` in `devhost.toml` manifest file, permitting configuration directly inside the manifest. Priority of resolution: command-line flag (`--idle-timeout`) > environment variable (`DEVHOST_IDLE_TIMEOUT`) > manifest configuration (`devtools.idleTimeout`).
- Configure Caddy via `routes.go` to log access events per site block to a stack-isolated file: `<caddy-paths>/logs/{{stack_name}}_access.log`.
- Implement a thread-safe `ActivityTracker` struct in `apps/devhost/internal/devtools/tracker.go`:
  ```go
  type ActivityTracker struct {
      mu           sync.Mutex
      lastActivity atomic.Int64 // Unix nanoseconds
      activeCount  int32
  }
  ```
- Use the tracker as a middleware to log requests to the devtools ControlServer, and call `IncrementActive()` / `DecrementActive()` on WebSocket connection lifecycles.
- In `stack.go`, launch a background polling goroutine checking the isolated `<caddy-paths>/logs/<stack_name>_access.log` file's `ModTime` using `os.Stat` every 2 seconds. If the `ModTime` is newer than `lastActivity`, trigger `tracker.RecordActivity()`, resetting the idle timer.
- Run a background ticker in `stack.go` bound to the stack context. Every 5 seconds, query `tracker.IsIdle()`. If idle, and no active terminal sessions remain, trigger a clean stack shutdown.

---

## 5. Data model / schema

No persistent databases or schemas are added or altered. The `devhost.toml` manifest file supports configuring the idle timeout as a flat string property inside the `[devtools]` block:

```toml
[devtools]
idleTimeout = "1m"
```

---

## 6. Types and contracts

### Tracker Implementation (Go)

```go
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
```

### CLI Options Structure Expansion (Go)

```go
type manifestOptions struct {
	ManifestPath *string `descr:"Explicit path to devhost.toml." env:"DEVHOST_MANIFEST" name:"manifest"`
	Verbose      bool    `descr:"Print managed Caddy command output while running a stack." name:"verbose"`
	DevAssetsDir string  `descr:"Filesystem directory path to read devtools assets from dynamically." env:"DEVHOST_DEV_ASSETS_DIR" name:"dev-assets-dir" optional:"true"`
	IdleTimeout  string  `descr:"Idle timeout duration (e.g. 30s, 1m) before the stack automatically shuts down." env:"DEVHOST_IDLE_TIMEOUT" name:"idle-timeout" optional:"true"`
}
```

### Manifest Configuration Schema Expansion (Go)

In `apps/devhost/internal/manifest/types.go`, we extend `DevtoolsConfig`:

```go
type DevtoolsConfig struct {
	Editor           DevtoolsEditorConfig
	ExternalToolbars DevtoolsToggleConfig
	Minimap          DevtoolsMinimapConfig
	Status           DevtoolsStatusConfig
	IdleTimeout      string // mapped to devtools.idleTimeout
}
```

---

## 7. Exact file plan

### Create

- `apps/devhost/internal/devtools/tracker.go`
  - Implements `ActivityTracker`.
- `apps/devhost/internal/devtools/tracker_test.go`
  - Concurrency, atomic timing, and F5 drop protection tests.

### Modify

- `apps/devhost/internal/cli/parse.go`
  - Parses `--idle-timeout`.
- `apps/devhost/internal/cli/parse_test.go`
  - Asserts command parsing and env bindings.
- `apps/devhost/internal/manifest/types.go`
  - Adds `IdleTimeout` to `DevtoolsConfig`.
- `apps/devhost/internal/manifest/validate.go`
  - Allows and parses `idleTimeout` string under the `devtools` section in `validateDevtools()`.
- `apps/devhost/internal/manifest/validate_test.go`
  - Verifies that `devtools.idleTimeout` is parsed and validated successfully.
- `apps/devhost/internal/devtools/server.go`
  - Instantiates `ActivityTracker` and attaches tracker middleware.
- `apps/devhost/internal/caddy/routes.go`
  - Configures Caddy site blocks to write stack-isolated access logs to `<caddy-paths>/logs/{{stack_name}}_access.log`.
- `apps/devhost/internal/services/stack.go`
  - Resolves `idleTimeout` priority: CLI flag > environment variable > manifest config (`manifest.Devtools.IdleTimeout`).
  - On startup, truncates/clears `<caddy-paths>/logs/<stack_name>_access.log`.
  - Spawns an `os.Stat` polling loop on `<caddy-paths>/logs/<stack_name>_access.log` to call `RecordActivity()` upon write.
  - Periodically checks tracker and triggers shutdown on timeout.
- `apps/devhost/internal/app/run.go`
  - Parses `--idle-timeout` into `time.Duration` and passes it to the start stack options. Fallback to manifest value if empty.

---

## 8. Runtime behavior

### Activity Monitoring

1. **HTTP Requests (Control Server):** Middleware calls `RecordActivity()` on any incoming request to the ControlServer.
2. **WebSocket Connections:** WS handler calls `IncrementActive()` on connect, and `DecrementActive()` on close.
3. **Application API & WS Traffic:** Any traffic routed by Caddy to the stack's backend services is logged to `<caddy-paths>/logs/<stack_name>_access.log`. The `os.Stat` poller detects the modification time change and immediately triggers `RecordActivity()`, resetting the idle timer.
4. **Idle Checking:** Every 5 seconds, `stack.go` checks `tracker.IsIdle()` and `!ControlServer.HasActiveTerminalSessions()`. If idle, it initiates a clean, graceful stack teardown.

---

## 9. Validation rules

- **Duration Formats:** Parse durations via `time.ParseDuration` (e.g. `1m`, `1h`). Raise format errors if invalid.
- **Graceful Off:** An idle timeout of `0` or negative values disables auto-shutdown entirely.

---

## 10. Exact API surface

No new HTTP endpoints are added.

---

## 11. Implementation order

1. **CLI & Manifest Parsing:** Implement `--idle-timeout` parsing in `parse.go`/`parse_test.go` and `devtools.idleTimeout` parsing in `validate.go`/`validate_test.go`.
2. **Activity Tracker:** Implement `tracker.go` and `tracker_test.go`.
3. **Caddy Logging:** Enable stack-isolated proxy logging inside `routes.go`.
4. **Log File Poller:** In `stack.go`, initialize `os.Stat` polling on the log path, resolving priority: CLI > env > manifest config.
5. **Stack Ticker:** Add background monitor ticker in `stack.go`.
6. **E2E verification:** Run playground with a short timeout (e.g., `10s`), verify it terminates automatically when inactive and stays alive on direct API traffic.

---

## 12. Testing plan

### Automated Tests

- `tracker_test.go`: Assert concurrent increment/decrements, idle detection, and F5 drop protection resets are 100% thread-safe and race-free.
- `parse_test.go`: Verify duration parse errors are cleanly wrapped.
- `validate_test.go`: Verify `devtools.idleTimeout` is successfully parsed, validated, and mapped from TOML inputs.
- `routes_test.go`: Verify that Caddy proxy blocks are correctly rendered with the stack-isolated logging directive.

### Manual Verification

- Define `idleTimeout = "1m"` inside `devhost.toml` under `[devtools]`.
- Launch playground using `bin/devhost --manifest devhost.toml`.
- Do not open the browser. Run `curl http://playground.localhost/api/...` (direct Caddy-proxied API request).
- Confirm that the background daemon remains alive, resetting the 1-minute idle clock.
- Stop all curl requests, wait 1 minute, and confirm the background daemon executes a clean, graceful cascading teardown.

---

## 13. Out-of-scope / rejection list

- **No heartbeat/client-side pings:** The server coordinates idleness purely via passive access log tracking and control socket connections.
- **No reading/parsing log contents:** The daemon must never read or parse Caddy log files to extract metadata, paths, or response codes. Any modification time update is sufficient to indicate activity, keeping overhead strictly at zero.

---

## 14. Definition of done

- [ ] All unit and integration tests under `apps/devhost/` pass successfully.
- [ ] Auto-shutdown is verified via real timeout triggers.
- [ ] `bun run compile:devhost` builds successfully.
- [ ] Pair with subagent until clean review.

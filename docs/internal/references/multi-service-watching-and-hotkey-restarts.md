---
created_on: 2026-06-03 12:00
last_modified: 2026-10-06 10:04
status: current
---

# Multi-Service File Watching & Hotkey-Driven Restarts

This is the maintained internal reference for the multi-service file watching and hotkey restart lifecycle contract.

## Conceptual Architecture

The multi-service file watching and hotkey restart system has a Go backend and React frontend.

### Go Backend

1. **Manifest Configuration (`internal/manifest`)**:
   - `types.go` and `validate.go` support `watch = [...]` string arrays on service tables and the `[devtools.shortcuts]` configuration.
   - The layout-independent shortcut validator (`isValidShortcut`) defaults invalid shortcut strings to `"alt+ctrl+r"`.

2. **FSNotify Watcher (`internal/services/watch.go`)**:
   - Implements native filesystem watching utilizing `github.com/fsnotify/fsnotify`.
   - Traverses directories recursively via `filepath.WalkDir` on startup, skipping resource-heavy folders like `.git`, `node_modules`, `vendor`, `.next`, `.tmp`, `dist`, `target`, `.workspaces`, `.shadow`, `.agents`, and `build` to protect file descriptor limits.
   - Dynamic subdirectory discovery (new folders are automatically added to watch paths on creation).
   - Catch and gracefully fall back on inotify descriptor warning limit errors (`syscall.ENOSPC`, `syscall.EMFILE`), writing clear sysctl troubleshooting options to `stderr` without panicking.
   - High-precision, per-service event debouncing map (200ms) prevents ws event floods on active file-write storms.

3. **Orchestrator Stack & Timers (`internal/services/stack.go` & `server.go`)**:
   - Sets service `dirty: true` state mapped inside the thread-safe `DirtyTracker`.
   - On manual, hotkey, or programmatic restart, immediately resets `dirty` to `false` and cancels any active, pending debounce timers using `CancelTimer` to bypass compile-reset races.
   - Provides sequential, topological-sorted restart operations based on manifest `serviceOrder`, polling each restarted service's health check (`ResolvedHealthConfig`) to pass before triggering restarts of downstream dependents.
   - Injected config serializes the `primaryService` name and the configured `restartServicesShortcut` shortcut to the frontend.

### Frontend UI Overlay

1. **Services Toolbar Panel (`ServiceStatusPanel.tsx`)**:
   - Observes `service.dirty` and `service.restarting` boolean fields.
   - Summarizes changed services on the toolbar trigger (`N changed`), marks each changed service with a `changed` badge and an amber `"warning"` restart button, disables the button during active restarts, and applies a continuous `animate-spin` on the `RotateCwIcon`.
   - Shows the configured `restartServicesShortcut` in the panel header.
   - Handles unsuccessful HTTP responses, parsing structured JSON or plain text errors from the Go backend.

2. **Global Hotkey Listener (`App.tsx`)**:
   - Registers a document-level event listener bypassing Shadow DOM retargeting using `event.composedPath()[0] || event.target`.
   - Integrates text input lockout, automatically ignoring hotkey triggers when the user focuses on inputs, textareas, selects, or terminal emulator frames (`.xterm`).
   - Uses physical `event.code` mapping for hardware and layout-independent hotkey sequences.

## Configuration reload and recovery

Service file watches mark services changed; they do not restart them automatically. A separate manifest watcher reloads service configuration and include-glob membership. Reloads, service restarts, checkout refresh/switch operations, and full-stack restarts share the runtime operation lock.

Individual manual or hotkey restarts preserve assigned automatic ports. An occupied automatic port leaves the service stopped with an error pointing to **Restart stack with new ports**. That action stops all managed services before relaunching them with fresh automatic ports, rebuilt command/environment references, and updated routes. Fixed ports, selected worktrees, control/document listeners, and terminal sessions are retained. External processes remain untouched, including unrelated listeners on an old service port.

The full-stack action uses the last accepted manifest, attempts restoration after launch or routing failure, and remains retryable if restoration fails. A missing selected checkout must be recovered through the picker before the stack can restart. See the [stack lifecycle guide](../../../packages/docs/src/content/docs/guides/stack-lifecycle.md) for reload boundaries and recovery guarantees.

## Validation Requirements

Future engineers changing or extending this behavior must verify their changes against the following test suites and commands:

### Backend Validation

Run the targeted Go commands below from `apps/devhost/`:

- **Manifest parsing tests**: Verify syntax and fallback defaults by running `go test -v ./internal/manifest/...`
- **FSNotify, Dirty state, and debouncer tests**: Execute `go test -v ./internal/services/...` (asserting `TestWatchManagerDebounceAndDynamicDir`, `TestDirtyTracker`, etc.)
- **Devtools and server mock tests**: Run `go test -v ./internal/devtools/...`
- **Full Backend checks**: Run `just devhost check` from the repository root for formatting, vetting, module hygiene, and app tests.

### Frontend Validation

- **TypeScript, unit tests, and Storybook interactions**: Run `just ui check` from the repository root.

### Complete Repository check

- **Repo-wide formatting, policy, and workspace validation**: Run `just check` from the repository root. Format changes with `just fix`.

---
created_on: 2026-06-03 12:00
last_modified: 2026-06-04 12:00
status: current
---

# Multi-Service File Watching & Hotkey-Driven Parallel Restarts

This is the maintained internal reference for the implemented multi-service file watching & hotkey-driven parallel restarts lifecycle contract.

## Implementation Record

The features outlined in the original design have been successfully implemented and merged into `main` via git merge of commit `0191ab3` (branch `multi-service-watch-hotkey`) on June 03, 2026.

Key commits and branches:

- Branch: `multi-service-watch-hotkey`
- Merge commit: `0191ab3` (merged cleanly into `main`)

## Conceptual Architecture

The multi-service file watching and parallel hotkey restart system is divided into a high-performance Go backend and a highly responsive React frontend.

### Go Backend

1. **Manifest Configuration (`internal/manifest`)**:
   - Extended `types.go` and `validate.go` to support `watch = [...]` string arrays on service tables and the `[devtools.shortcuts]` configuration.
   - Built a robust layout-independent shortcut validator (`isValidShortcut`) defaulting invalid shortcut strings to `"alt+ctrl+r"`.

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

1. **Status Panel Indicator (`ServiceStatusPanel.tsx`)**:
   - Observes `service.dirty` and `service.restarting` boolean fields.
   - Styles the manual restart button with a red `"danger"` variant when dirty, disables the button during active restarts, and applies smooth, continuous `animate-spin` on the `RotateCwIcon`.
   - Incorporates robust, non-blocking error handling for non-200 responses, parsing structured JSON or plain text errors from the Go backend.

2. **Global Hotkey Listener (`App.tsx`)**:
   - Registers a document-level event listener bypassing Shadow DOM retargeting using `event.composedPath()[0] || event.target`.
   - Integrates text input lockout, automatically ignoring hotkey triggers when the user focuses on inputs, textareas, selects, or terminal emulator frames (`.xterm`).
   - Uses physical `event.code` mapping for hardware and layout-independent hotkey sequences.

## Validation Requirements

Future engineers changing or extending this behavior must verify their changes against the following test suites and commands:

### Backend Validation

- **Manifest parsing tests**: Verify syntax and fallback defaults by running `go test -v ./internal/manifest/...`
- **FSNotify, Dirty state, and debouncer tests**: Execute `go test -v ./internal/services/...` (asserting `TestWatchManagerDebounceAndDynamicDir`, `TestDirtyTracker`, etc.)
- **Devtools and server mock tests**: Run `go test -v ./internal/devtools/...`
- **Full Backend Vet suite**: Run `bun run check:devhost` to execute `go vet` and full tests.

### Frontend Validation

- **TypeScript & Unit tests**: Validate frontend compilation and tests via `bun run --cwd packages/devhost-ui check`
- **Storybook / Vitest stories**: Run story play assertions with Vitest inside packages/devhost-ui.

### Complete Repository check

- **Repo-wide format, lints, and build validation**: Execute `bun run check` at the repository root. All files must conform to `oxfmt` standards. If needed, format changes with `bun run fix`.

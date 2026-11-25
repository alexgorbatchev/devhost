---
created_on: 2026-06-03 12:00
last_modified: 2026-11-25 14:30
status: current
---

# Multi-Service File Watching & Hotkey-Driven Restarts

This is the maintained internal reference for the multi-service file watching and hotkey restart lifecycle contract.

## Conceptual Architecture

The multi-service file watching and hotkey restart system has a Rust backend in `apps/devhost/` and a React frontend in `packages/devhost-ui/`.

### Rust Backend

1. **Manifest Configuration (`apps/devhost/src/manifest/`)**:
   - `types.rs` and `validation.rs` support `watch = [...]` string arrays on service tables and the `[devtools.shortcuts]` configuration.
   - Invalid shortcut strings fall back to `"alt+ctrl+r"`.

2. **Filesystem Watcher (`apps/devhost/src/services/watch.rs`)**:
   - Implements native filesystem watching using the `notify` crate.
   - Traverses directories recursively on startup, skipping heavy generated folders (`.git`, `node_modules`, `vendor`, `.next`, `.tmp`, `dist`, `target`, `.workspaces`, `.shadow`, `.agents`, `build`) to protect file descriptor limits.
   - Dynamically discovers newly created subdirectories and adds them to active watch paths.
   - Handles inotify descriptor exhaustion (`ENOSPC` / `EMFILE`) gracefully with actionable stderr diagnostics rather than panicking.
   - Debounces per-service change events (200ms) so write bursts do not flood WebSocket clients.

3. **Stack Runtime & Control Server (`apps/devhost/src/services/stack/runtime.rs` & `apps/devhost/src/devtools/server.rs`)**:
   - Marks changed services `dirty: true` in the stack's shared dirty-service set (`RuntimeHandle`).
   - On manual, hotkey, or programmatic restart, clears `dirty` immediately and cancels pending debounce timers to avoid compile-reset races.
   - Restarts affected services sequentially in manifest dependency order (`resolve_service_order`), waiting for each restarted service's health check before restarting downstream dependents.
   - Injected configuration (`apps/devhost/src/devtools/configuration.rs`) serializes `primaryService` and `restartServicesShortcut` to the frontend.

### Frontend UI Overlay

1. **Services Toolbar Panel (`ServiceStatusPanel.tsx`)**:
   - Observes `service.dirty` and `service.restarting` boolean fields.
   - Summarizes changed services on the toolbar trigger (`N changed`), marks each changed service with a `changed` badge and an amber `"warning"` restart button, disables the button during active restarts, and applies a continuous `animate-spin` on the `RotateCwIcon`.
   - Shows the configured `restartServicesShortcut` in the panel header.
   - Handles unsuccessful HTTP responses, parsing structured JSON or plain text errors from the control server.

2. **Global Hotkey Listener (`App.tsx`)**:
   - Registers a document-level event listener bypassing Shadow DOM retargeting using `event.composedPath()[0] || event.target`.
   - Integrates text input lockout, automatically ignoring hotkey triggers when the user focuses on inputs, textareas, selects, or terminal emulator frames (`.xterm`).
   - Uses physical `event.code` mapping for hardware and layout-independent hotkey sequences.

## Configuration reload and recovery

Service file watches mark services changed; they do not restart them automatically. A separate manifest watcher (`ManifestWatcher` in `apps/devhost/src/services/watch.rs`) reloads service configuration and include-glob membership. Reloads, service restarts, checkout refresh/switch operations, and full-stack restarts are serialized by the stack runtime loop.

Individual manual or hotkey restarts preserve assigned automatic ports. An occupied automatic port leaves the service stopped with an error pointing to **Restart Stack**. That action stops all managed services before relaunching them with fresh automatic ports, rebuilt command/environment references, and updated routes. Fixed ports, selected worktrees, control/document listeners, and chat sessions are retained. External processes remain untouched, including unrelated listeners on an old service port.

The full-stack action uses the last accepted manifest, attempts restoration after launch or routing failure, and remains retryable if restoration fails. A missing selected checkout must be recovered through the picker before the stack can restart. See the [stack lifecycle guide](../../../packages/docs/src/content/docs/guides/stack-lifecycle.md) for reload boundaries and recovery guarantees.

## Validation Requirements

Verify changes against the affected workspace checks from the repository root:

- **Backend unit and integration tests**: `just devhost test` (or `just devhost test --test stack_commands` for focused integration suites) and `just devhost check` (formatting, strict Clippy, script tests, and Rust tests).
- **Frontend unit, browser, and Storybook tests**: `just ui check`.
- **Complete repository check**: `just check` (format changes with `just fix`).

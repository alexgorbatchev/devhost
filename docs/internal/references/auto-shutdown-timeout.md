---
created_on: 2026-06-03 12:00
last_modified: 2026-11-25 14:30
status: current
---

# Reference Document: Auto-Shutdown Idle Timeout

Maintained internal reference for automatic idle-timeout shutdown of individual stacks hosted inside the `devhost` supervisor.

## Overview

Each stack can configure an idle timeout so unused stacks stop automatically instead of holding CPU, memory, and ports in the background. `devhost` monitors three sources of activity per stack:

1. **Stack-isolated Caddy proxy traffic**: Caddy writes access logs per stack to `<state>/caddy/logs/stack-<manifest-hash>_access.log` (or keyed by session name for manifest-free `serve` sessions).
2. **Control server requests and WebSockets**: HTTP requests record activity; open devtools WebSocket streams hold an `ActivityGuard` while connected.
3. **Active native chat turns**: Starting, running, or pending-input chat turns hold a `chat_turn()` `ActivityGuard` even when no browser tab is connected.

When no WebSocket connection or chat turn is active and the time since the last observed activity reaches the configured timeout, the stack shuts down cleanly (stopping only that stack inside the shared supervisor daemon; if it is the last stack, the daemon exits automatically).

## Configuration and precedence

Resolution priority from highest to lowest:

1. CLI flag: `devhost start --idle-timeout <duration>` (`-i <duration>`) parsed in `apps/devhost/src/cli.rs` and `apps/devhost/src/main.rs` (`--idle-timeout` belongs to `start` only).
2. Environment variable: `DEVHOST_IDLE_TIMEOUT`.
3. Manifest setting: `[devtools].idleTimeout` parsed and validated in `apps/devhost/src/manifest/types.rs` and `apps/devhost/src/manifest/validation.rs`.

Durations use shorthand duration syntax (e.g. `30s`, `1m`, `1h`). Zero and negative durations disable idle shutdown. When neither the flag nor `DEVHOST_IDLE_TIMEOUT` overrides the manifest, hot reload updates the active `IdleWatch` timeout in place without restarting services.

## Architecture and runtime ownership

- **Activity tracking (`apps/devhost/src/services/control.rs`)**: `ActivityTracker` wraps a mutex-protected `Activity` state (`last: Option<Instant>`, `connections: usize`, `chat_turns: usize`).
  - `record_activity()` updates `last` to `Instant::now()`.
  - `connection()` and `chat_turn()` return RAII `ActivityGuard` handles that increment the active counter on acquire and decrement it on `Drop`, resetting `last` to `Instant::now()`. Resetting `last` when a browser WebSocket disconnects gives page reloads (`F5`) a full timeout grace buffer rather than triggering an immediate shutdown.
  - `is_idle(timeout)` returns `true` only when `connections == 0`, `chat_turns == 0`, and `last.elapsed() >= timeout`.
- **Caddy access logging (`apps/devhost/src/caddy/routes.rs`)**: `render_site_block` attaches a stack-isolated access log file path (`stack_access_log_name` from the root manifest path so renames keep the same log). Stacks never share an access log file, so traffic to one project never resets another stack's timer.
- **Polling watcher (`apps/devhost/src/services/stack/runtime.rs`)**: `IdleWatch` polls file metadata (`fs::metadata(&self.log_path)?.modified()`) instead of holding filesystem watches that break when Caddy rotates or recreates log files, and never parses log contents.
  - Adaptive intervals: stat polling runs every `min(2s, max(10ms, timeout / 2))` and idle expiration checks run every `min(5s, max(10ms, timeout / 2))`, supporting both sub-second automated tests and long production timeouts with minimal overhead.
  - When `IdleWatch::expired()` fires, the stack runtime loop logs `Idle timeout of <duration> reached` and initiates the normal graceful cascading teardown.
- **Control server integration (`apps/devhost/src/devtools/server.rs`, `src/devtools/streams.rs`, `src/devtools/chat/`)**: Control endpoints call `handle.activity.record_activity()`, WebSocket streams hold `handle.activity.connection()`, and active chat turns hold `handle.activity.chat_turn()`.

## Constraints

- **Per-stack isolation**: Idle tracking is strictly scoped to one stack; sibling stacks in the same shared supervisor daemon keep independent timers and access logs.
- **No client heartbeats**: Browsers do not send keepalive pings; liveness comes purely from passive proxy access-log modification timestamps, open control WebSockets, and active chat turns.
- **Read-only log observation**: `IdleWatch` inspects only modification timestamps (`metadata().modified()`) during polling and never parses log lines.

## Validation

- Unit and integration tests cover `ActivityTracker` guards/F5 reload buffer, shorthand and negative duration parsing, manifest reload updates, stack-isolated Caddy access log rendering, and real idle-timeout shutdowns (`just devhost test`, `just devhost check`, `just devhost coverage`).

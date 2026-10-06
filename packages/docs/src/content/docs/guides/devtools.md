---
title: "Devtools"
sidebar:
  order: 8
---

`devhost` routing works without the browser tooling layer. Enable `devtools` only when you want the injected overlay, service controls, annotations, or component-source navigation on top of routed local apps.

When `devtools` are enabled, routed traffic is split like this:

- `/__devhost__/*` → `devtools` control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path. The control server also owns the websocket status stream used by the injected UI.

The injected `devtools` UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page. The devtools stylesheet is built from Tailwind v4 and shadcn-compatible CSS variables, then installed into that Shadow DOM root at runtime and in Storybook. Tailwind Preflight is scoped to that root only, not to the host document. The shadow host also resets anything the host page's CSS would otherwise pass down (such as letter spacing or text transforms), and all devtools sizes are in pixels, so a host page's root font size does not rescale the UI.

Browsers ignore `@font-face` rules inside a Shadow DOM, so the devtools register their monospace font with the page's font set through the `FontFace` API under a `devhost`-prefixed family name. Font subsets are served separately and downloaded only when needed. This adds no stylesheet to the host document and cannot collide with fonts the host page declares.

The production `inject.js` script contains no instance configuration. Before mounting, it fetches fresh configuration from `/__devhost__/config.json`, which uses `Cache-Control: no-store`. JavaScript and terminal styles are gzip-compressed when the browser accepts gzip. The terminal runtime loads only when a terminal session mounts; minimized sessions stay connected after loading.

Production entry scripts, terminal styles, content-hashed JavaScript chunks, and fonts use one-year immutable browser caching. Unversioned entry and terminal-style URLs redirect without caching to their current content version, so upgrades select fresh assets while unchanged bundles can be reused across stack restarts. In the source-checkout development loop, the entry script stays uncached so page reloads pick up edits.

The injected overlay is a single compact toolbar docked to the right edge of the browser. It shows the stack name, service health, annotation queues, supported third-party devtools toggles, and terminal sessions. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`; toolbar panels open above the toolbar, or below it at `top-right`. Clicking the stack name collapses the toolbar to a single stack-health dot.

The services panel lists every service with its state. Routed services become links automatically, and clicking one opens that service URL in a new browser tab or window by default. Externally owned services are tagged `external`; only `devhost`-managed services expose restart controls. Services with watched file changes are marked `changed` until they restart.

Repository services also share a checkout picker. Opening it or pressing **Refresh** discovers added and deleted Git worktrees. Selecting a checkout restarts that repository's managed services together; repositories containing externally managed services cannot switch checkouts. If the running checkout disappears, its services remain stopped until you select an available checkout; other repositories keep running.

Individual service restarts retain their assigned automatic ports. If a port is occupied, use **Restart stack with new ports** in the Services panel or recovery dialog. It restarts all managed services with fresh automatic ports and rebuilt port references and environments, while retaining fixed ports, selected checkouts, control listeners, and terminal sessions. External processes keep running. Failures display an error and allow another attempt. See [Stack lifecycle](./stack-lifecycle/) for hot reload, restart ordering, and restoration behavior.

When a managed foreground service exits and status devtools are enabled, a full-screen recovery dialog shows the service's exit code, retained stdout/stderr logs, and a **Restart** button. The supervisor and other services keep running. Logs continue updating during recovery; a failed restart displays its error and allows another attempt. The dialog closes when the service recovers. Intentional restarts, failed health probes, and lost control connections alone do not trigger the crash dialog.

Refreshing a root-compatible routed app while its backend is unavailable returns a recovery page with injected devtools. Its restart button works while the app is down, and a successful restart reloads the original URL. Daemon lifecycle and externally managed services use health status instead of foreground exit recovery.

When `[devtools.externalToolbars].enabled = true` (the default), `devhost` also detects supported third-party devtools buttons on the host page, hides the native controls, and re-renders them as toggles in the toolbar. The native panels themselves stay owned by the host tools.

Terminal sessions (annotation agents, annotation commands, and Neovim) appear as chips in the toolbar. Clicking a chip opens its terminal window; minimizing returns it to the chip while the session keeps running and reporting its status. When the chips no longer fit, the rest collapse into a `+N` button that lists every session. Terminal windows open fullscreen; when the log minimap is shown, the window stops at the minimap strip, and hovering the minimap widens it over the terminal with the usual log preview.

Minimap log previews preserve ANSI backgrounds and text decorations. Foreground colors adjust automatically to maintain at least 4.5:1 contrast against the rendered background in either theme, including focused and stderr rows. Dim text is softened only as far as that contrast requirement permits.

When all devtools features are disabled, `devhost` does not mount these control routes for that stack.

For annotation workflows, action configuration, and queue behavior, see [Annotations](./annotations/).

## Control API

Devtools controls are designed for trusted local development. HTTP requests and WebSocket connections use no authentication token. Independent stacks stay isolated through their own control servers, routed hosts, project roots, and terminal session IDs.

### Instance configuration

Before mounting, the browser entry fetches `GET /__devhost__/config.json` from the page's origin with `cache: "no-store"`. The response includes the stack name, project root, enabled features, and UI settings, and uses `Cache-Control: no-store`. The entry rejects unsuccessful responses and configurations with a missing or empty stack name.

Instance configuration is kept out of `inject.js`, lazy JavaScript chunks, fonts, and terminal styles. Content-versioned entry and stylesheet URLs use `?v=` for browser caching. Configuration stays uncached so page reloads pick up the running instance's settings.

### HTTP requests

All paths below are relative to the routed app's origin. Requests with JSON bodies use `Content-Type: application/json`.

| Endpoint                                           | Methods           | Purpose                                                      |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `/__devhost__/terminal-sessions`                   | `GET`, `POST`     | List terminal sessions or start an annotation/editor session |
| `/__devhost__/annotation-queues`                   | `GET`             | List annotation queues                                       |
| `/__devhost__/annotation-queues/<entry-id>`        | `PATCH`, `DELETE` | Edit or delete a queued annotation                           |
| `/__devhost__/annotation-queues/<queue-id>/resume` | `POST`            | Resume an annotation queue                                   |
| `/__devhost__/restart-service`                     | `POST`            | Restart managed services                                     |
| `/__devhost__/restart-stack`                       | `POST`            | Restart all managed services with fresh automatic ports      |
| `/__devhost__/worktrees`                           | `GET`, `POST`     | Refresh worktree state or switch the selected checkout       |
| `/__devhost__/react-highlight/cursor`              | `POST`            | Publish an editor cursor update                              |

Handlers still validate methods, payloads, enabled features, and session state. Malformed requests can produce `400 Bad Request`, unsupported methods produce `405 Method Not Allowed`, and unavailable controls can produce `501 Not Implemented`.

### WebSocket connections

```text
/__devhost__/ws/terminal?sessionId=<session-id>
/__devhost__/ws/annotation-queues
/__devhost__/ws/react-highlight
/__devhost__/ws/health
/__devhost__/ws/logs
```

Use the page's routed host with `ws://` for HTTP or `wss://` for HTTPS. The terminal connection requires the ID of an existing session: a missing `sessionId` produces `400`, and an unknown session produces `404` before the WebSocket upgrade. The injected UI constructs these URLs automatically.

The generated Neovim launcher supplies the instance's cursor-update endpoint through `DEVHOST_REACT_HIGHLIGHT_URL`, together with its project root, stack name, and plugin path. Stopping and starting devhost can change the local control port, so use the current launcher after starting a new instance. Manifest hot reload and **Restart stack with new ports** retain the control port and existing editor connections. See [React Highlight](../react-highlight/) for integration requirements.

Authentication configured by an upstream proxy remains separate. Clients must satisfy that proxy's requirements; a sign-in redirect can prevent a WebSocket connection from reaching devhost.

## Open component source

The shipped Go runtime supports `Alt` + `right-click` component-source navigation whenever `[devtools.editor].enabled = true`.

- When `[devtools.editor].ide = "neovim"`, `devhost` launches Neovim inside the injected xterm terminal, so `nvim` must be available on the machine running `devhost`.
- Other supported editors use their direct external-editor URL launch path instead of the embedded terminal.

Embedded terminal sessions normalize their terminal environment to `TERM=xterm-256color` and `COLORTERM=truecolor` so terminal UIs like Neovim render against the xterm.js emulator instead of inheriting incompatible host-terminal identities. Neovim component-source sessions expand to fill the available viewport when opened as a modal.

## Automatic Idle Timeout

`devhost` supports automatically shutting down the entire stack and all of its managed child processes when no activity has occurred for a configured duration.

This is highly useful for preventing background resource leaks (CPU, RAM, battery) when you are no longer actively developing on the project.

### Configuration

You can configure the idle timeout in three ways, with the following priority of resolution:

1. Command-line flag: `devhost start --idle-timeout <duration>` (e.g. `--idle-timeout 1h`, `--idle-timeout 30s`)
2. Environment variable: `DEVHOST_IDLE_TIMEOUT`
3. Manifest configuration: `devtools.idleTimeout` in `devhost.toml`

For example, to configure a 1-hour idle timeout directly in your manifest:

```toml
[devtools]
idleTimeout = "1h"
```

### How activity is tracked

`devhost` passive activity tracking combines three signals:

- **WebSocket connections:** Any active WS connection to the devhost control server (such as the browser overlay, logs viewer, health monitor) keeps the daemon alive. When browser tabs are closed or reloaded, active WebSockets momentarily drop to 0. To prevent naive instant shutdowns during reloads, the daemon restarts the idle timer on drop to 0, providing a full timeout buffer.
- **Application traffic:** Any HTTP/HTTPS requests proxied by Caddy to your backend services are passively monitored. The daemon periodically polls the modification time of stack-isolated Caddy access logs (`os.Stat` on `<caddy-paths>/logs/<stack_name>_access.log`) without locking, which avoids Windows portability sharing violations.
- **Terminal sessions:** The daemon will never shut down if there is an active interactive terminal session (such as a Neovim integration session), even if no HTTP requests are arriving.

Any of these active signals resets the idle timer. When no activity has been detected for the configured timeout, `devhost` triggers a clean, graceful cascading teardown of all managed services and routing configurations.

On startup, `devhost` prints a status line such as `[stack-name] Idle timeout enabled: 1h (will automatically shut down when inactive)` to confirm the timeout is active. When the idle limit is reached, it logs `[stack-name] Idle timeout of 1h reached. Automatically shutting down the stack...` before stopping services.

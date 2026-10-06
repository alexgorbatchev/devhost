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

The production `inject.js` script contains no instance configuration or control token. Before mounting, it fetches fresh configuration from `/__devhost__/config.json`, which uses `Cache-Control: no-store`. JavaScript and terminal styles are gzip-compressed when the browser accepts gzip. The terminal runtime loads only when a terminal session mounts; minimized sessions stay connected after loading.

Production entry scripts, terminal styles, content-hashed JavaScript chunks, and fonts use one-year immutable browser caching. Unversioned entry and terminal-style URLs redirect without caching to their current content version, so upgrades select fresh assets while unchanged bundles can be reused across stack restarts. In the source-checkout development loop, the entry script stays uncached so page reloads pick up edits.

The injected overlay is a single compact toolbar docked to the right edge of the browser. It shows the stack name, service health, annotation queues, supported third-party devtools toggles, and terminal sessions. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`; toolbar panels open above the toolbar, or below it at `top-right`. Clicking the stack name collapses the toolbar to a single stack-health dot.

The services panel lists every service with its state. Routed services become links automatically, and clicking one opens that service URL in a new browser tab or window by default. Externally owned services are tagged `external`; only `devhost`-managed services expose restart controls. Services with watched file changes are marked `changed` until they restart.

When a managed foreground service exits and status devtools are enabled, a full-screen recovery dialog shows the service's exit code, retained stdout/stderr logs, and a **Restart** button. The supervisor and other services keep running. Logs continue updating during recovery; a failed restart displays its error and allows another attempt. The dialog closes when the service recovers. Intentional restarts, failed health probes, and lost control connections alone do not trigger the crash dialog.

Refreshing a root-compatible routed app while its backend is unavailable returns a recovery page with injected devtools. Its restart button works while the app is down, and a successful restart reloads the original URL. Daemon lifecycle and externally managed services use health status instead of foreground exit recovery.

When `[devtools.externalToolbars].enabled = true` (the default), `devhost` also detects supported third-party devtools buttons on the host page, hides the native controls, and re-renders them as toggles in the toolbar. The native panels themselves stay owned by the host tools.

Terminal sessions (annotation agents, annotation commands, and Neovim) appear as chips in the toolbar. Clicking a chip opens its terminal window; minimizing returns it to the chip while the session keeps running and reporting its status. When the chips no longer fit, the rest collapse into a `+N` button that lists every session. Terminal windows open fullscreen; when the log minimap is shown, the window stops at the minimap strip, and hovering the minimap widens it over the terminal with the usual log preview.

Minimap log previews preserve ANSI backgrounds and text decorations. Foreground colors adjust automatically to maintain at least 4.5:1 contrast against the rendered background in either theme, including focused and stderr rows. Dim text is softened only as far as that contrast requirement permits.

When all devtools features are disabled, `devhost` does not mount these control routes for that stack.

For annotation workflows, action configuration, and queue behavior, see [Annotations](./annotations/).

## Control token

The control token authorizes requests to the running stack's terminal, annotation queue, service restart, worktree, and React Highlight controls. A client must present the current token before these handlers accept a request. It is a bearer credential: possession of the token grants access to the protected controls, subject to the stack's enabled features.

### Lifecycle and delivery

Each control server generates a cryptographically random 128-bit token, encoded as 32 hexadecimal characters, at startup. The token belongs to that running instance; it is shared by its routed services, browser tabs, and editor integration. Independent stacks generate independent tokens. There are no per-user tokens or permission levels.

The token stays valid for the lifetime of the control server, without a separate expiration timer. Restarting the stack generates a fresh token; tokens retained from the previous instance do not authorize the replacement server. Browser clients should reload the routed page after a stack restart, and editor clients should use the current generated launcher.

Before mounting, the browser entry fetches `GET /__devhost__/config.json` from the page's origin with `cache: "no-store"`. The response includes `controlToken` and uses `Cache-Control: no-store`. Configuration retrieval itself does not require a control token. The entry rejects unsuccessful responses and configurations with a missing or empty token.

The generated Neovim launcher supplies the same credential through `DEVHOST_CONTROL_TOKEN`; the plugin uses it when posting cursor updates. See [React Highlight](../react-highlight/) for the launcher and integration requirements.

The token is kept out of `inject.js`, lazy JavaScript chunks, fonts, and terminal styles. Those static assets do not need a token. Their content version parameter, `?v=`, identifies a cacheable asset version; it does not authorize control requests. Never add instance tokens to static asset URLs or cache the configuration response.

### HTTP requests

Protected HTTP endpoints require the token in the `x-devhost-control-token` request header:

```text
x-devhost-control-token: <instance-control-token>
```

All paths below are relative to the routed app's origin:

| Endpoint                                           | Methods           | Purpose                                                      |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| `/__devhost__/terminal-sessions`                   | `GET`, `POST`     | List terminal sessions or start an annotation/editor session |
| `/__devhost__/annotation-queues`                   | `GET`             | List annotation queues                                       |
| `/__devhost__/annotation-queues/<entry-id>`        | `PATCH`, `DELETE` | Edit or delete a queued annotation                           |
| `/__devhost__/annotation-queues/<queue-id>/resume` | `POST`            | Resume an annotation queue                                   |
| `/__devhost__/restart-service`                     | `POST`            | Restart managed services                                     |
| `/__devhost__/worktrees`                           | `GET`, `POST`     | Refresh worktree state or switch the selected checkout       |
| `/__devhost__/react-highlight/cursor`              | `POST`            | Publish an editor cursor update                              |

The HTTP handlers do not accept `?token=` in place of the header. A valid token does not bypass method, payload, feature, or session validation.

### WebSocket connections

Protected WebSockets require the token in the opening request's `token` query parameter:

```text
/__devhost__/ws/terminal?token=<instance-control-token>&sessionId=<session-id>
/__devhost__/ws/annotation-queues?token=<instance-control-token>
/__devhost__/ws/react-highlight?token=<instance-control-token>
```

The terminal connection also needs the ID of an existing session. Use the page's routed host with `ws://` for HTTP or `wss://` for HTTPS. The injected UI constructs these URLs and supplies the token automatically.

The browser's [WebSocket constructor](https://websockets.spec.whatwg.org/#the-websocket-interface) accepts a URL and optional subprotocols, with no option for arbitrary request headers. This is why these connections carry the credential in the URL instead of the HTTP control header. These WebSocket handlers check the query parameter; supplying only `x-devhost-control-token` does not authorize them.

### Failures and troubleshooting

A missing, incorrect, or stale token produces `403 Forbidden` on protected HTTP endpoints. Protected WebSocket handlers perform the same check before upgrading the connection, so an invalid token produces an HTTP `403` instead of a successful WebSocket handshake.

For a `403`, reload the page to fetch the current configuration or relaunch Neovim using the current stack launcher. Check that the client addresses the intended running stack and puts the token in the required header or query parameter. For a valid terminal token, a missing `sessionId` produces `400`; an unknown session produces `404`.

Authentication configured by an upstream proxy is separate. Clients must satisfy that proxy's authentication as well as devhost's token check. A sign-in redirect can prevent a WebSocket connection from reaching devhost at all.

### Security boundary

The control token is not a user login or a restriction on who can read the configuration. Anyone who can retrieve `/__devhost__/config.json` can obtain the token and use the protected controls. Scripts running in the routed page can also read it. The control server listens on loopback, but Caddy exposes its `/__devhost__/*` routes through the routed app host, so loopback binding alone does not restrict access to those proxied routes.

Static assets, configuration, and the `/__devhost__/ws/health` and `/__devhost__/ws/logs` streams do not require the control token. The control server's WebSocket upgrader accepts any Origin; the token checks on protected connections are separate from origin validation. Treat the routed devtools surface as accessible to anyone allowed to reach it, including its configuration and service logs. Use devtools with trusted local apps and restrict access to the routed host when it is reachable by other users or networks.

Treat tokens and WebSocket URLs containing them as credentials. Redact them from shared logs, screenshots, and bug reports. Stop and restart the stack to invalidate a disclosed token for subsequent connections, and reload browser clients or relaunch editor clients against the replacement instance.

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

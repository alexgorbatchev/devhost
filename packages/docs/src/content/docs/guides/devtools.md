---
title: "Devtools"
sidebar:
  order: 8
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/devtools.webp" aria-label="devtools demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/devtools.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Hover the minimap to see live output from your services.</p>
<p>Your stack and services are right in the toolbar.</p>
<p>Browse your repository&#x27;s worktrees without leaving the page.</p>
<p>Native Query devtools are here when you need them.</p>
</details>
<!-- /guide-demo -->

`devhost` routing works without the browser tooling layer. Enable `devtools` only when you want the injected overlay, service controls, annotations, or component-source navigation on top of routed local apps.

When `devtools` are enabled, routed traffic is split like this:

- `/__devhost__/*` → `devtools` control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path. The control server also owns the websocket status stream used by the injected UI.

The injected `devtools` UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page. The devtools stylesheet is built from Tailwind v4 and shadcn-compatible CSS variables, then installed into that Shadow DOM root at runtime and in Storybook. Tailwind Preflight is scoped to that root only, not to the host document. The shadow host also resets anything the host page's CSS would otherwise pass down (such as letter spacing or text transforms), and all devtools sizes are in pixels, so a host page's root font size does not rescale the UI.

Browsers ignore `@font-face` rules inside a Shadow DOM, so the devtools register their monospace font with the page's font set through the `FontFace` API under a `devhost`-prefixed family name. Font subsets are served separately and downloaded only when needed. This adds no stylesheet to the host document and cannot collide with fonts the host page declares.

The production `inject.js` script contains no instance configuration. Before mounting, it fetches fresh configuration from `/__devhost__/config.json`, which uses `Cache-Control: no-store`. JavaScript and terminal styles are gzip-compressed when the browser accepts gzip. The terminal runtime loads only when a terminal session mounts; minimized sessions stay connected after loading.

Production entry scripts, Redux inspector modules/styles, terminal styles, content-hashed JavaScript chunks, and fonts use one-year immutable browser caching. Unversioned entry, inspector-module, and stylesheet URLs redirect without caching to their current content version, so upgrades select fresh assets while unchanged bundles can be reused across stack restarts. In the source-checkout development loop, entry and inspector assets stay uncached so page reloads pick up edits. The native Redux inspector stylesheet loads only in its separate browser popup.

The injected overlay is a single compact toolbar docked to the right edge of the browser. It shows the stack name, service health, annotation queues, supported third-party devtools toggles, and terminal sessions. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`; toolbar panels open above the toolbar, or below it at `top-right`. Clicking the stack name collapses the toolbar to a single stack-health dot.

Every injected surface renders in the browser's top layer: above page content whatever `z-index` or clipping the page uses, and without blocking clicks on the page around it. The surfaces keep one order among themselves, bottom to top: selection and cursor highlights, annotation drafts and the component-source menu, the toolbar, the log minimap, then terminal windows. Toolbar panels and the recovery dialog open above all of them.

When the page opens a popover or a modal dialog, the injected UI moves back above it. A popover inside a web component's shadow root gives the page no signal, so the injected UI moves above it the next time a selection or cursor highlight appears. An open toolbar panel or recovery dialog postpones the move until it closes. While a page's modal dialog is open, the browser makes everything outside that dialog non-interactive, the injected UI included.

The toolbar also shows how much of the machine is in use: **CPU**, **RAM**, and **Disk**, each as percent used. See [Host resource usage](#host-resource-usage).

The services panel lists every started service with its state. Routed services become links automatically, and clicking one opens that service URL in a new browser tab or window by default. Externally owned services are tagged `external`; only `devhost`-managed services expose restart controls. Services with watched file changes are marked `changed` until they restart.

When `devhost start` named the services to run, the panel also shows **Stopped services** with the number of services left out. It opens a list of them; **Start** on a row starts that service and the services it depends on without restarting the ones that run. See [Starting part of a stack](../stack-lifecycle/#starting-part-of-a-stack).

Repository services also share a checkout picker. Opening it or pressing **Refresh** discovers added and deleted Git worktrees. Selecting a checkout restarts that repository's managed services together; repositories containing externally managed services cannot switch checkouts. If the running checkout disappears, its services remain stopped until you select an available checkout; other repositories keep running.

A branch icon beside the toolbar's service count indicates that at least one repository has a non-default branch selected. Hover the service count to see the repository and branch names. Devhost reads the default branch from Git's locally recorded remote `HEAD` references, without contacting a remote or assuming a branch name. The icon stays hidden for detached checkouts and repositories whose default branch is unknown or whose remote defaults disagree. Opening the picker or pressing **Refresh** also refreshes this information.

Individual service restarts retain their assigned automatic ports. If a port is occupied, use **Restart stack with new ports** in the Services panel or recovery dialog. It restarts all managed services with fresh automatic ports and rebuilt port references and environments, while retaining fixed ports, selected checkouts, control listeners, and terminal sessions. External processes keep running. Failures display an error and allow another attempt. See [Stack lifecycle](./stack-lifecycle/) for hot reload, restart ordering, and restoration behavior.

When a managed foreground service exits and status devtools are enabled, a full-screen recovery dialog shows the service's exit code, retained stdout/stderr logs, and a **Restart** button. The supervisor and other services keep running. Logs continue updating during recovery; a failed restart displays its error and allows another attempt. The dialog closes when the service recovers. Intentional restarts, failed health probes, and lost control connections alone do not trigger the crash dialog.

Refreshing a root-compatible routed app while its backend is unavailable returns a recovery page with injected devtools. Its restart button works while the app is down, and a successful restart reloads the original URL. Daemon lifecycle and externally managed services use health status instead of foreground exit recovery.

When `[devtools.externalToolbars].enabled = true` (the default), `devhost` also detects supported third-party devtools buttons on the host page, hides the native controls, and re-renders them as toggles in the toolbar. The native panels themselves stay owned by the host tools.

Native React DevTools uses a separately configured, already running browser profile. Set `[devtools.browser].endpoint` explicitly and choose **Connect browser control** directly in the dock. When a uniquely identified mounted React host and original extension are detected, **React DevTools** opens native DevTools for that document; choose Components or Profiler in the upstream window. **Disconnect browser control** releases devhost resources while preserving that browser-owned window and profile. Collapsing the toolbar preserves the connection. Window presence does not certify live inspection, and native-session loss remains unavailable. Read [Native React DevTools](../architecture/external-devtools/#native-react-devtools) for exact versions, setup, route authority and recovery boundaries.

Terminal sessions (annotation agents, annotation commands, and Neovim) appear as chips in the toolbar. Clicking a chip opens its terminal window; minimizing returns it to the chip while the session keeps running and reporting its status. When the chips no longer fit, the rest collapse into a `+N` button that lists every session, and they return when the toolbar has room again. Terminal windows open fullscreen above the other injected surfaces; when the log minimap is shown, the window stops at the minimap strip. The minimap's hover preview stays beneath an open terminal window, so minimize the terminal to read it.

Minimap log previews preserve ANSI backgrounds and text decorations. Foreground colors adjust automatically to maintain at least 4.5:1 contrast against the rendered background in either theme, including focused and stderr rows. Dim text is softened only as far as that contrast requirement permits.

When all devtools features are disabled, `devhost` does not mount these control routes for that stack.

For annotation workflows, action configuration, and queue behavior, see [Annotations](./annotations/).

## Host resource usage

The toolbar shows three readouts for the machine devhost runs on: **CPU**, **RAM**, and **Disk**. Each is a small bar with the percent used beside it. A readout is on by default and needs no configuration.

| Readout | What it measures                                                             | Read every |
| ------- | ---------------------------------------------------------------------------- | ---------- |
| CPU     | Share of all logical CPUs that was busy since the previous reading           | 2 seconds  |
| RAM     | Memory in use, out of the memory installed                                   | 2 seconds  |
| Disk    | Space used across fixed local filesystems, out of the space available to you | 1 minute   |

The bar is neutral below 70%, amber from 70%, and red from 90%, where the number also turns bold. Hover a readout for the figures behind the percentage, such as `RAM: 9.8 of 32 GB used`.

Disk counts each fixed local filesystem once, the way `df` does:

- On Linux, USB-attached drives, drives the kernel marks removable, and loop-mounted images are left out.
- On macOS, the startup disk is reported. Other internal disks are not counted.

### Configuration

`[devtools.resources]` changes what is shown and how often it is read:

```toml
[devtools.resources]
# Turn every readout off. devhost then samples nothing.
enabled = true
# Read all three at one rate.
pollInterval = "5s"

[devtools.resources.cpu]
# Override the shared rate for one readout.
pollInterval = "1s"

[devtools.resources.memory]
# Hide one readout.
enabled = false

[devtools.resources.disk]
pollInterval = "10m"
```

- `pollInterval` is a duration string such as `"500ms"`, `"5s"`, or `"1m"`, of at least `"250ms"`.
- A readout uses its own `pollInterval` when it has one, then the shared `[devtools.resources].pollInterval`, then its default. A shared interval therefore also replaces the one-minute default for disk.
- `cpu`, `memory`, and `disk` each take `enabled` and `pollInterval`.
- Changing these keys requires restarting devhost.

The readouts appear in the toolbar that the other devtools features bring. With the editor, external toolbars, minimap, and status features all disabled, nothing is injected and no readout is shown.

### When a readout is missing

- A readout that devhost cannot read is hidden, and devhost logs the reason once, for example `devtools disk usage is unavailable: ...`. It returns when a read succeeds.
- While the page has lost its connection to devhost, all three readouts are hidden: a reading that has stopped updating would pass for the current one. They return when the connection reopens.
- A collapsed toolbar hides the readouts.

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
/__devhost__/ws/resources
/__devhost__/ws/native-browser
```

Use the page's routed host with `ws://` for HTTP or `wss://` for HTTPS. The terminal connection requires the ID of an existing session: a missing `sessionId` produces `400`, and an unknown session produces `404` before the WebSocket upgrade. The injected UI constructs these URLs automatically.

The injected UI reopens its health, logs, resource usage, annotation queue, React Highlight, and terminal connections when they are lost, for example after the machine sleeps or devhost restarts behind the same host. It tries again after one second and doubles the wait after each failed attempt, up to ten seconds. The native browser-control connection is the exception: it reconnects only when you choose **Connect browser control** again.

While a connection is down:

- the Services panel shows every service as unavailable
- the minimap keeps the log entries it already has
- the CPU, memory, and disk readouts disappear, because a reading that has stopped updating would pass for the current one
- the queue panel reports that its stream is disconnected
- React Highlight shows no highlight until the editor reports its cursor again
- a terminal shows `disconnected` and keeps its output

Each recovers when its connection reopens. A reattached terminal replaces its output with the session's retained output. A terminal stops reconnecting when its session has finished or is gone, and then reports that the session is no longer running.

devhost ends a connection with a WebSocket close frame. It closes with `1001` (going away) when the stack stops, and the injected UI reconnects. It closes a terminal connection with `1000` (normal closure) when the session ends while a page is attached: another page closed it, or the stack stopped. A session that ended while the page was not attached answers `404`, which a browser reports like any failed connection, so the injected UI then asks `GET /__devhost__/terminal-sessions` whether the session is still listed.

An active native browser-control WebSocket also keeps the stack from idle shutdown. Disconnecting releases that activity and restarts the normal idle buffer.

Native browser control negotiates the nonsecret `devhost-native-browser.v1` codec and validates the current routed origin and exact instance/document binding. Fresh uncached configuration publishes only whether it is configured and its current instance identity; the private debugging endpoint is never included.

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

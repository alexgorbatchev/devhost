---
title: "Devtools"
sidebar:
  order: 8
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/devtools.webp" aria-label="devtools demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/devtools.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

`devhost` routing works without the browser tooling layer. Enable `devtools` only when you want the injected overlay, service controls, annotations, or component-source navigation on top of routed local apps.

When `devtools` are enabled, routed traffic is split like this:

- `/__devhost__/*` → `devtools` control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path. The control server also owns the websocket status stream used by the injected UI.

The injected `devtools` UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page. The devtools stylesheet is built from Tailwind v4 and shadcn-compatible CSS variables, then installed into that Shadow DOM root at runtime and in Storybook. Tailwind Preflight is scoped to that root only, not to the host document. The shadow host also resets anything the host page's CSS would otherwise pass down (such as letter spacing or text transforms), and all devtools sizes are in pixels, so a host page's root font size does not rescale the UI. Keys pressed while devtools have focus, in the chat composer or on a devtools button, do not reach the host page, so page shortcuts like Space to play or pause a video leave your typing and devtools controls alone. Click the page to give its shortcuts the keyboard again.

Browsers ignore `@font-face` rules inside a Shadow DOM, so the devtools register their monospace font with the page's font set through the `FontFace` API under a `devhost`-prefixed family name. Font subsets are served separately and downloaded only when needed. This adds no stylesheet to the host document and cannot collide with fonts the host page declares.

The production `inject.js` script contains no instance configuration. Before mounting, it fetches fresh configuration from `/__devhost__/config.json`, which uses `Cache-Control: no-store`. JavaScript and styles are gzip-compressed when the browser accepts gzip.

Production entry scripts, Redux inspector modules/styles, content-hashed JavaScript chunks, and fonts use one-year immutable browser caching. Unversioned entry, inspector-module, and stylesheet URLs redirect without caching to their current content version, so upgrades select fresh assets while unchanged bundles can be reused across stack restarts. In the source-checkout development loop, entry and inspector assets stay uncached so page reloads pick up edits. The native Redux inspector stylesheet loads only in its separate browser popup.

The injected overlay is a compact toolbar docked to the right edge of the browser. It shows the stack name, service health, native CLI chat, and supported third-party devtools toggles. As the viewport narrows, controls wrap into additional rows, including within groups that are wider than the available space. Long stack and branch names truncate visually; hover their buttons for the full names. The toolbar stays beside the log minimap when it is visible. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`; toolbar panels open above their button, or below it at `top-right`. Clicking the stack name collapses the toolbar to a single stack-health dot.

Toolbar panels, including Services, fade out in place when dismissed, staying beside their trigger until the animation finishes. With reduced motion enabled, they close immediately.

Every injected surface renders in the browser's top layer: above page content whatever `z-index` or clipping the page uses, and without blocking clicks on the page around it. The surfaces keep one order among themselves, bottom to top: cursor highlights, the component-source menu, toolbar, log minimap and chat panel, then annotation highlights and drawings, with the floating annotation tools above them. This lets you annotate the devhost UI itself. While selecting, clicks select devhost controls without activating them; Escape restores ordinary interaction. Native toolbar popovers and modal dialogs open in separate top-layer entries above the drawing canvas.

When the page opens a popover or a modal dialog, the injected UI moves back above it. A popover inside a web component's shadow root gives the page no signal, so the injected UI moves above it the next time a selection or cursor highlight appears. An open toolbar panel or recovery dialog postpones the move until it closes; a fading toolbar panel postpones it until its exit animation finishes. While a page's modal dialog is open, the browser makes everything outside that dialog non-interactive, the injected UI included.

The toolbar also shows how much of the machine is in use: **CPU**, **RAM**, and **Disk**, each as percent used. See [Host resource usage](#host-resource-usage).

The services panel lists every started service with its state in two groups: **Applications** for entries with a routed browser URL, followed by **Services** for entries without one. Each list sorts names alphabetically, ignoring case and ordering numbered names naturally (for example, `worker2` before `worker10`). Empty groups are hidden, and health changes do not change the order. Applications become links automatically, and clicking one opens that service URL in a new browser tab or window by default. Routed APIs and tools such as Mailpit also appear under Applications. Externally owned services are tagged `external`; only `devhost`-managed services expose restart controls. Services with watched file changes are marked `changed` until they restart.

When the toolbar shows the `changed` badge, the adjacent reload icon restarts changed managed services without opening the panel. It is disabled while a restart or checkout switch is in progress, or when no changed service is managed. Restart failures appear in the Services panel.

When `devhost start` named the services to run, the panel also shows **Stopped services** with the number of services left out. It opens a list of them; **Start** on a row starts that service and the services it depends on without restarting the ones that run. See [Starting part of a stack](../stack-lifecycle/#starting-part-of-a-stack).

The separate **Worktrees** toolbar button shows the current branch beside its fork icon, including on the default branch. Opening it shows the checkout list immediately under the **Worktrees** heading. For stacks with multiple repositories, use the **Repository** selector in the popout header to choose which list to view. The Services panel keeps Applications and Services grouped by repository. Opening a checkout picker or pressing **Refresh** discovers added and deleted Git worktrees. Selecting a checkout loads its manifest and includes and restarts the entire managed stack. Service names, directories, commands, environments, and routes come from that configuration. Repositories containing externally managed services cannot switch checkouts. If the running checkout disappears, its repository services remain stopped until you select an available checkout.

Use **Find worktree** at the bottom of the popout to fuzzy-search branch names, checkout paths, or detached commit IDs. Matches are ranked by relevance; clear the search to show every checkout again. Filtering keeps your selection and does not restart services. The adjacent **Refresh** button reloads the checkout list. Checkout paths stay on one line and show an ellipsis on the left when space is limited, keeping the end visible; hover over a path to read it in full. Choose a checkout, then press **Switch and restart stack** to apply it.

Unavailable checkouts remain readable but cannot be selected. Click their **unavailable** badge to open the detailed reason in a popover. A missing or invalid checkout manifest or service directory marks that checkout unavailable while service status continues updating. When a configured checkout has no local manifest, it uses its owning stack's manifest, including one outside the service repository; returning to that checkout retains the association. An existing checkout-local manifest takes precedence. New target checkouts use the same manifest path relative to their repository, or its filename at the checkout root when the owning manifest is outside that repository. Availability checks that manifest and its service directories, so a different app layout is supported. A successful switch reloads the current browser URL. If that app no longer has a route, the proxy's 404 page lists available routes. Invalid configurations leave the current stack running; launch failures attempt to restore it. Listener, devtools, worktree enablement, and zombie-management settings must match the running instance.

The **Worktrees** button displays each selected branch; detached checkouts show their abbreviated commit ID. Its fork icon turns red when a selected checkout is unavailable or a repository has an error or blocked operation. Open the panel for details; the toolbar omits unavailable-checkout text. Unavailable alternatives alone leave the icon unchanged. Its tooltip identifies selected non-default branches. Devhost reads the default branch from Git's locally recorded remote `HEAD` references, without contacting a remote or assuming a branch name. Submodule repositories use their actual checkout directories, including when Git lists the main checkout as a metadata directory. The button remains visible for default, detached, and unknown branches whenever repositories are available. Opening the picker or pressing **Refresh** also refreshes this information.

The Services panel has **Restart Changed** and **Restart Stack** buttons aligned to the right with a gap, each sized to its content. **Restart Changed** restarts every service marked changed, or the primary service when none changed; its button shows the configured keyboard shortcut (default **Alt+Ctrl+R**). Hover **Restart Stack** for a tooltip explaining that it restarts all managed services and reassigns automatic ports. Labels, icons, and shortcuts stay together on one line. Shortcut keycaps use muted text; filled buttons use a subdued contrasting keycap.

Individual service restarts retain their assigned automatic ports. If a port is occupied, use **Restart Stack** in the Services panel or recovery dialog. It restarts all managed services with fresh automatic ports and rebuilt port references and environments, while retaining fixed ports, selected checkouts, control listeners, and chat sessions. External processes keep running. Failures display an error and allow another attempt. See [Stack lifecycle](./stack-lifecycle/) for hot reload, restart ordering, and restoration behavior.

When a managed foreground service exits while the stack is running and status devtools are enabled, a full-screen recovery dialog shows the service's exit code, retained stdout/stderr logs, and a **Restart** button. The supervisor and other services keep running. Logs continue updating during recovery; a failed restart displays its error and allows another attempt. The dialog closes when the service recovers. Stack shutdown, intentional restarts, failed health probes, and lost control connections alone do not trigger the crash dialog.

Opening or refreshing a routed app before it is ready returns a standalone startup or recovery page with status, recent logs, and a restart button for managed services. A missing app path also shows this page with HTTP 404 and **Page not found**. Application HTTP 5xx responses show recovery controls and logs even when the app returns an empty body, preserving the original error status. With worktrees enabled, the standalone page includes **Switch worktree** and **Refresh worktrees**, including when the injected toolbar is disabled. This works for aliases and path routes even with devtools disabled. The restart button becomes available after stack initialization; successful recovery reloads the existing tab at its original URL once that path returns neither 404 nor 5xx. API and asset error responses pass through. Devhost does not launch a browser. Daemon lifecycle and externally managed services use health status instead of foreground exit recovery. See [Startup and recovery pages](./stack-lifecycle/#startup-and-recovery-pages).

When `[devtools.externalToolbars].enabled = true` (the default), `devhost` also detects supported third-party devtools buttons on the host page, hides the native controls, and re-renders them as toggles in the toolbar. The native panels themselves stay owned by the host tools.

Native React DevTools uses a separately configured, already running browser profile. Set `[devtools.browser].endpoint` explicitly and choose **Connect browser control** directly in the dock. When a uniquely identified mounted React host and original extension are detected, **React DevTools** opens native DevTools for that document; choose Components or Profiler in the upstream window. **Disconnect browser control** releases devhost resources while preserving that browser-owned window and profile. Tall diagnostics scroll within the space left by the toolbar on short screens. Collapsing the toolbar preserves the connection. Window presence does not certify live inspection, and native-session loss remains unavailable. Read [Native React DevTools](../architecture/external-devtools/#native-react-devtools) for exact versions, setup, route authority and recovery boundaries.

Open **Chat** for native Codex or Claude Code conversations. Use **Select element**, **Arrow**, **Line**, and **Box** to add page context; sending that context requests a browser-approved tab snapshot. The panel can collapse or move between viewport sides while its session remains available. See [Browser chat and page context](./annotations/).

Minimap log previews use the available page width beside the minimap. Service names form a shared column sized to the longest known service name across the service list and buffered logs, including services that have not produced output yet, followed by a gap and the log message. A matching leading `[service] ` prefix is removed from the message so the name appears once. Log messages stay on one row and clip horizontally when needed.

Minimap log previews preserve ANSI backgrounds and text decorations. Foreground colors adjust automatically to maintain at least 4.5:1 contrast against the rendered background in either theme, including focused and stderr rows. Dim text is softened only as far as that contrast requirement permits.

When all devtools features are disabled, `devhost` does not mount these control routes for that stack.

For chat, selected context, drawing tools, and tab sharing, see [Browser chat and page context](./annotations/).

## Host resource usage

The toolbar shows three readouts for the machine devhost runs on: **CPU**, **RAM**, and **Disk**. Each is a small bar with the percent used beside it. A readout is on by default and needs no configuration.

| Readout | What it measures                                                             | Read every |
| ------- | ---------------------------------------------------------------------------- | ---------- |
| CPU     | Share of all logical CPUs that was busy since the previous reading           | 2 seconds  |
| RAM     | Memory in use, out of the memory installed                                   | 2 seconds  |
| Disk    | Space used across fixed local filesystems, out of the space available to you | 1 minute   |

The bar is neutral below 70%, amber from 70%, and red from 90%, where the number also turns bold. Hover a readout for the figures behind the percentage, such as `RAM: 9.8 of 32 GB used`.

Each percentage reserves room for `100%`, including when only one readout is enabled, so changing values and bold critical readings keep the toolbar width stable.

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

The readouts appear in the toolbar that the other devtools features bring. With chat, annotations, editor, external toolbars, minimap, and status features all disabled, nothing is injected and no readout is shown.

### When a readout is missing

- A readout that devhost cannot read is hidden, and devhost logs the reason once, for example `devtools disk usage is unavailable: ...`. It returns when a read succeeds.
- While the page has lost its connection to devhost, all three readouts are hidden: a reading that has stopped updating would pass for the current one. They return when the connection reopens.
- A collapsed toolbar hides the readouts.

## Control API

Devtools controls are designed for trusted local development. HTTP requests and WebSocket connections use no authentication token. Independent stacks stay isolated through their own control servers, routed hosts, project roots, and native chat session IDs.

### Instance configuration

Before mounting, the browser entry fetches `GET /__devhost__/config.json` from the page's origin with `cache: "no-store"`. The response includes the stack name, project root, enabled features, and UI settings, and uses `Cache-Control: no-store`. The entry rejects unsuccessful responses and configurations with a missing or empty stack name.

Instance configuration is kept out of `inject.js`, lazy JavaScript chunks and fonts. Content-versioned entry and stylesheet URLs use `?v=` for browser caching. Configuration stays uncached so page reloads pick up the running instance's settings.

### HTTP requests

All paths below are relative to the routed app's origin. Requests with JSON bodies use `Content-Type: application/json`.

| Endpoint                                         | Methods       | Purpose                                                 |
| ------------------------------------------------ | ------------- | ------------------------------------------------------- |
| `/__devhost__/chat/harnesses?pageURL=<page-url>` | `GET`         | Discover installed native clients and model catalogs    |
| `/__devhost__/chat/sessions`                     | `GET`, `POST` | List sessions or start/resume a native conversation     |
| `/__devhost__/chat/sessions/<id>`                | `DELETE`      | End the owned native process                            |
| `/__devhost__/restart-service`                   | `POST`        | Restart managed services                                |
| `/__devhost__/restart-stack`                     | `POST`        | Restart all managed services with fresh automatic ports |
| `/__devhost__/worktrees`                         | `GET`, `POST` | Refresh worktree state or switch the selected checkout  |
| `/__devhost__/react-highlight/cursor`            | `POST`        | Publish an editor cursor update                         |

Handlers still validate methods, payloads, enabled features, and session state. Malformed requests can produce `400 Bad Request`, unsupported methods produce `405 Method Not Allowed`, and unavailable controls can produce `501 Not Implemented`.

### WebSocket connections

```text
/__devhost__/ws/chat?sessionId=<session-id>
/__devhost__/ws/react-highlight
/__devhost__/ws/health
/__devhost__/ws/logs
/__devhost__/ws/resources
/__devhost__/ws/native-browser
```

Use the page's routed host with ws:// for HTTP or wss:// for HTTPS. Chat requires an existing sessionId: missing IDs produce 400, unknown IDs produce 404 before upgrading. Chat mutations and WebSocket attachments require an Origin matching the request authority. The browser constructs these requests automatically.

Health, logs, resource usage, React Highlight and chat connections reconnect after a loss, retrying from one second up to ten seconds. Services become unavailable while health is disconnected; logs keep buffered entries; resource readings disappear; React Highlight clears its highlight. Chat reconnects through its retained native snapshot and live events. Native browser control reconnects only through its explicit Connect action.

Stack shutdown closes streams with 1001 (going away); explicitly closing a chat session uses 1000 (normal closure). See [Browser chat sessions](../architecture/chat/) for the native event and pending-request contract.

An active native browser-control WebSocket also keeps the stack from idle shutdown. Disconnecting releases that activity and restarts the normal idle buffer.

Native browser control negotiates the nonsecret `devhost-native-browser.v1` codec and validates the current routed origin and exact instance/document binding. Fresh uncached configuration publishes only whether it is configured and its current instance identity; the private debugging endpoint is never included.

Authentication configured by an upstream proxy remains separate. Clients must satisfy that proxy's requirements; a sign-in redirect can prevent a WebSocket connection from reaching devhost.

## Open component source

The shipped Go runtime supports `Alt` + `right-click` component-source navigation whenever `[devtools.editor].enabled = true`.

Supported editors are VS Code, VS Code Insiders, Cursor, and WebStorm. Navigation uses the editor's external URL handler and copies the formatted source path. Source links remap to the selected checkout. There is no embedded terminal or Vim launcher.

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
- **Native chat turns:** An in-flight turn or unanswered native request keeps the stack alive even when its page disconnects. Idle conversations alone do not prevent the configured idle timeout.

Any of these active signals resets the idle timer. When no activity has been detected for the configured timeout, `devhost` triggers a clean, graceful cascading teardown of all managed services and routing configurations.

On startup, `devhost` prints a status line such as `[stack-name] Idle timeout enabled: 1h (will automatically shut down when inactive)` to confirm the timeout is active. When the idle limit is reached, it logs `[stack-name] Idle timeout of 1h reached. Automatically shutting down the stack...` before stopping services.

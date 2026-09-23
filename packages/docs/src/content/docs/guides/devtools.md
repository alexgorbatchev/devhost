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

Browsers ignore `@font-face` rules inside a Shadow DOM, so the devtools register their bundled monospace font with the page's font set through the `FontFace` API under a `devhost`-prefixed family name. This adds no stylesheet to the host document and cannot collide with fonts the host page declares.

The injected overlay is a single compact toolbar docked to the right edge of the browser. It shows the stack name, service health, annotation queues, supported third-party devtools toggles, and terminal sessions. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`; toolbar panels open above the toolbar, or below it at `top-right`. Clicking the stack name collapses the toolbar to a single stack-health dot.

The services panel lists every service with its state. Routed services become links automatically, and clicking one opens that service URL in a new browser tab or window by default. Externally owned services are tagged `external`; only `devhost`-managed services expose restart controls. Services with watched file changes are marked `changed` until they restart.

When `[devtools.externalToolbars].enabled = true` (the default), `devhost` also detects supported third-party devtools buttons on the host page, hides the native controls, and re-renders them as toggles in the toolbar. The native panels themselves stay owned by the host tools.

Terminal sessions (annotation agents, annotation commands, and Neovim) appear as chips in the toolbar. Clicking a chip opens its terminal window; minimizing returns it to the chip while the session keeps running and reporting its status. When the chips no longer fit, the rest collapse into a `+N` button that lists every session.

When all devtools features are disabled, `devhost` does not mount these control routes for that stack.

For annotation workflows, action configuration, and queue behavior, see [Annotations](./annotations/).

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

1. Command-line flag: `--idle-timeout <duration>` (e.g. `--idle-timeout 1h`, `--idle-timeout 30s`)
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

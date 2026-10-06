# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app. Any domain can work as well, as long as it is configured to resolve to the machine running `devhost`.

Documentation: [alexgorbatchev.github.io/devhost](https://alexgorbatchev.github.io/devhost/)

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- waits for health checks before exposing managed routes
- optionally injects browser devtools for logs, service status, annotations, browser-hosted Neovim sessions, hotkey-driven parallel restarts, and aggregated third-party launcher buttons

The injected log minimap is intentionally a compact preview: each log entry stays on a single row and clips horizontally instead of wrapping into a full log viewer.

When selecting page nodes with Alt, the selection rectangle and node label appear above page content, including existing popovers, without blocking page clicks.

With `[devtools.externalToolbars].enabled = true`, the toolbar aggregates host-mounted TanStack Query, TanStack Router, the unified TanStack shell, React Hook Form, and Jotai inspectors. Mount `@tanstack/react-devtools` with its native plugins for one **TanStack** entry; Form, Table, and Pacer inspection stays inside the upstream workspace. Standalone Query and Router keep separate entries. Mount `@hookform/devtools` with each form's control for separate **Form N** launchers, or `jotai-devtools` with each custom store for separate **Jotai N** launchers with native live atoms and history. Disabling aggregation restores native launcher buttons. See [External Devtools](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for tested versions, development setup, shared-shell behavior, detached-window boundaries, and panel identification.

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To print the CLI build version:

```bash
devhost --version
```

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` and `curl` when `[devtools.editor].ide = "neovim"`

When Neovim editor integration is enabled, devhost loads a bundled `devhost-react-highlight.nvim` plugin for that
devhost instance. The plugin streams TSX/JSX cursor locations back to the injected browser overlay through the
instance's local control port and token, so multiple devhost stacks can run at the same time without sharing editor
state. Cursor highlights appear above page content, including existing popovers, without blocking page clicks.
The browser overlay matches React fiber source metadata first and falls back to fetchable source maps for
bundlers that do not expose fiber source locations. While the stack is running, devhost also writes an instance-scoped
shell launcher at `.tmp/devhost/<stack-name>/nvim-shell/bin/devhost-nvim`; run it from the project to open Neovim with
the same plugin, token, and project root as the browser-launched editor.

### Minimal example

Configure your stack in `devhost.toml`, then start it with `devhost start`.

```toml
name = "hello-stack"

[devtools.shortcuts]
restartServices = "alt+ctrl+r"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]
watch = ["src/"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

Most projects should add `devhost start` to the relevant `package.json` so you can run it through the usual dev script from the directory that contains the manifest:

```json
{
  "scripts": {
    "dev": "devhost start"
  }
}
```

Then prepare Caddy once and start your stack:

```bash
devhost caddy download
devhost caddy trust
devhost caddy start
npm run dev
open https://foo.localhost
```

(`pnpm dev`, `yarn dev`, and `bun run dev` work the same way when they invoke the same script.)

To shut down a running stack cleanly, run the `stop` command from the manifest directory, or point to it explicitly:

```bash
devhost stop
# Or with an explicit manifest:
devhost stop --manifest path/to/devhost.toml
```

This scans active registrations and host/port claims, targets the matching running processes, signals them with SIGTERM, waits for them to stop, and falls back to a force-kill if they do not stop within 15 seconds.

After startup, `devhost` prints one line per configured service URL using the format `service-name: url`.

If a foreground service exits, including with exit code `0` or before its startup health check passes, `devhost` keeps running. Other services, routes, retained logs, and restart controls remain available. Services restart only when requested; use `devhost stop`, a shutdown signal, or the configured idle timeout to stop the stack.

With `[devtools.status].enabled = true`, an exited service opens a full-screen recovery overlay in pages with injected devtools. The overlay shows its exit code, retained stdout/stderr logs, and a **Restart** button. Failed restarts keep the overlay open with an error and allow another attempt. Refreshing a root-compatible routed app while its backend is unavailable returns a recovery page with the same devtools; a successful restart reloads that page. Daemon lifecycle services and external services report health without foreground process exit codes. Executable launch errors and health timeouts still fail startup.

A foreground restart completes after the replacement passes its health check and its routes refresh. If a bind collision moves an automatic port, both Caddy and the document-injection proxy use the final port while devtools listeners remain available. A routing failure restores the previous route registration, configuration, and document backend, stops the replacement, and keeps recovery retryable. The restart response and retained service logs include the error; restoration failures are also reported.

### Multiple Domains for One Service

Set `host` to an array to route several domains to the same service process:

```toml
[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = ["app.localhost", "alias.localhost"]
```

Each hostname uses the same port and `path`. The array must contain at least one valid, unique hostname, and every hostname must resolve to the machine running `devhost`. A single string, such as `host = "app.localhost"`, is also accepted.

The first hostname supplies `DEVHOST_HOST`, `{{ services.web.host }}`, and the devtools service link. Startup logs list every routed URL. Annotations from any of the service's domains share its agent queue for the selected annotation action.

All domains follow the service's port when it restarts. If a route refresh fails, `devhost` restores the previous routes for every domain and keeps recovery available in devtools.

### Development Servers That Require a Local Origin

For a development server such as Bun's HTML/HMR server that rejects the public hostname, enable `proxyLocalOrigin` on that service:

```toml
[services.web]
command = ["bun", "src/index.ts"]
bindHost = "127.0.0.1"
port = "auto"
host = "app.localhost"
proxyLocalOrigin = true
```

The option defaults to `false` and requires `host`. When enabled, the backend receives its local socket address in `Host`. Requests with an `Origin` matching `http://` or `https://` plus the incoming public authority receive the local HTTP origin instead. Requests without `Origin` keep it absent; foreign, opaque, and duplicate origins receive `403` before reaching the service. This applies to documents, assets, subpath routes, and WebSocket upgrades, and follows automatic port changes. `X-Forwarded-Host` retains the public authority. Enable it only for services that require local-origin requests; services that use cross-origin API requests should leave it disabled.

The local address comes from the service's `bindHost` and resolved `port`. `bindHost` defaults to `127.0.0.1`; wildcard addresses use loopback for proxy connections (`0.0.0.0` becomes `127.0.0.1`, and `::` becomes `::1`). With `port = "auto"`, the proxy uses the port devhost assigns and exports as `PORT` by default. The app must listen on that address and port. If the app explicitly selects another port, set the service's `port` to match; devhost does not discover the app's listener from its startup output.

Before launching a foreground service, `devhost` checks that its working directory exists and is a directory. If that check fails, the error identifies `services.<name>.cwd`, shows the resolved path, and asks you to check the configured path. Other launch failures show the executable and working directory alongside the underlying operating-system error.

Service and annotation action `cwd` values accept absolute paths or paths relative to the manifest directory. Absolute paths are used directly and may point outside the manifest directory. Relative paths resolve against the manifest directory and must stay within it.

### Git Worktrees

Checkout selection in the Services panel is enabled by default and requires Git on `PATH`. To disable discovery and saved-selection restore:

```toml
[worktrees]
enabled = false
```

Configure service `cwd` values in one checkout per repository. All services in that repository share its selection; other repositories choose independently, and services outside Git keep their configured directories. For example, selecting `/worktrees/cart` for a service configured at `/projects/shop/packages/web` runs it from `/worktrees/cart/packages/web`.

Open **Services**, select the repository's branch button, and choose a checkout. The picker previews every service directory before **Switch and restart**. Paths inside your home directory are displayed with `~/`. Devhost validates all target directories before stopping anything, stops the group in reverse dependency order, and starts it in dependency order. Relative file watches follow the new service directories; absolute watch paths stay absolute. Routes, service names, commands, environment configuration, and the original manifest remain in use. Devhost does not load the selected checkout's manifest.

Selections are stored locally per manifest path and Git repository, shared across browser tabs, and restored before services start on the next devhost run. With no saved choice, devhost uses the checkout containing the configured directories. A missing saved checkout leaves the group stopped with an explicit error; choose another available checkout or **Return to configured checkout**. A failed group launch also leaves the group stopped and retains the selected path. Fix the cause and **Retry**, or return to the configured checkout. Enable `[devtools.status]` and refresh a routed app to access recovery while its backend is down. Refresh the app after a successful switch to load the selected checkout's page.

A repository containing a `managed = false` service cannot switch because devhost does not own that service's process. New browser-launched editors and annotation actions use the selected checkout, remapping configured action directories inside that repository. Existing terminal sessions retain their original directories. A queued handoff to a session from another checkout pauses with an error; resume the queue to launch a session in the selected checkout.

### Zombie Process Recovery (killZombies)

If a previous `devhost` run crashed, got aborted, or left behind dangling child processes (zombies) claiming the same port or public host, `devhost` will automatically clean them up.

By default, `killZombies = true` is enabled at the manifest level. When `devhost` starts, if it detects a host or fixed-port claim that is already active from the **same manifest file path**, it will automatically find the owning process ID (PID), log a message, terminate/kill that process, and successfully reclaim the host or port.

If you wish to disable this behavior and receive a standard port/host collision error instead, you can set `killZombies = false` at the top level of your `devhost.toml`:

```toml
name = "hello-stack"
killZombies = false
```

### Manifest Interpolation

Manifest string values support environment-variable interpolation with `{{ env.NAME }}` placeholders. This applies to
string fields throughout the manifest, including hosts, paths, cwd values, command arguments, labels, and `env` maps.
Placeholder names must start with a letter or underscore and then use letters, digits, or underscores. Other text
stays literal, including malformed `{{ ... }}` sequences, and an unterminated `{{` keeps the rest of that string
literal. Referencing an undefined valid placeholder is a manifest read error, while defined placeholders may expand to
the empty string.

### Late-Binding Service References

In addition to static environment variable interpolation, `devhost` supports late-binding service references using `{{ services.<name>.<property> }}` placeholders. This allows services to dynamically discover configuration (like auto-allocated ports) right before they are launched:

```toml
[services.postgres]
bindHost = "127.0.0.1"
port = "auto"

[services.poc-backend]
env = { DATABASE_URL = "postgres://...@{{ services.postgres.bindHost }}:{{ services.postgres.port }}/..." }
```

For more details see the [Service References Guide](https://alexgorbatchev.github.io/devhost/guides/service-references/) page.

### Manifest Includes

Manifest includes let you split your `devhost` stack configuration across multiple files. This is particularly powerful in monorepo environments, allowing each sub-application or package to define and manage its own services locally:

```toml
# root devhost.toml
name = "my-monorepo-stack"
includes = ["packages/*/devhost.toml", "apps/*/devhost.toml"]
```

Included manifests are recursively parsed, and their services and annotation actions are merged into the root stack. Relative paths for `cwd` and `watch` folders are automatically resolved, and missing `cwd` keys default to the directory of the manifest they were defined in. See the [Manifest Includes Documentation](https://alexgorbatchev.github.io/devhost/guides/manifest-includes/) page for more details.

### Annotation Temporary Files

Set `tempDir` under `[annotation]` to choose the parent directory for annotation JSON,
prompt files, and agent support files shared by all annotation actions:

```toml
[annotation]
tempDir = ".tmp/annotations"
```

This setting belongs alongside your annotation actions. Omit `tempDir` to use the
system temporary directory (`$TMPDIR` when set on Unix, otherwise `/tmp`). Relative
paths resolve against the working directory where you start `devhost`, independently
of the manifest location and action `cwd`; absolute paths are used directly. Set the
option in the root manifest when using includes.

`devhost` creates missing parent directories and a unique private directory for each
session. Session cleanup removes that session's files and directory, leaving the
configured parent and other sessions intact. Directory creation failures are reported
without falling back to another location. Empty values are invalid. This setting does
not change durable queue storage.

### Annotation agents

Browser annotations can launch Pi, Claude Code, OpenCode, or Codex in the embedded devtools terminal.
Agent and command annotation sessions keep running when you reload a page, close a tab, or close
the browser. Reopening a routed page reconnects to existing sessions with retained terminal output.
Running annotation sessions keep the stack alive through its idle timeout. Use the terminal's
terminate action or stop `devhost` to end a running session.
Terminal output is retained from process startup, including output from commands that exit quickly.
For Codex, install and sign in to the [Codex CLI](https://learn.chatgpt.com/docs/cli), then configure:

```toml
[annotation]
defaultAction = "ask-codex"

[[annotation.actions]]
id = "ask-codex"
label = "Ask Codex"
kind = "agent"

[annotation.actions.agent]
adapter = "codex"
args = ["-c", "model_reasoning_effort=high"]
```

Use a Codex CLI version that supports `--no-daemon` and lifecycle hooks; the adapter is validated
against 0.159.2. Devhost hands off the annotation prompt and launches an independent interactive
session with working/finished hooks. Review and trust those hooks using `/hooks` inside the Codex
terminal. Queued annotations wait until the hooks report readiness; they cannot drain while the
hooks are untrusted, disabled, or restricted by a managed-hooks-only policy. Codex retains your
authentication, sandbox, approval, and syntax theme settings. Optional `args` pass Codex CLI flags.
If the initial annotation finishes before you trust the hooks, send another prompt after trusting
them so Codex can report readiness and drain waiting annotations.

See the [annotation guide](https://alexgorbatchev.github.io/devhost/guides/annotations/) for other
adapters, custom commands, and durable queues.

### Service Commands

Service commands are executed directly, not through an implicit shell. In practice that means
`command = ["storybook", "dev", "--port", "$PORT"]` passes the literal string `$PORT` as an argument, while
`command = ["sh", "-c", "exec storybook dev --port \"$PORT\""]` lets the shell expand `$PORT` from the child
process environment. Manifest interpolation still happens before launch, so `{{ env.NAME }}` inside command arguments
is also subject to the manifest interpolation rules above.

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
>
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

On Linux, run `devhost caddy privileged-ports` once before the first HTTPS start if you want Caddy to bind privileged ports without running the whole stack as root.

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
just devhost compile
./apps/devhost/dist/devhost --version
```

That build refreshes the embedded injected devtools bundle and writes the CLI binary to `apps/devhost/dist/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

## Frontend UI development

If you are modifying the injected browser devtools UI (`packages/devhost-ui/`) and want to test your changes instantly without manually rebuilding the Go app or restarting the service stack, you can use the built-in on-demand asset dev loop:

1. Set `DEVHOST_DEV_SOURCE_DIR` to the root of your devhost checkout. A relative path resolves against the manifest directory, so `DEVHOST_DEV_SOURCE_DIR=.` works for the repo-root `devhost.toml`; `just dev` sets it for you.
2. On every browser page refresh, `devhost` checks whether any file under `packages/devhost-ui/src/devtools/` in that checkout is newer than `apps/devhost/internal/devtools/dist/devtools.js`.
3. If so, it runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle`, one build at a time, and serves the fresh bundle once the build finishes.
4. If the build fails, or finishes without writing `devtools.js`, the page shows a `DEVHOST COMPILATION ERROR` banner with the details, and the next reload tries again.
5. If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` exits with an error naming the variable and the missing path.

## AI devhost skill

To install the manifest-authoring and devhost update skill from this repository:

```bash
npx skills add https://github.com/alexgorbatchev/devhost --skill devhost -y
```

Omit `-y` to choose target agents interactively.

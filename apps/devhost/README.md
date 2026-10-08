# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app. Any domain can work as well, as long as it is configured to resolve to the machine running `devhost`.

Documentation: [alexgorbatchev.github.io/devhost](https://alexgorbatchev.github.io/devhost/)

The guides include short videos and text transcripts: start with [routing](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/), [browser devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/), or [annotations and live fixes](https://alexgorbatchev.github.io/devhost/guides/annotations/).

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- waits for health checks before exposing managed routes
- hot-reloads `devhost.toml` and included manifests, adding or removing services and applying configuration edits without restarting devhost
- switches Git worktrees and refreshes added or deleted checkouts from the browser
- recovers services from the browser, with stable ports for individual restarts and **Restart stack with new ports** for automatic-port conflicts
- optionally injects browser devtools for logs, service status, annotations, browser-hosted Neovim sessions, hotkey-driven restarts, and aggregated third-party launcher buttons

The injected log minimap is intentionally a compact preview: each log entry stays on a single row and clips horizontally instead of wrapping into a full log viewer.

The injected devtools appear above page content, including popovers the page opens, without blocking clicks on the page around them. When selecting page nodes with Alt, the selection rectangle and node label stay beneath the annotation draft, toolbar, and terminal windows.

With `[devtools.externalToolbars].enabled = true`, the toolbar aggregates host-mounted TanStack Query, TanStack Router, the unified TanStack shell, React Hook Form, Jotai, and Vue inspectors. Mount `@tanstack/react-devtools` with its native plugins for one **TanStack** entry; Form, Table, and Pacer inspection stays inside the upstream workspace. Standalone Query and Router keep separate entries. Mount `@hookform/devtools` with each form's control for separate **Form N** launchers, or `jotai-devtools` with each custom store for separate **Jotai N** launchers with native live atoms and history. The **Vue** entry uses the host-installed Vue DevTools **9.0.0-beta.1** with its Vite **8.3.3** development host, after native authorization and Vue application mounting; Components, live state, and page selection stay in the native inspector. Hidden hosts and unrelated pages expose no Vue entry. Disabling aggregation restores native launcher buttons without changing panel state. See [External Devtools](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for exact supported combinations, setup, lifecycle, and project boundaries.

The **Redux** entry opens the upstream Redux DevTools browser inspector for explicitly registered Redux Toolkit and native-middleware Zustand stores. Import `/__devhost__/redux.js` from a routed development page and register actual stores; Toolkit requires one upstream instrumented store, and Zustand requires data snapshot/restoration functions that preserve host actions. Store names, live state, actions, and supported replay controls stay in the upstream inspector. No desktop application or installed browser extension is required. An existing extension remains independent; its cursor and cold Zustand history have documented upstream limits. Closing, disabling, or unmounting devhost closes only its own monitor and subscriptions. The [setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/#redux-toolkit-and-zustand) provides the supported versions, examples, and browser policy requirements.

For native React inspection, configure `[devtools.browser].endpoint` for an already running dedicated local browser profile with the original React Developer Tools extension installed before your app loads. Choose **Connect browser control** directly in the dock, then use the separate **React DevTools** button and select **Components** or **Profiler** in Chrome's native window. The dock displays setup, connection, host/extension, window, loss and error information; errors have a **Copy** action. The same connection button reads **Disconnect browser control** while connecting or connected. Collapsing the toolbar hides the command and full diagnostics while preserving its connection and a compact state cue. Connection status and window presence do not prove live inspection. Disconnecting, disabling aggregation, or unmounting devhost releases its connections while your browser and native inspector remain open. The [native React setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/#native-react-devtools) covers exact versions, routing, ownership, tested versions and native-session loss limits.

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To print the CLI build version:

```bash
devhost --version
```

### Shell completion

`devhost completion <shell>` prints a completion script for `bash`, `zsh`, `fish`, or `powershell`. To load it in the current session:

```bash
source <(devhost completion bash)   # bash, with the bash-completion package installed
source <(devhost completion zsh)    # zsh, after compinit
devhost completion fish | source    # fish
```

To keep completion across sessions, write the script to the directory your shell loads completions from; `devhost completion <shell> --help` names that directory for each shell. Add `--no-descriptions` to complete command names without their descriptions.

### Output for agents and scripts

Set `AGENT=1` (`true` and `yes` work too) when an agent or a script reads the output. Help screens become compact `key: value` text without tree glyphs or column padding, and a command that fails ends with one `ERR:` line that carries the whole error:

```console
$ devhost star
[ERROR] unknown command "star" for "devhost"; did you mean "start" or "stop"?
[INFO] Run "devhost --help" for usage.
$ AGENT=1 devhost star
ERR: unknown command "star" for "devhost"; did you mean "start" or "stop"?
```

Without the variable, a failure ends with an `[ERROR]` line and, where `devhost` knows the next step, an `[INFO]` hint. Warnings are split the same way: `[WARN]` for people and `WARN:` for agents. These lines go to stderr, and the exit code is the same in both modes. Stack logs, `--version`, completion scripts, and `devhost caddy print-root-cert` print the same text in both.

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` and `curl` when `[devtools.editor].ide = "neovim"`
- an explicitly configured dedicated Chrome for Testing **154.0.8037.92** profile and original React Developer Tools **8.0.0** for optional native React access; the inspected host must contain mounted React DOM **19.2.5**. Install the extension before loading that host. The browser stays user-owned; `devhost` attaches to its literal-loopback debugging endpoint.

Stopping the last stack removes its routes while retaining the running Caddy instance's configured admin address,
bind host, and HTTP/HTTPS ports. Separate instances keep their own listeners through stack shutdown.

When Neovim editor integration is enabled, devhost loads a bundled `devhost-react-highlight.nvim` plugin for that
devhost instance. The plugin streams TSX/JSX cursor locations back to the injected browser overlay through the
instance's local control port, so multiple devhost stacks can run at the same time without sharing editor
state. Cursor highlights appear above page content, including existing popovers, without blocking page clicks.
The browser overlay matches React fiber source metadata first and falls back to fetchable source maps for
bundlers that do not expose fiber source locations. While the stack is running, devhost also writes an instance-scoped
shell launcher at `.tmp/devhost/<stack-name>/nvim-shell/bin/devhost-nvim`; run it from the project to open Neovim with
the same plugin and project root as the browser-launched editor. Cursor requests use the instance's token-free local endpoint.

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

If a foreground service exits, including with exit code `0` or before its startup health check passes, `devhost` keeps running. Other services, routes, retained logs, and restart controls remain available. Exited services remain stopped until you request recovery or apply a configuration edit affecting them; use `devhost stop`, a shutdown signal, or the configured idle timeout to stop the stack.

With `[devtools.status].enabled = true`, an exited service opens a full-screen recovery overlay in pages with injected devtools. The overlay shows its exit code, retained stdout/stderr logs, and a **Restart** button. Failed restarts keep the overlay open with an error and allow another attempt. Refreshing a root-compatible routed app while its backend is unavailable returns a recovery page with the same devtools; a successful restart reloads that page. Daemon lifecycle services and external services report health without foreground process exit codes. Executable launch errors and health timeouts still fail startup.

When a page loses its connection to devhost, for example after the machine sleeps, the Services panel shows every service as unavailable and the injected UI reconnects on its own, retrying every one to ten seconds. Open terminals reattach to their sessions the same way. devhost also drops a page's connection when the page reads nothing for ten seconds while updates wait for it, for example while it is paused in a debugger; the page reconnects in the same way once it runs again.

A foreground restart preserves its assigned automatic port and completes after the replacement passes its health check and its routes refresh. If the port is occupied, the service remains stopped and the error points to **Restart stack with new ports**. A routing failure restores the previous route registration, configuration, and document backend, stops the replacement, and keeps recovery retryable. The restart response and retained service logs include the error; restoration failures are also reported.

Before launching a foreground service, devhost checks whether its assigned automatic port is available. Startup, manifest reload, and **Restart stack with new ports** retry detected bind collisions with another automatic port, up to three times. Individual restarts retain their assigned port and report a conflict instead.

Use **Restart stack with new ports** in the Services panel or recovery overlay to reassign every managed automatic port. Devhost stops all managed services in reverse dependency order, rebuilds their port references and injected environments, and starts them in dependency order before refreshing routes. Fixed ports, selected worktrees, devtools listeners, and existing terminal sessions are retained; externally managed processes keep running. This action uses the last accepted manifest, so an invalid edit on disk does not block recovery. Launch or routing failures attempt to restore the previous stack and report any restoration errors; another stack restart remains available. Fixed-port conflicts require freeing the configured port or changing its manifest setting.

### Configuration Hot Reload

While `devhost start` is running, saving `devhost.toml` or an included manifest reloads service configuration. Adding or deleting a file matching an `includes` pattern adds or removes its services. Editor saves that replace a file are supported. Unrelated file writes do not trigger or delay a reload. The complete configuration must parse and validate before running services are changed; invalid edits leave the current stack running and print `configuration reload rejected` with the reason.

Service additions, removals, commands, environment, working directories, health checks, dependencies, routes, watch paths, and primary-service selection can reload. Devhost preserves existing automatic ports when the bind address and automatic-port setting remain compatible. It restarts affected services and their dependents in dependency order, stopping them in reverse order first. Services in an affected Git repository restart together in its selected checkout. Changes to the ports exported through `DEVHOST_PORT_*` can require restarting otherwise unchanged services.

Routes and reservations follow the accepted configuration, and open devtools connections and terminal sessions remain available. A failed replacement launch or route update triggers restoration of the previous services and routing. Restoration failures are reported and remain available for explicit recovery; unrelated edits retain stopped services' recovery state. A successful reload prints `configuration reloaded`. Shutdown signals interrupt replacement health waits, stop the replacement, and clean up the stack without launching restoration services.

Changes to `name`, `killZombies`, `[caddy]`, `[devtools]`, `[annotation]`, or `[worktrees].enabled` require stopping and restarting devhost. An edit changing any of these settings is rejected as a whole, including any service changes in that edit. Selecting a worktree continues to use the original manifest and its includes.

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

Opening the picker or pressing **Refresh** discovers added and removed worktrees without editing the manifest. Deleting an inactive checkout does not disturb running services. If the deleted checkout contained the configured service directories, manifest reload retains the known repository and applies their directory offsets in the selected checkout. The original manifest and its includes must remain accessible. If the running checkout disappears, refresh stops its repository's services, retains the selected path with a recovery error, and blocks new editor and annotation launches for that repository until you choose an available checkout. Other repositories stay running.

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
defaultAction = "fix-codex"

[[annotation.actions]]
id = "fix-codex"
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

Use `devhost caddy start --manifest ./devhost.toml` to start the shared proxy with the manifest's
`caddy.global.adminAddress`, `bindHost`, `http`, `httpPort`, and `httpsPort` settings.
Active stack registrations take precedence for the shared admin address, bind host, and listener ports.
Each running stack retains that resolved management binding for route updates and cleanup. Sparse/default
siblings inherit its non-default settings; explicit conflicting non-default requests still fail. Removing
the last HTTP-enabled stack disables HTTP while false/default siblings remain. When the final registration
is removed, cleanup retains the retiring stack's captured listener settings and removes its host snippets;
it leaves the shared Caddy process running until `devhost caddy stop --manifest ./devhost.toml`.
Configure the same custom management settings in manifests that may start after all stacks have stopped;
an empty runtime does not discover a custom endpoint from another manifest.

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
just devhost compile
./apps/devhost/bin/devhost --version
```

That build refreshes the embedded injected devtools bundle and writes the CLI binary to `apps/devhost/bin/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

## Frontend UI development

Production devtools scripts, native Redux inspector styles, terminal styles, lazy terminal chunks, and font subsets are cached for one year at content-versioned URLs. The static entry loads fresh instance configuration from an uncached endpoint before mounting. Font subsets download only when needed, and the terminal runtime loads when a session mounts. The Redux inspector loads its upstream stylesheet in its separate browser window, preserving host-page style isolation.

Devtools controls use no authentication token for trusted local development. Each stack has its own control server and routed hosts. See [Control API](https://alexgorbatchev.github.io/devhost/guides/devtools/#control-api) for instance configuration, endpoints, and failure responses.

If you are modifying the injected browser devtools UI (`packages/devhost-ui/`) and want to test your changes instantly without manually rebuilding the Go app or restarting the service stack, you can use the built-in on-demand asset dev loop:

1. Set `DEVHOST_DEV_SOURCE_DIR` to the root of your devhost checkout. A relative path resolves against the manifest directory, so `DEVHOST_DEV_SOURCE_DIR=.` works for the repo-root `devhost.toml`; `just dev` sets it for you.
2. On every browser page refresh, `devhost` checks whether any file under `packages/devhost-ui/src/devtools/` in that checkout is newer than `apps/devhost/internal/devtools/dist/devtools.js`.
3. If so, it runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle`, one build at a time, and serves the fresh development bundle without caching once the build finishes. Content-hashed chunks from earlier page loads remain available for active tabs.
4. If the build fails, or finishes without writing `devtools.js`, the page shows a `DEVHOST COMPILATION ERROR` banner with the details, and the next reload tries again.
5. If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` exits with an error naming the variable and the missing path.

## AI devhost skill

To install the manifest-authoring and devhost update skill from this repository:

```bash
npx skills add https://github.com/alexgorbatchev/devhost --skill devhost -y
```

Omit `-y` to choose target agents interactively.

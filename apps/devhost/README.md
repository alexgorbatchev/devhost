# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app. Any domain can work as well, as long as it is configured to resolve to the machine running `devhost`.

Documentation: [alexgorbatchev.github.io/devhost](https://alexgorbatchev.github.io/devhost/)

The guides include short videos: start with [routing](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/), [browser devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/), or [annotations and live fixes](https://alexgorbatchev.github.io/devhost/guides/annotations/).

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- serves startup status at service domains and forwards browser pages once health checks pass
- hot-reloads `devhost.toml` and included manifests, adding or removing services and applying configuration edits without restarting devhost
- switches Git worktrees and refreshes added or deleted checkouts from the browser
- recovers services from the browser, with stable ports for individual restarts and **Restart Stack** for automatic-port conflicts
- optionally injects browser devtools for logs, service status, page context and native CLI chat, hotkey-driven restarts, and aggregated third-party launcher buttons

The injected log minimap is intentionally a compact preview: each log entry stays on a single row and clips horizontally instead of wrapping into a full log viewer.

The injected devtools appear above page content, including popovers the page opens, without blocking clicks on the page around them. Selection rectangles and drawings appear above the toolbar and chat panel, so those controls can also be annotated. The floating annotation tools stay actionable; Escape returns to ordinary interaction.

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

Set `AGENT=1` (`true` and `yes` work too) when an agent or a script reads the output. Help screens become compact `key: value` text without tree glyphs or column padding, each listing every command below the one asked about, and a command that fails reports the whole error with `devhost: ERR:`:

```console
$ devhost star
devhost | [ERROR] unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
devhost | [INFO] Run "devhost --help" for usage.
$ AGENT=1 devhost star
devhost: ERR: unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
```

Without the variable, a failure has an `[ERROR]` tag and, where `devhost` knows the next step, an `[INFO]` hint. Warnings use `[WARN]` for people and `WARN:` for agents. These diagnostics go to stderr with the `devhost` prefix, and the exit code is the same in both modes. Human stack and service logs share aligned `name | ` prefixes, distinct terminal colors, and indented wrapping when the output width is known. Agent logs use compact `name: ` prefixes without padding, added colors, or wrapping. Stop-command progress uses the same `devhost` prefix. Devhost-owned diagnostics shorten home-directory paths to `~/`; child output and machine-readable command data retain their original paths. `--version`, completion scripts, and `devhost caddy print-root-cert` print the same text in both.

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- an installed, signed-in Codex or Claude Code CLI for optional browser chat
- an explicitly configured dedicated Chrome for Testing **154.0.8037.92** profile and original React Developer Tools **8.0.0** for optional native React access; the inspected host must contain mounted React DOM **19.2.5**. Install the extension before loading that host. The browser stays user-owned; `devhost` attaches to its literal-loopback debugging endpoint.

Stopping the last stack removes its routes while retaining the running Caddy instance's configured admin address,
bind host, and HTTP/HTTPS ports. Separate instances keep their own listeners through stack shutdown.

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
devhost caddy start
npm run dev
open https://foo.localhost
```

The first `devhost caddy start` installs Caddy's local HTTPS certificate authority into the system trust store, which may ask for your password.

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

With `[devtools.status].enabled = true`, a service that exits while the stack is running opens a full-screen recovery overlay in pages with injected devtools. Stopping the stack does not open this overlay. The overlay shows its exit code, retained stdout/stderr logs, and a **Restart** button. Failed restarts keep the overlay open with an error and allow another attempt. Service domains serve a startup or recovery page before the app is ready, including for path routes and with devtools disabled. The page shows the recorded failure and recent logs, enables **Restart** after stack initialization, and returns the open tab to its original URL when health checks and routing succeed. Devhost does not launch a browser. Executable launch errors and health timeouts keep the stack running for recovery; configuration, ownership, and initial routing errors still stop startup. Daemon lifecycle services and external services report health without foreground process exit codes.

When a page loses its connection to devhost, for example after the machine sleeps, the Services panel shows every service as unavailable and the injected UI reconnects on its own, retrying every one to ten seconds. Chat reconnects to an existing session with its retained events. devhost also drops a page's connection when the page reads nothing for ten seconds while updates wait for it, for example while it is paused in a debugger; the page reconnects in the same way once it runs again.

A foreground restart preserves its assigned automatic port and completes after the replacement passes its health check and its routes refresh. If the port is occupied, the service remains stopped and the error points to **Restart Stack**. A routing failure restores the previous route registration, configuration, and document backend, stops the replacement, and keeps recovery retryable. The restart response and retained service logs include the error; restoration failures are also reported.

Before launching a foreground service, devhost checks whether its assigned automatic port is available. Startup, manifest reload, and **Restart Stack** retry detected bind collisions with another automatic port, up to three times. Individual restarts retain their assigned port and report a conflict instead.

Use **Restart Stack** in the Services panel or recovery overlay to reassign every managed automatic port. Devhost stops all managed services in reverse dependency order, rebuilds their port references and injected environments, and starts them in dependency order before refreshing routes. Fixed ports, selected worktrees, devtools listeners, and existing chat sessions are retained; externally managed processes keep running. This action uses the last accepted manifest, so an invalid edit on disk does not block recovery. Launch or routing failures attempt to restore the previous stack and report any restoration errors; another stack restart remains available. Fixed-port conflicts require freeing the configured port or changing its manifest setting.

### Configuration Hot Reload

While `devhost start` is running, saving `devhost.toml` or an included manifest reloads service configuration. Adding or deleting a file matching an `includes` pattern adds or removes its services. Editor saves that replace a file are supported. Unrelated file writes do not trigger or delay a reload. The complete configuration must parse and validate before running services are changed; invalid edits leave the current stack running and print `configuration reload rejected` with the reason.

Service additions, removals, commands, environment, working directories, health checks, dependencies, routes, watch paths, and primary-service selection can reload. Devhost preserves existing automatic ports when the bind address and automatic-port setting remain compatible. It restarts affected services and their dependents in dependency order, stopping them in reverse order first. Services in an affected Git repository restart together in its selected checkout. Changes to the ports exported through `DEVHOST_PORT_*` can require restarting otherwise unchanged services.

Routes and reservations follow the accepted configuration, and open devtools connections and chat sessions remain available. A failed replacement launch or route update triggers restoration of the previous services and routing. Restoration failures are reported and remain available for explicit recovery; unrelated edits retain stopped services' recovery state. A successful reload prints `configuration reloaded: <files>`, listing the root manifest and all current included manifests relative to the root manifest directory. Shutdown signals interrupt replacement health waits, stop the replacement, and clean up the stack without launching restoration services.

Every setting reloads, including `name`, `killZombies`, `[devtools]`, and `[worktrees].enabled`. A devtools edit restarts no service: open pages apply the new devtools settings without reloading, running chat sessions keep running when chat is turned off, and a page that loaded while every devtools feature was off shows the toolbar once it reloads. Turning worktrees on keeps the running checkout; turning them off while another checkout runs switches the stack back to the root checkout, whose manifest then applies. Selecting a worktree loads its manifest and includes, and the stack takes that manifest's settings, including its name.

### Multiple Domains for One Service

Set `host` to an array to route several domains to the same service process:

```toml
[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = ["app.localhost", "alias.localhost"]
```

Each hostname uses the same port and `path`. The array must contain at least one valid, unique hostname, and every hostname must resolve to the machine running `devhost`. A single string, such as `host = "app.localhost"`, is also accepted.

The first hostname supplies `DEVHOST_HOST`, `{{ services.web.host }}`, and the devtools service link. Startup logs list every routed URL. New chat conversations resolve their checkout from the routed hostname and path.

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

Service `cwd` values accept absolute paths or paths relative to the manifest directory. Absolute paths are used directly and may point outside the manifest directory. Relative paths resolve against the manifest directory and must stay within it.

### Git Worktrees

Checkout selection in the Worktrees toolbar popout is enabled by default and requires Git on `PATH`. To disable discovery and saved-selection restore:

```toml
[worktrees]
enabled = false
```

Configure service `cwd` values in one checkout per repository. Submodule repositories use their actual checkout directories. Open **Worktrees** in the toolbar to see the checkout list directly. For multiple repositories, choose one in the popout header. The current branch stays visible beside the fork icon, including on the default branch; detached checkouts show their abbreviated commit ID. The icon turns red for unavailable selections and repository errors; open the panel for details. **Find worktree** stays at the bottom; unavailable badges open detailed reasons in a popover.

**Switch and restart stack** reads the target checkout's manifest and includes, validates service directories, stops the entire managed stack in reverse dependency order, and starts the target services in dependency order. Configured checkouts without a local manifest use their owning stack's manifest, even when it lives outside their repository. An existing checkout-local manifest takes precedence. New targets use the same repository-relative manifest path, or its filename at the checkout root when the original manifest is outside that repository. Service names, commands, environments, directories, and routes can differ. The stack takes the target manifest's settings, including its name. Subsequent manifest edits reload from the selected checkout. Invalid targets leave the stack running; launch or routing failures attempt to restore the previous stack. Existing chat sessions remain available.

Opening the picker or pressing **Refresh** discovers newly created and deleted worktrees without editing the manifest. Deleting an inactive checkout does not disturb services. If the running checkout disappears, refresh stops its repository services and blocks new tools there until an available checkout is selected.

One active stack selection is saved locally per original manifest path, shared across browser tabs, and restored before the next run starts services. A missing saved checkout leaves its group stopped with a recovery error. Choose an available checkout from the toolbar or standalone recovery page. Successful switches reload the current browser URL; if the old app route is absent, the proxy's 404 page lists the target stack's available routes. Recovery pages also provide checkout selection with the toolbar disabled.

A repository containing a `managed = false` service cannot switch because devhost does not own that service's process. External editor source links and new chat conversations use the selected checkout. Existing chat sessions retain their original directories; start a new conversation after switching when you want the agent to work in the selected checkout.

### Zombie Process Recovery (killZombies)

If a previous `devhost` run crashed, got aborted, or left behind dangling child processes (zombies) claiming the same port or public host, `devhost` will automatically clean them up.

By default, `killZombies = true` is enabled at the manifest level. Startup first rejects a root or included manifest already registered to another running stack in the same state directory, leaving that stack running. During startup or configuration reload, remaining active host or fixed-port claims from the **same manifest file path** are reclaimed by killing their owner. It logs `Stopping zombie PID ...` before the attempt and `Stopped zombie PID ...` after confirming exit, with at most one attempt and message pair per process identity in that claim pass. A failed kill or exit confirmation, including a five-second exit timeout, reports an error and leaves the affected claim unreclaimed.

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

Included manifests are recursively parsed, and their services and groups are merged into the root stack. Relative paths for `cwd` and `watch` folders are automatically resolved, and missing `cwd` keys default to the directory of the manifest they were defined in. See the [Manifest Includes Documentation](https://alexgorbatchev.github.io/devhost/guides/manifest-includes/) page for more details.

### Browser chat and page context

Open **Chat** in the toolbar to talk to your installed Codex or Claude Code CLI. Sign in through that CLI's normal login flow; devhost uses its existing account, settings, and selected checkout. Harness and model choices in **Chat Settings** come from the native clients. **Configured default** preserves the model in your CLI configuration.

Use **Select Elements** in the floating page toolbar, or hold Alt and click page elements, to add numbered context. **Arrow**, **Line**, and **Box** add drawings you can drag to reposition. Type your request in the chat composer. **Share Tab** beside Send opens the browser's sharing picker; choose the current tab. Sending context takes a fresh PNG snapshot of that share, or asks you to share if needed. Text-only messages do not open the picker. Cancelling sharing retains the draft and context; successful submission clears the accumulated context. Remove items individually or use **Clear Page Context**.

Agent replies stream into the browser conversation, including native tool activity and explicit permission or question requests. Devhost never approves a native request automatically. Interrupt stops the current turn; **Close Conversation** ends that session's owned process. Collapsing chat keeps its session running. Reopening an existing conversation restores its native event history while the stack remains running; stopping devhost ends its processes.

Both features are enabled by default. Set `[devtools.chat].enabled = false` to disable chat, or `[devtools.annotations].enabled = false` to keep plain chat while disabling page selection and drawing controls. The [chat and context guide](https://alexgorbatchev.github.io/devhost/guides/annotations/) covers sharing permissions, authentication failures, native approvals, and selection plugins.

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

The shared proxy's `adminAddress`, `bindHost`, `http`, `httpPort`, and `httpsPort` are settings of the
machine, not of a project: set them in the `[caddy]` table of the devhost config file, `config.toml` in
`$DEVHOST_CONFIG_DIR`, `$XDG_CONFIG_HOME/devhost`, or `~/.config/devhost`. `devhost caddy start` starts the
proxy with them, and every stack applies them when it starts. Saving `config.toml` while stacks run moves
the shared proxy to the new settings without restarting anything, and every running stack's service URLs
follow. An invalid file, or a listener Caddy cannot open, leaves the proxy on the settings it runs and
prints `shared Caddy settings rejected` with the reason. The proxy keeps its settings when the last route
is removed and runs until `devhost caddy stop`.

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
just setup
just devhost compile
./apps/devhost/bin/devhost --version
```

That build refreshes the embedded injected devtools bundle and writes the CLI binary to `apps/devhost/bin/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

Run `just cli <args>` to use the CLI from source. `just run` starts the repository's development stack; `just setup` installs the locked workspace dependencies, downloads the Go modules, and prepares the embedded devtools bundle for both commands.

## Frontend UI development

Production devtools scripts, native Redux inspector styles, lazy JavaScript chunks, and font subsets are cached for one year at content-versioned URLs. The static entry loads fresh instance configuration from an uncached endpoint before mounting. Font subsets download only when needed. The Redux inspector loads its upstream stylesheet in its separate browser window, preserving host-page style isolation.

Devtools controls use no authentication token for trusted local development. Each stack has its own control server and routed hosts. See [Control API](https://alexgorbatchev.github.io/devhost/guides/devtools/#control-api) for instance configuration, endpoints, and failure responses.

If you are modifying the injected browser devtools UI (`packages/devhost-ui/`) and want to test your changes instantly without manually rebuilding the Go app or restarting the service stack, you can use the built-in on-demand asset dev loop:

1. Set `DEVHOST_DEV_SOURCE_DIR` to the root of your devhost checkout. A relative path resolves against the manifest directory, so `DEVHOST_DEV_SOURCE_DIR=.` works for the repo-root `devhost.toml`; `just run` sets it for you.
2. On every browser page refresh, `devhost` checks whether any file under `packages/devhost-ui/src/devtools/` in that checkout is newer than `apps/devhost/internal/devtools/dist/devtools.js`.
3. If so, it runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle`, one build at a time, and serves the fresh development bundle without caching once the build finishes. Content-hashed chunks from earlier page loads remain available for active tabs.
4. If the build fails, or finishes without writing `devtools.js`, the page shows a `DEVHOST COMPILATION ERROR` banner with the details, and the next reload tries again.
5. If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` exits with an error naming the variable and the missing path.

## AI devhost skill

`devhost` provides an AI agent skill covering every command, flag, environment variable, and the rules for writing `devhost.toml`:

```bash
devhost skill
```

The command prints instructions to install the skill via the Skills CLI, together with the skill URL:

```console
$ devhost skill
Install the devhost skill using the Skills CLI:

  npx skills add alexgorbatchev/devhost --skill devhost

Skill:

  https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost
```

Every `AGENT=1` help screen starts with a line that sends the agent to it:

```console
$ AGENT=1 devhost --help
ALERT: Agents must read `AGENT=1 devhost skill` before using this tool.
command: devhost
```

To install the skill directly into your coding agents:

```bash
npx skills add alexgorbatchev/devhost --skill devhost -y
```

Omit `-y` to choose target agents interactively.

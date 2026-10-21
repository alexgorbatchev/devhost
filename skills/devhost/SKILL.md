---
name: devhost
description: Use when running devhost, serving static files or Markdown, routing an existing HTTP port, reading or changing devhost.toml, bootstrapping a manifest, or operating a stack or the shared Caddy proxy.
author: alexgorbatchev
metadata:
  created_on: 2026-06-26 14:23
  last_modified: 2026-10-20 21:52
  status: current
---

## Command Line

Read on-demand devtools asset rebuild notices and every line of compiler diagnostics with the same stack prefix and output formatting as other foreground stack logs.

Run `devhost` with `AGENT=1`: help becomes `key: value` text, and a failed command reports the complete error with `devhost: ERR:`. Without it, a failure uses `devhost | [ERROR]` and, where the next step is known, an `[INFO]` hint with the same prefix. Failure lines and warnings (`WARN:`, or `[WARN]` without `AGENT=1`) go to stderr. Stop-command progress also uses the `devhost` log label. Devhost-owned diagnostics fold home-directory paths to `~` or `~/...`; child output, machine-readable lists, and certificates retain their original bytes and paths. Exit code `0` means success and `1` a failure. `devhost start` ended by a signal exits with `128` plus the signal number: `130` after Ctrl-C, `143` after SIGTERM.

Read lines Caddy writes with the `caddy` log label (`caddy | ` in human mode, `caddy: ` in agent mode) and devhost's messages about Caddy with the `devhost` label. After a successful Caddy command devhost shows Caddy's warnings and errors only; after a failure it shows Caddy's other lines too. It leaves out lines it reports itself or that no setting changes, such as the Firefox and Java trust-store skips of a local CA installation. Successful route reloads are quiet unless `--debug` is selected; failed reloads display diagnostics. Human admin-availability errors give the recovery command, while agent errors also retain the transport detail. For a Linux HTTPS port 443 permission failure, run `devhost caddy privileged-ports`, then `devhost caddy start`. Runtime logs stay in `<state-dir>/caddy/caddy.runtime.log` with Caddy's automatic rotation. Startup `caddy.stdout.log` and `caddy.stderr.log` beside it are replaced on each start. Background Caddy output remains in these files after the command exits.

Read foreground stack logs as `stack-name: message` and child stdout/stderr as `service-name: message` under `AGENT=1` (also `true` or `yes`). These prefixes have one space after the colon and omit alignment padding, added colors, and wrapping. The stack label is the manifest `name`, with `devhost` as the fallback. Retained diagnostics and browser log records keep their bracket prefixes.

With `AGENT=0` or unset, stack and service logs share names padded to a common display width, followed by `|`. Long lines continue with a blank name column and the same aligned separator. Each label has a distinct terminal color shared between stdout and stderr; redirected output, a non-empty `NO_COLOR`, or `TERM=dumb` suppresses added colors. Wrapping uses the destination terminal's current width, falling back to a positive `COLUMNS` value, and preserves child ANSI escapes and Unicode display width. Unknown widths or widths too small for the prefix leave lines unwrapped; resizing applies to subsequent lines.

Read `Switching worktree: source -> target. Restarting stack.` before a checkout switch and `worktree switched: source -> target` after success; source and target are checkout directory names. `Worktree switch failed: source -> target: error` reports rejected targets or switch failures, including restoration errors.

### Commands

- `devhost serve`: serve files with `--dir <directory>` or route an existing HTTP service on `127.0.0.1` with `--port <port>`, over the required `--domain` hostname. With neither option, serve the current directory. HTML pages receive the usual devhost toolbar. File mode reads existing files on each request; port mode checks TCP readiness and leaves process startup, restart, and shutdown to the external owner. The command runs independently of manifests, `DEVHOST_MANIFEST`, build commands, and dependency installation. Caddy starts automatically when needed and remains running after shutdown. Stdout prints the service URL with stack label `serve-<domain>` and service name `serve`. Stop with Ctrl-C (`130`), SIGTERM (`143`), or another shutdown signal. Routes, ownership records, and temporary state are removed on normal exit; runtime files live in devhost's state directory, leaving the working or served directory untouched. Shutdown closes the directory server in file mode and leaves the external service running in port mode. Serve sessions participate in hostname ownership checks and use distinct domains for concurrency. `devhost stack list` and `devhost stop --manifest` address manifest-backed stacks; signal a serve session's devhost process or stop it from its terminal.

Directories serve `index.html`, then `index.md`, then a clickable listing. Ordinary files support GET, HEAD, and byte ranges; missing paths return 404. Markdown (`.md`, case-insensitive) uses GitHub styling, GFM tables, task lists, and strikethrough, following the browser's light/dark preference. Raw HTML and dangerous link destinations are suppressed in rendered Markdown. **Show source** / **Show rendered** toggles original text; browser local storage remembers the choice per origin across pages, reloads, and later sessions. With storage unavailable the toggle works for the current page. Dotfiles, hidden directories, links to hidden paths, links outside the served root, and non-regular files are excluded. Symlinks within the root work. See [file serving](https://alexgorbatchev.github.io/devhost/reference/files/).

Within one devhost state directory, `devhost start` rejects a root or recursively included manifest already registered to another live stack, even with different service selections or `killZombies = true`. Relative paths and symlink aliases resolve to the same file. The startup error uses the `devhost |` prefix for people and `devhost:` for agents, names the conflicting manifest, owner PID, and root manifest, and folds home-directory paths to `~/`. Follow its suggested stop command: `devhost stop` when manifest discovery or `DEVHOST_MANIFEST` selects the owner, or `devhost stop --manifest` with a shell-quoted path otherwise. The `~/` prefix stays unquoted for shell expansion. Stop that stack before retrying. Hot reload reserves added includes before changing services, rejects overlaps while preserving the accepted stack, and releases removed includes after success. Failed reloads retain previous reservations. Exited owners release their reservations for subsequent starts.

- `devhost start [service...]`: start the manifest's services behind their HTTPS hostnames and stay in the foreground. With no `[service...]` argument every service starts. Arguments accept service names and group names from `[groups]`, including a mixture of both. Groups expand to their member services; devhost starts the selected services, every service they reach through `dependsOn`, and every service marked `alwaysStart = true` with its own `dependsOn` chain; the remaining services stay stopped. Shared services start once. A name the manifest lacks fails the command with `unknown service or group` when groups are defined, or `unknown service` otherwise, and the list of defined names. After startup stdout carries stack-labeled messages with one `service-name: url` per routed service that started and `not started: a, b` naming the stopped services when there are any. Stack and child logs use the mode-specific prefixes above. Routes are removed when it exits. Start the shared Caddy first.
- `devhost service list`: print the name of every service in the manifest on stdout, one per line in alphabetical order, in the same form with and without `AGENT=1`. With `--startable` it prints only the services that start when named, leaving out those marked `alwaysStart = true`. Feed the output to a picker: `devhost start $(devhost service list --startable | fzf --multi)`.
- `devhost stop`: stop the running stack of the manifest. It sends SIGTERM to the stack's processes, waits up to 15 seconds, force-kills what remains, and reports each step on stdout. With no stack running from that manifest it says so and exits `0`, and when other stacks are running it adds `Other stacks are running. Run "devhost stack list" to print their PIDs and manifests.`
- `devhost stack list`: print every manifest-backed stack running on the machine on stdout, one per line in manifest path order, in the same form with and without `AGENT=1`. A line is the PID of the stack's devhost process, one tab, and the absolute manifest path, which runs to the end of the line and may hold spaces. It takes no flags, reads no manifest, and prints nothing when no manifest-backed stack runs. Manifest-backed stacks are listed whatever their services are. Take the path with `cut -f2` and pass it to `devhost stop --manifest` to stop that stack from any directory: `devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"`.
- `devhost caddy download`: download the Caddy server devhost manages. Run it once on a machine that has no `caddy` on `PATH`.
- `devhost caddy privileged-ports`: on Linux, let the managed Caddy listen on ports 80 and 443 without root. It downloads Caddy first when needed and runs `sudo setcap` once. On macOS it reports that no setup is needed.
- `devhost caddy start`: start the shared Caddy server in the background. Every stack on the machine routes through it. When the system does not trust Caddy's root certificate, it installs the certificate once, which asks for the user's password at a terminal. Under `AGENT=1` or without a terminal it prints `managed caddy local CA is not trusted, ...` as a warning instead; ask the user to run `devhost caddy trust` in their terminal. `devhost serve` does the same when it starts Caddy, and `devhost start` prints that warning once while the certificate is untrusted.
- `devhost caddy stop`: stop the shared Caddy server.
- `devhost caddy trust`: install Caddy's root certificate into the system trust store, so browsers accept the HTTPS hostnames. It asks for the user's password, needs the shared Caddy running, and reports when the certificate is already trusted.
- `devhost caddy print-root-cert`: print Caddy's root certificate to stdout. The certificate exists after the first `devhost caddy start`.
- `devhost caddy trust-remote <ssh-target>`: on macOS, trust the Caddy certificate of another machine. `<ssh-target>` is an SSH host with `devhost` on its `PATH`, such as `devbox` or `user@devbox`. It prints the certificate's SHA-256 fingerprint and installs the certificate into the System keychain.
- `devhost skill`: print `npx skills add alexgorbatchev/devhost --skill devhost` to install the AI skill via the Skills CLI, followed by the skill URL. Takes no arguments.
- `devhost help [command]`: print the help of a command, the screen `--help` prints for it.
- `devhost completion bash`, `devhost completion fish`, `devhost completion powershell`, `devhost completion zsh`: print a completion script for that shell on stdout. `--no-descriptions` (bool) leaves the command descriptions out of the completions.

`devhost`, `devhost caddy`, `devhost service`, `devhost stack`, and `devhost completion` are groups. Run one without a command to print its help, which lists everything below it.

### Flags and Environment

- `--domain <hostname>`, `-d <hostname>` (string): `devhost serve` only. Required hostname, such as `notes.localhost`, with scheme, port, and path omitted. The empty parser default fails validation. The hostname must resolve to this machine. Invalid or missing values, positional arguments, and `--manifest` are rejected; inaccessible directories fail startup. Use `devhost caddy privileged-ports` once on Linux and `devhost caddy trust` for trusted HTTPS.
- `--dir <directory>` (string): `devhost serve` only. Empty default selects the current directory; relative paths resolve from there. Mutually exclusive with `--port`, including an explicitly empty `--dir`.
- `--port <port>`, `-p <port>` (int): `devhost serve` only. Route HTTP to `127.0.0.1:<port>`. Accepts `1` through `65535`; explicitly passing the parser default `0` fails validation. Omission selects directory mode. Mutually exclusive with `--dir`. Start the upstream separately; Docker services require a host-published port. This routes HTTP rather than arbitrary TCP protocols.

- `--manifest <path>`, `-m <path>` (string): the `devhost.toml` to use; the file must have that name. A relative path resolves against the current directory, and a running stack is identified by the absolute path. Accepted by `devhost start`, `devhost stop`, `devhost service list`, `devhost caddy start`, `devhost caddy stop`, and `devhost caddy trust`. `DEVHOST_MANIFEST` supplies the same path, and the flag wins when both are set. Without either, `devhost start`, `devhost stop`, and `devhost service list` use the nearest `devhost.toml` in the current directory or a parent, looking no higher than the directory that holds `.git`, and the `caddy` commands use the settings of the stacks already running, or the defaults.
- `--debug`, `-d` (bool): `devhost start` only. Show Caddy's own output while the stack runs.
- `--idle-timeout <duration>`, `-i <duration>` (string): `devhost start` only. Stop the stack after this long without traffic, written as a duration such as `30s` or `1m`. `DEVHOST_IDLE_TIMEOUT` supplies the same value, and the flag wins when both are set. Either one takes precedence over `[devtools].idleTimeout` in the manifest.
- `--startable`, `-s` (bool): `devhost service list` only. Print only the services that start when named, which leaves out the services marked `alwaysStart = true`.
- `--help`, `-h` (bool): print the help of the command instead of running it. Accepted by every command.
- `--version`, `-v` (bool): `devhost` only. Print the version alone on one line.

### First Run

```bash
devhost caddy download          # once, on a machine with no caddy on PATH
devhost caddy privileged-ports  # once, on Linux
devhost caddy start             # trusts Caddy's certificate once per machine
devhost start
```

Stop the stack with `devhost stop`, a shutdown signal, or an idle timeout. The shared Caddy keeps running until `devhost caddy stop`.

Stack shutdown preserves the loaded app without opening service-crash recovery. Browser health updates stop when shutdown begins, including results from probes already in flight.

The running stack immediately acknowledges its first shutdown signal, before waiting for in-flight startup or reload work. Under `AGENT=1`, Ctrl-C prints `stack-name: Received SIGINT (Ctrl-C) (signal 2); shutting down the stack.` once; SIGHUP and SIGTERM also name the received signal. The stack prints `stack-name: Stopping service <name>...` before signaling each managed foreground service or running a daemon's stop command, and `stack-name: Stopped service <name>.` after its cleanup succeeds. Human mode uses the aligned stack prefix described above for the same messages. `Stack stopped.` confirms service and routing cleanup completed successfully. Child stdout/stderr remains visible during shutdown, and cleanup failures report the affected services. Signal-driven shutdown retains the signal exit codes listed above.

Read the preceding stack log to explain child signal `15` or exit code `143`: devhost prints the startup health failure before sending `SIGTERM (signal 15)` to a foreground service, names a repository and its services when startup failure stops that group, and announces a signal received by the stack before shutdown. Managed startup progress includes the TCP address or HTTP URL, elapsed time, and configured timeout. TCP failures retain the checked address and, when the other loopback address accepted a connection, a concrete `services.<name>.bindHost` hint in terminal and recovery errors. Verify the listener belongs to the app before applying the suggested `bindHost` setting; the probe establishes connectivity only. The mismatch warning appears once per startup attempt; checks continue against the configured target. HTTP failures name the URL and the required 2xx response.

### Stop a Stack Started Elsewhere

`devhost stop` stops the stack of the manifest it resolves from the current directory. A stack started from another manifest, such as the one named by `<host> is already claimed by PID <pid> from <manifest>.`, is stopped by its manifest path:

```bash
devhost stack list
# 3596463	/home/me/projects/app/.tmp/review/devhost.toml
devhost stop --manifest /home/me/projects/app/.tmp/review/devhost.toml
```

Interactively, pick the stack with `fzf`; `cut -f2` takes the manifest path, the second tab-separated field of the picked line:

```bash
devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"
```

The `references/` files this guide links to are at <https://github.com/alexgorbatchev/devhost/tree/main/skills/devhost/references>.

## Setup and Discovery

Before drafting or updating any manifest configurations, you must run repository discovery and follow domain prompting rules.

Refer to the complete guide: [references/setup.md](references/setup.md)

## Authoring Rules

When modifying or generating configurations inside `devhost.toml`, you **must** strictly adhere to these syntax, casing, and schema validation rules:

### Naming & Casing Conventions (Mandatory)

- **camelCase Rule**: All manifest properties and tables across the entire TOML file **must** use standard `camelCase` naming conventions (e.g., `idleTimeout`, `killZombies`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, etc.). devhost rejects a key written in kebab-case, snake_case, or mixed casing.
- **Service Names**: Service keys inside `[services.<name>]` must match the regex `^[a-z][a-z0-9-]*$`.
- **Service groups**: Define `[groups]` in each app's included manifest, with entries such as `app = ["app-frontend"]`, then run `devhost start app` from the root. Groups merge alongside services and annotation actions. Group names match service naming rules, are unique across included manifests, and are distinct from service names. Members form a non-empty array of service names from the complete merged manifest. Nested groups and unknown members are rejected. `devhost service list` prints individual services only. Selected groups use their current membership on reload; deleting a selected group removes its selection, retaining other requested selections and `alwaysStart` services. Stack restarts retain the requested group names. See [Setup](references/setup.md#6-configuration-hot-reload) for reload behavior.
- **Annotation agent selection**: Set `[annotation].agent = "codex"` in the root manifest to select one built-in agent; accepted strings are `pi`, `claude-code`, `opencode`, and `codex`. This creates one default action with ID `agent` and the adapter's display name. Optional `tempDir` applies. Combining `agent` with `actions` or `defaultAction` is rejected. Use detailed actions for multiple choices, custom commands, or extra flags. Restart devhost to apply annotation changes.
- **Annotation Action IDs**: Action ids under `[[annotation.actions]]` must match the regex `^[a-z][a-z0-9-]*$` and must be unique.

### Top-Level Configurations

- **Managed Caddy lifecycle**: Start the shared proxy with `devhost caddy start --manifest ./devhost.toml`; stop it manually with `devhost caddy stop --manifest ./devhost.toml`. Use matching custom management settings. Read [Setup](references/setup.md#5-managed-caddy-startup) before changing shared settings or starting after all stacks stop; follow its active HTTP votes, captured retirement, and empty-runtime rules.

  Managed Caddy's `caddy.global.bindHost` defaults to `0.0.0.0`, binding all IPv4 and IPv6 interfaces. `caddy.global.http` defaults to `false`, retaining HTTPS-only public routes. The admin API stays on `127.0.0.1:20197`, and service `bindHost` defaults to `127.0.0.1`. Use `foo.localhost` on the dev machine; other devices need a routed hostname resolving to that machine's network address.

- **killZombies Option**: Optional boolean (default `true`) at the top level of `devhost.toml`. When `true`, devhost automatically finds, terminates, and reclaims zombie processes claiming the same ports or hosts from the same manifest path. Each startup or reload claim pass attempts a kill at most once per process identity across route registrations, hostname claims, and fixed-port claims. `Stopping zombie PID ...` precedes the attempt; `Stopped zombie PID ...` confirms exit, with at most one message pair per identity. A failed kill, failed exit check, or five-second exit timeout reports an error and leaves the affected claim unreclaimed; each claim is checked separately. Set `killZombies = false` to disable automatic recovery and report a standard collision error instead.

- **Annotation temporary files**: Set `[annotation].tempDir` in the root manifest to a non-empty path for all annotation actions. Resolve relative paths against devhost's startup working directory, independently of the manifest location and action `cwd`. Omit the key to use the system temp directory. See the [Agent Adapters guide](references/agent-adapters.md) for file lifecycle details.

- **Host resource readouts**: Omit `[devtools.resources]` to show host CPU, memory, and disk usage (percent used) in the toolbar, with CPU and memory read every `2s` and disk every `1m`. Set `[devtools.resources].enabled = false` to turn all three off. Set `[devtools.resources].pollInterval` to a duration string of at least `250ms` (for example `"5s"`) to read all three at one rate. Give `[devtools.resources.cpu]`, `[devtools.resources.memory]`, or `[devtools.resources.disk]` its own `enabled` or `pollInterval` to hide one readout or override the shared rate for it. Disk counts fixed local filesystems; on Linux, USB-attached and removable drives are left out, and on macOS the startup disk is reported. Changing these keys requires restarting devhost.

- **Git worktrees**: Omit `[worktrees]` to use checkout selection, which is enabled by default. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore. Inspect `git worktree list --porcelain` and configure all service `cwd` values from one checkout per repository. Devhost resolves submodule metadata entries to their actual checkout directories. Read the current branch beside the fork icon and open Worktrees to see checkout choices directly; use the header selector for multiple repositories. A red fork icon signals an unavailable selection, repository error, or blocked operation; open the panel for details. Use the picker to load the target checkout's manifest and restart the whole managed stack. Follow the persistence and recovery procedure in [Setup](references/setup.md#4-git-worktree-selection). Worktree group startup failures remain recoverable instead of terminating the supervisor.

### External Devtools Launchers

- Enable `[devtools.externalToolbars].enabled` (default `true`) to aggregate host-mounted TanStack Query, TanStack Router, the unified TanStack shell, React Hook Form, Jotai, and Vue inspectors.
- For the unified TanStack shell, mount tested `@tanstack/react-devtools@0.10.13` with native Form/Table/Pacer plugins in a development runtime. Use the single **TanStack** launcher for attached shells sharing native state; keep plugin navigation upstream. Standalone Query/Router retain separate entries. Close a detached native popup to restore its parent toolbar entry. Read the setup guide below for exact plugin versions, shared-origin behavior, and lifecycle/production limits.
- For React Hook Form, mount `@hookform/devtools`' `DevTool control={control}` in the host application for each form. The host application mounts each inspector and owns its form controls, form state, and native panel contents together with the upstream library; devhost supplies the launcher.
- For Jotai, use tested `jotai-devtools@0.14.0` with `jotai@2.20.3`; import devtools before creating custom stores, import its stylesheet in the host app, and pass the same store to `Provider` and `DevTools`. Stay on 0.14.0, because the typed export of 0.15.0 is broken. The host application creates the inspector, and atom and history behavior stay native.
- Use each **Jotai N** launcher to toggle its associated native root; open the panel to identify its store. Follow the setup guide below for session identities, shared upstream persistence, and production/version boundaries.
- Use each **Form N** launcher to toggle its associated native inspector. Follow the [External Devtools setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for tested versions, encounter-order panel identities, remount behavior, and disabling aggregation.
- For Vue, use the verified host combination `vite-plugin-vue-devtools@9.0.0-beta.1`, `vite@8.3.3`, Vue `3.5.43`, and `@vitejs/devtools@0.7.6` with `devtools: { apply: "serve" }`. Authorize the genuine native dock and mount a Vue app before expecting **Vue**. Hidden/passive hosts must be revealed through the native shortcut. Read the same setup guide for exact hub versions, native state and suppression ownership, title collisions, and project isolation. The host context, the Vue hooks, and the dock registrations all come from those genuine packages, and the rest of the repository's dependencies keep their versions. Other Vue releases require independent verification.
- For **Redux**, import the served `/__devhost__/redux.js` development module and register actual Toolkit or native-middleware Zustand stores. Use one public instrument `EnhancedStore.liftedStore` for Toolkit; supply real Zustand `StoreApi`, data snapshot and validated partial restoration functions. Follow the [Redux setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/#redux-toolkit-and-zustand) for exact imports, versions, HMR disposal, browser policies, and serialization limits. The browser inspector needs no desktop application or extension. Its registration is explicit; an extension hook alone indicates no stores. Existing native extension controls keep their own cursor, and cold native Zustand history is limited. Disabling aggregation or unmounting closes only devhost's own monitor and subscriptions.
- For native **React DevTools**, configure `[devtools.browser].endpoint` explicitly for an already running dedicated Chrome for Testing 154.0.8037.92 profile with original React Developer Tools 8.0.0 and mounted React/React DOM 19.2.5. Choose the dock's direct **Connect browser control** / **Disconnect browser control** command and read its full diagnostics; use the separate **React DevTools** action to open the browser-owned window, then select Components or Profiler there. Keep this exact tested version boundary; verify host props/state and profiling in the native window before reporting live inspection. The browser belongs to the user: attach to the one already running and leave starting and closing it to them. The backend and the hooks are those of the original extension. Report live inspection on the evidence of host props/state read in the native window; an open window shows only that the window exists. Follow [Native React setup](references/setup.md#7-native-react-devtools) for endpoint, origin, identity, lifetime and diagnostic boundaries.
- Preserve the compiled browser asset graph, including Redux inspector modules/styles, chunks/fonts, and gzip representations. Production inspector modules/styles use content-versioned immutable caching; source requests remain uncached and report failed builds as HTTP 503. Load the native inspector stylesheet only in its separate popup document.

### Service Configuration Constraints

- **Configuration hot reload**: Save the root manifest or an include to apply service changes; matching include-file additions and deletions also reload. Keep `name`, `killZombies`, Caddy, devtools, annotation, and worktree enablement unchanged when applying a live edit; changing any of these rejects the entire edit and requires restarting devhost. Read `configuration reload rejected` errors before claiming an edit applied; `configuration reloaded: <files>` confirms acceptance and lists the root manifest and all current included manifests relative to the root manifest directory. Use the [Setup reload procedure](references/setup.md#6-configuration-hot-reload) for port, checkout, and recovery behavior.

- **Service recovery**: Keep `devhost` running after service launch errors, startup health timeouts, and foreground exits, including exit code `0`. Open a routed domain during startup to view status and recent logs; root routes, aliases, and path routes serve recovery independently of toolbar enablement. Browser navigations returning app HTTP 404 show **Page not found** with the same standalone controls. App HTTP 5xx responses, including empty bodies, show recovery controls and service logs while preserving the error status. Use **Switch worktree** or **Refresh worktrees** there when checkout selection is enabled. API and asset error responses pass through. Use **Restart** after stack initialization to recover managed services and retry failed attempts. The existing tab reloads its original URL after health and routing succeed and that path returns neither 404 nor 5xx; browser launch remains user-initiated. Enable `[devtools.status]` for the full-screen exit overlay in already loaded apps. Stop the stack with `devhost stop`, a shutdown signal, or the configured idle timeout. Configuration, ownership, and initial routing failures stop startup. Use daemon/external health status separately from foreground exit recovery.
- **Restart routing**: Wait for foreground replacement health and route refresh before treating a restart as recovered. Preserve the assigned automatic port for individual restarts, because sibling services keep the environment that names it. On an assigned-port conflict, use **Restart Stack** in Services or recovery to relaunch all managed services with fresh automatic ports and rebuilt templates/environments. This uses the last accepted manifest, retains fixed ports and selected checkouts, and leaves external processes running. Read restart or restoration errors before claiming recovery; retry the stack action after addressing launch failures. Free or reconfigure conflicting fixed ports because the stack action does not reassign them.
- **Starting part of a stack**: Run `devhost start web api` to start the named services, everything they reach through `dependsOn`, and the services marked `alwaysStart = true`. Set `alwaysStart = true` (default `false`) on a service every slice needs, such as a database or a proxy, so it starts whichever services are named. The services left out are stopped: they hold no process, route, hostname claim, port claim, or file watch, and `{{ services.<name>.port }}` references and `DEVHOST_PORT_<NAME>` variables that name them keep resolving to their assigned address. With `[devtools.status]` enabled, the Services panel shows a **Stopped services** button that opens the list of stopped services; **Start** on a row starts that service and its `dependsOn` chain while the running services keep running. Manifest reloads and **Restart Stack** keep the same selection, and a service added to the manifest while a selection runs stays stopped unless it is marked `alwaysStart`. Plain `devhost start` starts every service.
- **Core Requirements**: Every service table must define either `port` or `health`.
- **Primary & Managed Fields**:
  - `primary = true` (default is `false`) can only be set on **one** service per manifest.
  - `managed = true` by default. A service with `managed = false` (an externally managed process) has a fixed `port` or an explicit `health.tcp` or `health.http` check, and omits `command`, `injectPort`, and `port = "auto"`. `health.process` belongs to managed services.
- **Routed Services (`host` specified)**:
  - Set `host` to a hostname string or a non-empty array of unique hostname strings to route every domain to the same process, port, and path.
  - Put the primary hostname first: `DEVHOST_HOST`, `{{ services.<name>.host }}`, and the devtools service link use that value. Ensure every hostname resolves to the machine running devhost.
  - Treat all domains of one service as a single annotation queue bucket per annotation action.
  - Must define a companion `port` configuration.
  - A health check on a routed service is `health.tcp` or `health.http`. `health.process` (the process-based health check) belongs to services without a `host`.
  - Set `proxyLocalOrigin = true` only for servers requiring a local Host/Origin, such as Bun HTML/HMR. Omit it or set `false` otherwise. It requires `host`, translates Host to the assigned backend address and matching public HTTP/HTTPS Origin to the local HTTP origin, preserves absent Origin and public X-Forwarded-Host, and rejects foreign, opaque, or duplicate origins with 403. Verify documents, assets, and HMR after enabling it. Leave it off for a service that takes cross-origin API requests, which it would answer with 403.
- **Dynamic Ports (`port = "auto"`)**:
  - Use `{{ services.api.url }}` for a direct HTTP base URL, with wildcard listeners mapped to loopback and IPv6 brackets included. Use `bindHost` and `port` references or `DEVHOST_PORT_<SERVICE_NAME_UPPERCASE>` for other protocols, accounting for wildcard and IPv6 addresses. Follow [Setup](references/setup.md#3-writing-and-outputting-manifest) for health URL templates and timing.
  - Omit `health` to use TCP readiness on the assigned port, or set timing alone (for example, `health = { timeout = 60000 }`) to customize it. Timing-only tables also work with fixed ports; services without a port select a probe.
  - Select at most one explicit probe: a fixed numeric `tcp` target, an `http` URL/path, or `process = true` for managed, non-routed foreground services.
  - Set `health.http = "/health"` as shorthand for the current service’s direct HTTP endpoint; it requires a service port. The equivalent template is `"{{ services.<name>.url }}/health"`. Absolute http/https targets resolve to `127.0.0.1`, `localhost`, or `::1` before launch.
  - Keep `timeout` as the total startup readiness budget in milliseconds (default `30000`), `interval` as the delay between attempts (default `200` milliseconds), and `retries = 0` for timeout-bounded attempts. A positive retry value permits that many retries after the first failure. Port retries, reloads, and stack restarts rebuild health URL references while retaining timing and probe kinds.
  - Inter-service discovery must use late-binding template placeholders (e.g., `{{ services.db.bindHost }}:{{ services.db.port }}`) or query the auto-injected environment variable `DEVHOST_PORT_<SERVICE_NAME_UPPERCASE>`.
- **Daemon Lifecycle Services (`[services.<name>.lifecycle]` table)**:
  - Must use `mode = "daemon"`, keep `managed = true`, and define both `lifecycle.start` and `lifecycle.stop` (optionally `lifecycle.status`).
  - Must **omit** the top-level `command` array.
  - Use a fixed `port` or an explicit `health.tcp` or `health.http` check. `port = "auto"` and `health.process` belong to foreground services.

### Parameter Bindings & Placeholders

- **Bind Host Constraints**: `bindHost` can only be one of the following: `127.0.0.1` (default), `0.0.0.0`, `::1`, `::`. Match the application's actual listener to this address and the assigned port; the app owns its listener configuration. A failed repository restart shows the failing member's error on every member's recovery page and remains retryable. Follow the [Vite integration guide](references/vite-storybook-integration.md#2-vite-loopback-bind-host-mismatch-bindhost) for listener verification and recovery.
- **Command Syntax**: `command` is best written as a string array to preserve argument boundaries exactly.
- **Working Directories**: Use an absolute `cwd` for any directory, including outside the manifest directory, in services and custom annotation actions. Resolve relative `cwd` values against the manifest directory and keep them within it. Write an absolute `cwd` exactly as it is.
- **Service References**: Use `{{ services.<name>.port }}`, `host`, `bindHost`, or `url` in command arguments, environment values, and `health.http`. `host` supplies the first public routing hostname (falling back to the bind host), so it can address Caddy. `bindHost` is the listening address. `url` builds a direct HTTP base URL from the assigned port and a connectable loopback address, maps wildcards to loopback, brackets IPv6, and includes neither a trailing slash nor a public routing path. Append the required path. It requires a service port. A reference resolves stopped service addresses too; use `dependsOn` to start a required service.
- **Environment Interpolation**: String values support standard environment interpolation using `{{ env.NAME }}` placeholders. Placeholder names must start with a letter/underscore and only contain alphanumeric characters or underscores. Referencing an undefined valid placeholder is a manifest load error.

### Reference Guides

Published guides include a video at the top. Read the guide prose for operational instructions; watching or downloading the video is optional.

- [Managed Caddy and routing](https://alexgorbatchev.github.io/devhost/guides/managed-caddy/)
- [Stack lifecycle](https://alexgorbatchev.github.io/devhost/guides/stack-lifecycle/)
- [Shared managed Caddy settings](https://alexgorbatchev.github.io/devhost/guides/shared-managed-caddy-settings/)
- [Docker-backed services](https://alexgorbatchev.github.io/devhost/guides/docker-backed-services/)
- [Managed daemon-style services](https://alexgorbatchev.github.io/devhost/guides/managed-daemon-style-services/)
- [Environment variables](https://alexgorbatchev.github.io/devhost/guides/environment-variables/)
- [Service references](https://alexgorbatchev.github.io/devhost/guides/service-references/)
- [Manifest includes](https://alexgorbatchev.github.io/devhost/guides/manifest-includes/)
- [Troubleshooting](https://alexgorbatchev.github.io/devhost/guides/troubleshooting/)
- [Devtools](https://alexgorbatchev.github.io/devhost/guides/devtools/)
- [React Highlight](https://alexgorbatchev.github.io/devhost/guides/react-highlight/)
- [Annotations](https://alexgorbatchev.github.io/devhost/guides/annotations/)

- **Full Manifest Example**: To read or copy a comprehensive, production-ready configuration illustrating every available feature and key, refer to the [Full Manifest Example](references/manifest-example.md).
- **Vite & Storybook**: For modern frontend setups involving dynamic ports, IPv6 loopback bindings, or host verification security, refer to the [Vite & Storybook Manifest Integration guide](references/vite-storybook-integration.md).
- **Annotation Actions & Agents**: Before configuring any `[annotation]` or action adapters (Pi, Claude Code, OpenCode, or Codex), refer to the [Agent Adapters guide](references/agent-adapters.md), including Codex hook trust requirements for queues.

---
name: devhost
description: Use when running devhost or when reading, writing, or changing a devhost.toml manifest, including bootstrapping one for a repository and operating its stack or the shared Caddy proxy.
author: alexgorbatchev
metadata:
  created_on: 2026-06-26 14:23
  last_modified: 2026-10-09 12:00
  status: current
---

## Command Line

Run `devhost` with `AGENT=1`: help becomes `key: value` text, and a failed command ends with one `ERR:` line that holds the whole error. Without it, a failure ends with an `[ERROR]` line and, where the next step is known, an `[INFO]` hint. Failure lines and warnings (`WARN:`, or `[WARN]` without `AGENT=1`) go to stderr. Exit code `0` means success and `1` a failure. `devhost start` ended by a signal exits with `128` plus the signal number: `130` after Ctrl-C, `143` after SIGTERM.

### Commands

- `devhost start [service...]`: start the manifest's services behind their HTTPS hostnames and stay in the foreground. With no `[service...]` argument every service starts. With one or more service names, devhost starts those services, every service they reach through `dependsOn`, and every service marked `alwaysStart = true` with its own `dependsOn` chain; the remaining services stay stopped. A name the manifest lacks fails the command with `unknown service` and the list of defined names. After startup stdout carries one `service-name: url` line per routed service that started, a `not started: a, b` line naming the stopped services when there are any, then log lines prefixed `[stack-name]` for devhost itself and `[service-name]` for each service. Routes are removed when it exits. Start the shared Caddy first.
- `devhost service list`: print the name of every service in the manifest on stdout, one per line in alphabetical order, in the same form with and without `AGENT=1`. With `--startable` it prints only the services that start when named, leaving out those marked `alwaysStart = true`. Feed the output to a picker: `devhost start $(devhost service list --startable | fzf --multi)`.
- `devhost stop`: stop the running stack of the manifest. It sends SIGTERM to the stack's processes, waits up to 15 seconds, force-kills what remains, and reports each step on stdout. With no stack running it says so and exits `0`.
- `devhost caddy download`: download the Caddy server devhost manages. Run it once on a machine that has no `caddy` on `PATH`.
- `devhost caddy privileged-ports`: on Linux, let the managed Caddy listen on ports 80 and 443 without root. It downloads Caddy first when needed and runs `sudo setcap` once. On macOS it reports that no setup is needed.
- `devhost caddy start`: start the shared Caddy server in the background. Every stack on the machine routes through it.
- `devhost caddy stop`: stop the shared Caddy server.
- `devhost caddy trust`: install Caddy's root certificate into the system trust store, so browsers accept the HTTPS hostnames. It asks for the user's password and needs the shared Caddy running.
- `devhost caddy print-root-cert`: print Caddy's root certificate to stdout. The certificate exists after the first `devhost caddy start`.
- `devhost caddy trust-remote <ssh-target>`: on macOS, trust the Caddy certificate of another machine. `<ssh-target>` is an SSH host with `devhost` on its `PATH`, such as `devbox` or `user@devbox`. It prints the certificate's SHA-256 fingerprint and installs the certificate into the System keychain.
- `devhost skill`: print this guide, byte for byte. Takes no arguments.
- `devhost help [command]`: print the help of a command, the screen `--help` prints for it.
- `devhost completion bash`, `devhost completion fish`, `devhost completion powershell`, `devhost completion zsh`: print a completion script for that shell on stdout. `--no-descriptions` (bool) leaves the command descriptions out of the completions.

`devhost`, `devhost caddy`, `devhost service`, and `devhost completion` are groups. Run one without a command to print its help, which lists everything below it.

### Flags and Environment

- `--manifest <path>`, `-m <path>` (string): the `devhost.toml` to use; the file must have that name. Accepted by `devhost start`, `devhost stop`, `devhost service list`, `devhost caddy start`, `devhost caddy stop`, and `devhost caddy trust`. `DEVHOST_MANIFEST` supplies the same path, and the flag wins when both are set. Without either, `devhost start`, `devhost stop`, and `devhost service list` use the nearest `devhost.toml` in the current directory or a parent, looking no higher than the directory that holds `.git`, and the `caddy` commands use the settings of the stacks already running, or the defaults.
- `--debug`, `-d` (bool): `devhost start` only. Show Caddy's own output while the stack runs.
- `--idle-timeout <duration>`, `-i <duration>` (string): `devhost start` only. Stop the stack after this long without traffic, written as a duration such as `30s` or `1m`. `DEVHOST_IDLE_TIMEOUT` supplies the same value, and the flag wins when both are set. Either one takes precedence over `[devtools].idleTimeout` in the manifest.
- `--startable`, `-s` (bool): `devhost service list` only. Print only the services that start when named, which leaves out the services marked `alwaysStart = true`.
- `--help`, `-h` (bool): print the help of the command instead of running it. Accepted by every command.
- `--version`, `-v` (bool): `devhost` only. Print the version alone on one line.

### First Run

```bash
devhost caddy download          # once, on a machine with no caddy on PATH
devhost caddy privileged-ports  # once, on Linux
devhost caddy start
devhost caddy trust             # once per machine
devhost start
```

Stop the stack with `devhost stop`, a shutdown signal, or an idle timeout. The shared Caddy keeps running until `devhost caddy stop`.

When this guide is printed by `devhost skill`, the `references/` files it links to are at <https://github.com/alexgorbatchev/devhost/tree/main/apps/devhost/internal/skill/devhost/references>.

## Setup and Discovery

Before drafting or updating any manifest configurations, you must run repository discovery and follow domain prompting rules.

Refer to the complete guide: [references/setup.md](references/setup.md)

## Authoring Rules

When modifying or generating configurations inside `devhost.toml`, you **must** strictly adhere to these syntax, casing, and schema validation rules:

### Naming & Casing Conventions (Mandatory)

- **camelCase Rule**: All manifest properties and tables across the entire TOML file **must** use standard `camelCase` naming conventions (e.g., `idleTimeout`, `killZombies`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, etc.). devhost rejects a key written in kebab-case, snake_case, or mixed casing.
- **Service Names**: Service keys inside `[services.<name>]` must match the regex `^[a-z][a-z0-9-]*$`.
- **Annotation Action IDs**: Action ids under `[[annotation.actions]]` must match the regex `^[a-z][a-z0-9-]*$` and must be unique.

### Top-Level Configurations

- **Managed Caddy lifecycle**: Start the shared proxy with `devhost caddy start --manifest ./devhost.toml`; stop it manually with `devhost caddy stop --manifest ./devhost.toml`. Use matching custom management settings. Read [Setup](references/setup.md#5-managed-caddy-startup) before changing shared settings or starting after all stacks stop; follow its active HTTP votes, captured retirement, and empty-runtime rules.

- **killZombies Option**: Optional boolean (default `true`) at the top level of `devhost.toml`. When `true`, devhost automatically finds, terminates, and reclaims zombie processes claiming the same ports or hosts from the same manifest path. Set `killZombies = false` to disable automatic recovery and report a standard collision error instead.

- **Annotation temporary files**: Set `[annotation].tempDir` in the root manifest to a non-empty path for all annotation actions. Resolve relative paths against devhost's startup working directory, independently of the manifest location and action `cwd`. Omit the key to use the system temp directory. See the [Agent Adapters guide](references/agent-adapters.md) for file lifecycle details.

- **Host resource readouts**: Omit `[devtools.resources]` to show host CPU, memory, and disk usage (percent used) in the toolbar, with CPU and memory read every `2s` and disk every `1m`. Set `[devtools.resources].enabled = false` to turn all three off. Set `[devtools.resources].pollInterval` to a duration string of at least `250ms` (for example `"5s"`) to read all three at one rate. Give `[devtools.resources.cpu]`, `[devtools.resources.memory]`, or `[devtools.resources.disk]` its own `enabled` or `pollInterval` to hide one readout or override the shared rate for it. Disk counts fixed local filesystems; on Linux, USB-attached and removable drives are left out, and on macOS the startup disk is reported. Changing these keys requires restarting devhost.

- **Git worktrees**: Omit `[worktrees]` to use checkout selection, which is enabled by default. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore. Inspect `git worktree list --porcelain` and configure all service `cwd` values from one checkout per repository. Use the Services repository picker to switch every repository member together, so all services of one repository run from the same checkout. Follow the persistence and recovery procedure in [Setup](references/setup.md#4-git-worktree-selection). Worktree group startup failures remain recoverable instead of terminating the supervisor.

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

- **Configuration hot reload**: Save the root manifest or an include to apply service changes; matching include-file additions and deletions also reload. Keep `name`, `killZombies`, Caddy, devtools, annotation, and worktree enablement unchanged when applying a live edit; changing any of these rejects the entire edit and requires restarting devhost. Read `configuration reload rejected` errors before claiming an edit applied; `configuration reloaded` confirms acceptance. Use the [Setup reload procedure](references/setup.md#6-configuration-hot-reload) for port, checkout, and recovery behavior.

- **Foreground service recovery**: Keep `devhost` running after foreground service exits, including exit code `0` and startup crashes. Enable `[devtools.status]` to display a full-screen recovery overlay with retained stdout/stderr logs and a restart button. Retry failed restarts from the overlay. Refresh a root-compatible routed app to load the recovery page while its backend is down; successful recovery reloads it. Stop the stack with `devhost stop`, a shutdown signal, or the configured idle timeout. Treat executable launch errors and startup health timeouts as startup failures. Use daemon/external health status separately from foreground exit recovery.
- **Restart routing**: Wait for foreground replacement health and route refresh before treating a restart as recovered. Preserve the assigned automatic port for individual restarts, because sibling services keep the environment that names it. On an assigned-port conflict, use **Restart stack with new ports** in Services or recovery to relaunch all managed services with fresh automatic ports and rebuilt templates/environments. This uses the last accepted manifest, retains fixed ports and selected checkouts, and leaves external processes running. Read restart or restoration errors before claiming recovery; retry the stack action after addressing launch failures. Free or reconfigure conflicting fixed ports because the stack action does not reassign them.
- **Starting part of a stack**: Run `devhost start web api` to start the named services, everything they reach through `dependsOn`, and the services marked `alwaysStart = true`. Set `alwaysStart = true` (default `false`) on a service every slice needs, such as a database or a proxy, so it starts whichever services are named. The services left out are stopped: they hold no process, route, hostname claim, port claim, or file watch, and `{{ services.<name>.port }}` references and `DEVHOST_PORT_<NAME>` variables that name them keep resolving to their assigned address. With `[devtools.status]` enabled, the Services panel shows a **Stopped services** button that opens the list of stopped services; **Start** on a row starts that service and its `dependsOn` chain while the running services keep running. Manifest reloads and **Restart stack with new ports** keep the same selection, and a service added to the manifest while a selection runs stays stopped unless it is marked `alwaysStart`. Plain `devhost start` starts every service.
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
  - Must **omit** any explicit `health` table (TCP health check is automatically applied on the resolved port).
  - Inter-service discovery must use late-binding template placeholders (e.g., `{{ services.db.bindHost }}:{{ services.db.port }}`) or query the auto-injected environment variable `DEVHOST_PORT_<SERVICE_NAME_UPPERCASE>`.
- **Daemon Lifecycle Services (`[services.<name>.lifecycle]` table)**:
  - Must use `mode = "daemon"`, keep `managed = true`, and define both `lifecycle.start` and `lifecycle.stop` (optionally `lifecycle.status`).
  - Must **omit** the top-level `command` array.
  - Use a fixed `port` or an explicit `health.tcp` or `health.http` check. `port = "auto"` and `health.process` belong to foreground services.

### Parameter Bindings & Placeholders

- **Bind Host Constraints**: `bindHost` can only be one of the following: `127.0.0.1` (default), `0.0.0.0`, `::1`, `::`.
- **Command Syntax**: `command` is best written as a string array to preserve argument boundaries exactly.
- **Working Directories**: Use an absolute `cwd` for any directory, including outside the manifest directory, in services and custom annotation actions. Resolve relative `cwd` values against the manifest directory and keep them within it. Write an absolute `cwd` exactly as it is.
- **Environment Interpolation**: String values support standard environment interpolation using `{{ env.NAME }}` placeholders. Placeholder names must start with a letter/underscore and only contain alphanumeric characters or underscores. Referencing an undefined valid placeholder is a manifest load error.

### Reference Guides

Published guides include a video at the top and a collapsible text transcript. Read the guide prose and transcript for operational instructions; watching or downloading the video is optional.

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

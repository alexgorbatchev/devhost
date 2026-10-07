---
name: devhost
description: Use anytime devhost.toml is involved, including reading, writing, making changes, bootstrapping, and running dev host. Start with repository discovery to identify runnable services, commands, ports, health checks, and the correct manifest location. Propose or update configurations, including routing and annotation agent commands. If first drafting, ask the user to choose a base domain with *.localhost as the default suggestion.
author: alexgorbatchev
metadata:
  created_on: 2026-06-26 14:23
  last_modified: 2026-10-07 06:58
  status: current
---

## Setup and Discovery

Before drafting or updating any manifest configurations, you must run repository discovery and follow domain prompting rules.

Refer to the complete guide: [references/setup.md](references/setup.md)

## Authoring Rules

When modifying or generating configurations inside `devhost.toml`, you **must** strictly adhere to these syntax, casing, and schema validation rules:

### Naming & Casing Conventions (Mandatory)

- **camelCase Rule**: All manifest properties and tables across the entire TOML file **must** use standard `camelCase` naming conventions (e.g., `idleTimeout`, `killZombies`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, etc.). Never use kebab-case, snake_case, or mixed casing.
- **Service Names**: Service keys inside `[services.<name>]` must match the regex `^[a-z][a-z0-9-]*$`.
- **Annotation Action IDs**: Action ids under `[[annotation.actions]]` must match the regex `^[a-z][a-z0-9-]*$` and must be unique.

### Top-Level Configurations

- **Managed Caddy lifecycle**: Start the shared proxy with `devhost caddy start --manifest ./devhost.toml`; stop it manually with `devhost caddy stop --manifest ./devhost.toml`. Use matching custom management settings. Read [Setup](references/setup.md#5-managed-caddy-startup) before changing shared settings or starting after all stacks stop; follow its active HTTP votes, captured retirement, and empty-runtime rules.

- **killZombies Option**: Optional boolean (default `true`) at the top level of `devhost.toml`. When `true`, devhost automatically finds, terminates, and reclaims zombie processes claiming the same ports or hosts from the same manifest path. Set `killZombies = false` to disable automatic recovery and report a standard collision error instead.

- **Annotation temporary files**: Set `[annotation].tempDir` in the root manifest to a non-empty path for all annotation actions. Resolve relative paths against devhost's startup working directory, independently of the manifest location and action `cwd`. Omit the key to use the system temp directory. See the [Agent Adapters guide](references/agent-adapters.md) for file lifecycle details.

- **Git worktrees**: Omit `[worktrees]` to use checkout selection, which is enabled by default. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore. Inspect `git worktree list --porcelain` and configure all service `cwd` values from one checkout per repository. Use the Services repository picker to switch every repository member together; do not set services from one repository to different checkouts. Follow the persistence and recovery procedure in [Setup](references/setup.md#4-git-worktree-selection). Worktree group startup failures remain recoverable instead of terminating the supervisor.

### External Devtools Launchers

- Enable `[devtools.externalToolbars].enabled` (default `true`) to aggregate host-mounted TanStack Query, TanStack Router, the unified TanStack shell, React Hook Form, Jotai, and Vue inspectors.
- For the unified TanStack shell, mount tested `@tanstack/react-devtools@0.10.13` with native Form/Table/Pacer plugins in a development runtime. Use the single **TanStack** launcher for attached shells sharing native state; keep plugin navigation upstream. Standalone Query/Router retain separate entries. Close a detached native popup to restore its parent toolbar entry. Read the setup guide below for exact plugin versions, shared-origin behavior, and lifecycle/production limits.
- For React Hook Form, mount `@hookform/devtools`' `DevTool control={control}` in the host application for each form. Keep form controls and native panel contents owned by the host and upstream library; do not mount inspectors or synthesize form state through devhost.
- For Jotai, use tested `jotai-devtools@0.14.0` with `jotai@2.20.3`; import devtools before creating custom stores, import its stylesheet in the host app, and pass the same store to `Provider` and `DevTools`. Do not patch declarations to use the broken 0.15.0 typed export, create inspectors through devhost, or replace native atom/history behavior.
- Use each **Jotai N** launcher to toggle its associated native root; open the panel to identify its store. Follow the setup guide below for session identities, shared upstream persistence, and production/version boundaries.
- Use each **Form N** launcher to toggle its associated native inspector. Follow the [External Devtools setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for tested versions, encounter-order panel identities, remount behavior, and disabling aggregation.
- For Vue, use the verified host combination `vite-plugin-vue-devtools@9.0.0-beta.1`, `vite@8.3.3`, Vue `3.5.43`, and `@vitejs/devtools@0.7.6` with `devtools: { apply: "serve" }`. Authorize the genuine native dock and mount a Vue app before expecting **Vue**. Hidden/passive hosts must be revealed through the native shortcut. Read the same setup guide for exact hub versions, native state and suppression ownership, title collisions, and project isolation. Do not synthesize a host context or Vue hooks, replace dock registrations, or upgrade unrelated repository dependencies to supply this host setup. Other Vue releases require independent verification.
- For **Redux**, import the served `/__devhost__/redux.js` development module and register actual Toolkit or native-middleware Zustand stores. Use one public instrument `EnhancedStore.liftedStore` for Toolkit; supply real Zustand `StoreApi`, data snapshot and validated partial restoration functions. Follow the [Redux setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/#redux-toolkit-and-zustand) for exact imports, versions, HMR disposal, browser policies, and serialization limits. The browser inspector needs no desktop application or extension. Its registration is explicit; an extension hook alone indicates no stores. Existing native extension controls keep their own cursor, and cold native Zustand history is limited. Disabling aggregation or unmounting closes only devhost's own monitor and subscriptions.
- For native **React DevTools**, configure `[devtools.browser].endpoint` explicitly for an already running dedicated Chrome for Testing 154.0.8037.92 profile with original React Developer Tools 8.0.0 and mounted React/React DOM 19.2.5. Choose the dock's direct **Connect browser control** / **Disconnect browser control** command and read its full diagnostics; use the separate **React DevTools** action to open the browser-owned window, then select Components or Profiler there. Keep this exact tested version boundary; verify host props/state and profiling in the native window before reporting live inspection. Do not launch or close the user browser, inject another backend, fabricate hooks, or claim window presence proves live inspection. Follow [Native React setup](references/setup.md#7-native-react-devtools) for endpoint, origin, identity, lifetime and diagnostic boundaries.
- Preserve the compiled browser asset graph, including Redux inspector modules/styles, chunks/fonts, and gzip representations. Production inspector modules/styles use content-versioned immutable caching; source requests remain uncached and report failed builds as HTTP 503. Load the native inspector stylesheet only in its separate popup document.

### Service Configuration Constraints

- **Configuration hot reload**: Save the root manifest or an include to apply service changes; matching include-file additions and deletions also reload. Keep `name`, `killZombies`, Caddy, devtools, annotation, and worktree enablement unchanged when applying a live edit; changing any of these rejects the entire edit and requires restarting devhost. Read `configuration reload rejected` errors before claiming an edit applied; `configuration reloaded` confirms acceptance. Use the [Setup reload procedure](references/setup.md#6-configuration-hot-reload) for port, checkout, and recovery behavior.

- **Foreground service recovery**: Keep `devhost` running after foreground service exits, including exit code `0` and startup crashes. Enable `[devtools.status]` to display a full-screen recovery overlay with retained stdout/stderr logs and a restart button. Retry failed restarts from the overlay. Refresh a root-compatible routed app to load the recovery page while its backend is down; successful recovery reloads it. Stop the stack with `devhost stop`, a shutdown signal, or the configured idle timeout. Treat executable launch errors and startup health timeouts as startup failures. Use daemon/external health status separately from foreground exit recovery.
- **Restart routing**: Wait for foreground replacement health and route refresh before treating a restart as recovered. Preserve the assigned automatic port for individual restarts; do not recommend changing one port while sibling services keep their previous environment. On an assigned-port conflict, use **Restart stack with new ports** in Services or recovery to relaunch all managed services with fresh automatic ports and rebuilt templates/environments. This uses the last accepted manifest, retains fixed ports and selected checkouts, and leaves external processes running. Read restart or restoration errors before claiming recovery; retry the stack action after addressing launch failures. Free or reconfigure conflicting fixed ports because the stack action does not reassign them.
- **Core Requirements**: Every service table must define either `port` or `health`.
- **Primary & Managed Fields**:
  - `primary = true` (default is `false`) can only be set on **one** service per manifest.
  - `managed = true` by default. If `managed = false` (externally managed process), the service **must omit** the `command`, `injectPort`, and `port = "auto"` fields. Unmanaged services may define explicit TCP or HTTP health checks, but must **not** use `health.process`.
- **Routed Services (`host` specified)**:
  - Set `host` to a hostname string or a non-empty array of unique hostname strings to route every domain to the same process, port, and path.
  - Put the primary hostname first: `DEVHOST_HOST`, `{{ services.<name>.host }}`, and the devtools service link use that value. Ensure every hostname resolves to the machine running devhost.
  - Treat all domains of one service as a single annotation queue bucket per annotation action.
  - Must define a companion `port` configuration.
  - Must **not** use `health.process` (process-based health check).
  - Set `proxyLocalOrigin = true` only for servers requiring a local Host/Origin, such as Bun HTML/HMR. Omit it or set `false` otherwise. It requires `host`, translates Host to the assigned backend address and matching public HTTP/HTTPS Origin to the local HTTP origin, preserves absent Origin and public X-Forwarded-Host, and rejects foreign, opaque, or duplicate origins with 403. Verify documents, assets, and HMR after enabling it; do not enable it on services requiring cross-origin API requests.
- **Dynamic Ports (`port = "auto"`)**:
  - Must **omit** any explicit `health` table (TCP health check is automatically applied on the resolved port).
  - Inter-service discovery must use late-binding template placeholders (e.g., `{{ services.db.bindHost }}:{{ services.db.port }}`) or query the auto-injected environment variable `DEVHOST_PORT_<SERVICE_NAME_UPPERCASE>`.
- **Daemon Lifecycle Services (`[services.<name>.lifecycle]` table)**:
  - Must use `mode = "daemon"`, keep `managed = true`, and define both `lifecycle.start` and `lifecycle.stop` (optionally `lifecycle.status`).
  - Must **omit** the top-level `command` array.
  - Must **not** use `port = "auto"` or `health.process`.

### Parameter Bindings & Placeholders

- **Bind Host Constraints**: `bindHost` can only be one of the following: `127.0.0.1` (default), `0.0.0.0`, `::1`, `::`.
- **Command Syntax**: `command` is best written as a string array to preserve argument boundaries exactly.
- **Working Directories**: Use an absolute `cwd` for any directory, including outside the manifest directory, in services and custom annotation actions. Resolve relative `cwd` values against the manifest directory and keep them within it. Do not prepend the manifest directory to an absolute `cwd`.
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

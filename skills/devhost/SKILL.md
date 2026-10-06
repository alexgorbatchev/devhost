---
name: devhost
description: Use anytime devhost.toml is involved, including reading, writing, making changes, bootstrapping, and running dev host. Start with repository discovery to identify runnable services, commands, ports, health checks, and the correct manifest location. Propose or update configurations, including routing and annotation agent commands. If first drafting, ask the user to choose a base domain with *.localhost as the default suggestion.
author: alexgorbatchev
metadata:
  created_on: 2026-06-26 14:23
  last_modified: 2026-10-06 05:49
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

- **killZombies Option**: Optional boolean (default `true`) at the top level of `devhost.toml`. When `true`, devhost automatically finds, terminates, and reclaims zombie processes claiming the same ports or hosts from the same manifest path. Set `killZombies = false` to disable automatic recovery and report a standard collision error instead.

- **Annotation temporary files**: Set `[annotation].tempDir` in the root manifest to a non-empty path for all annotation actions. Resolve relative paths against devhost's startup working directory, independently of the manifest location and action `cwd`. Omit the key to use the system temp directory. See the [Agent Adapters guide](references/agent-adapters.md) for file lifecycle details.

- **Git worktrees**: Omit `[worktrees]` to use checkout selection, which is enabled by default. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore. Inspect `git worktree list --porcelain` and configure all service `cwd` values from one checkout per repository. Use the Services repository picker to switch every repository member together; do not set services from one repository to different checkouts. Follow the persistence and recovery procedure in [Setup](references/setup.md#4-git-worktree-selection). Worktree group startup failures remain recoverable instead of terminating the supervisor.

### External Devtools Launchers

- Enable `[devtools.externalToolbars].enabled` (default `true`) to aggregate host-mounted TanStack Query, TanStack Router, and React Hook Form inspectors.
- For React Hook Form, mount `@hookform/devtools`' `DevTool control={control}` in the host application for each form. Keep form controls and native panel contents owned by the host and upstream library; do not mount inspectors or synthesize form state through devhost.
- Use each **Form N** launcher to toggle its associated native inspector. Follow the [External Devtools setup guide](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/) for tested versions, encounter-order panel identities, remount behavior, and disabling aggregation.

### Service Configuration Constraints

- **Foreground service recovery**: Keep `devhost` running after foreground service exits, including exit code `0` and startup crashes. Enable `[devtools.status]` to display a full-screen recovery overlay with retained stdout/stderr logs and a restart button. Retry failed restarts from the overlay. Refresh a root-compatible routed app to load the recovery page while its backend is down; successful recovery reloads it. Stop the stack with `devhost stop`, a shutdown signal, or the configured idle timeout. Treat executable launch errors and startup health timeouts as startup failures. Use daemon/external health status separately from foreground exit recovery.
- **Restart routing**: Wait for foreground replacement health and route refresh before treating a restart as recovered. Auto-port collision retries update both Caddy and document proxy targets while preserving devtools listeners. Read routing or restoration errors in the restart response and retained service logs, then retry from recovery after addressing the failure. Failed route updates restore previous registrations, configuration, and document backends and stop the unrouted replacement.
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

- **Full Manifest Example**: To read or copy a comprehensive, production-ready configuration illustrating every available feature and key, refer to the [Full Manifest Example](references/manifest-example.md).
- **Vite & Storybook**: For modern frontend setups involving dynamic ports, IPv6 loopback bindings, or host verification security, refer to the [Vite & Storybook Manifest Integration guide](references/vite-storybook-integration.md).
- **Annotation Actions & Agents**: Before configuring any `[annotation]` or action adapters (Pi, Claude Code, OpenCode, or Codex), refer to the [Agent Adapters guide](references/agent-adapters.md), including Codex hook trust requirements for queues.

---
name: devhost
description: Use anytime devhost.toml is involved, including reading, writing, making changes, bootstrapping, and running dev host. Start with repository discovery to identify runnable services, commands, ports, health checks, and the correct manifest location. Propose or update configurations, including routing and annotation agent commands. If first drafting, ask the user to choose a base domain with *.localhost as the default suggestion.
author: alexgorbatchev
---

# Devhost

This skill guides reading, writing, updating, or bootstrapping a `devhost.toml` manifest, as well as running the `devhost` daemon.

## Setup and Discovery

Before drafting or updating any manifest configurations, you must run repository discovery and follow domain prompting rules.

Refer to the complete guide: [references/setup.md](references/setup.md)

## Authoring Rules

When modifying or generating configurations inside `devhost.toml`, you **must** strictly adhere to these syntax, casing, and schema validation rules:

### Naming & Casing Conventions (Mandatory)

- **camelCase Rule**: All manifest properties and tables across the entire TOML file **must** use standard `camelCase` naming conventions (e.g., `idleTimeout`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, etc.). Never use kebab-case, snake_case, or mixed casing.
- **Service Names**: Service keys inside `[services.<name>]` must match the regex `^[a-z][a-z0-9-]*$`.
- **Annotation Action IDs**: Action ids under `[[annotation.actions]]` must match the regex `^[a-z][a-z0-9-]*$` and must be unique.

### Service Configuration Constraints

- **Core Requirements**: Every service table must define either `port` or `health`.
- **Primary & Managed Fields**:
  - `primary = true` (default is `false`) can only be set on **one** service per manifest.
  - `managed = true` by default. If `managed = false` (externally managed process), the service **must omit** the `command`, `injectPort`, and `port = "auto"` fields. Unmanaged services may define explicit TCP or HTTP health checks, but must **not** use `health.process`.
- **Routed Services (`host` specified)**:
  - Must define a companion `port` configuration.
  - Must **not** use `health.process` (process-based health check).
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
- **Environment Interpolation**: String values support standard environment interpolation using `{{ env.NAME }}` placeholders. Placeholder names must start with a letter/underscore and only contain alphanumeric characters or underscores. Referencing an undefined valid placeholder is a manifest load error.

### Reference Guides

- **Full Manifest Example**: To read or copy a comprehensive, production-ready configuration illustrating every available feature and key, refer to the [Full Manifest Example](references/manifest-example.md).
- **Vite & Storybook**: For modern frontend setups involving dynamic ports, IPv6 loopback bindings, or host verification security, refer to the [Vite & Storybook Manifest Integration guide](references/vite-storybook-integration.md).
- **Annotation Actions & Agents**: Before configuring any `[annotation]` or action adapters, refer to the [Agent Adapters guide](references/agent-adapters.md).

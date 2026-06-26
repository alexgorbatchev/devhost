---
name: dev-host-manifest-update
description: Use anytime devhost.toml is involved, including reading, writing, making changes, bootstrapping, and running dev host. Start with repository discovery to identify runnable services, commands, ports, health checks, and the correct manifest location. Propose or update configurations, including routing and annotation agent commands. If first drafting, ask the user to choose a base domain with *.localhost as the default suggestion.
author: alexgorbatchev
---

# Dev Host - Manifest Update

## Workflow

1. Discover the repository before proposing any manifest shape.
2. Ask the user which base domain to use. Suggest a `*.localhost` domain by default.
3. Draft the smallest correct `devhost.toml` for the services the repo actually runs.
4. Keep only the sections needed for the initial setup.

## Repo Discovery

Inspect the repo to answer these questions with evidence instead of guessing:

- Where will the user most likely run `devhost` from?
- Should the manifest live at the repo root or a workspace/package boundary?
- Which services are real entrypoints versus background dependencies?
- What command should start each service?
- Which services expose HTTP and need a routed `host`?
- Which ports are fixed already, and which services can use `port = "auto"`?
- Does any service already expose a health endpoint worth using?

Read the repo files that usually answer this:

- root and workspace `package.json`
- workspace `README.md` and `AGENTS.md`
- Docker or Compose files when present
- env examples and app config files that declare ports or bind hosts

If discovery does not produce enough confidence to assign a command, port, health check, or manifest location, stop and ask the user instead of inventing values.

## Base Domain Prompt

Do not silently choose routed hostnames.

Ask one short question before writing any `host = ...` fields. Use `*.localhost` as the recommended default because the repo docs explicitly call it the safest zero-config choice.

Use a prompt in this shape:

> Which base domain should I use for routed services? Recommended default: a `*.localhost` domain such as `app.localhost` or `hello.localhost`.

After the user answers:

- If there is one routed app, use the base domain directly for the primary service.
- If there are multiple routed HTTP services, derive clear names from the base domain such as `api.<base-domain>` or `admin.<base-domain>` unless the user asked for path-based composition instead.
- Do not assign hosts to non-routed background services.

## Authoring Rules

Build the first manifest from `apps/devhost/devhost.example.toml`, then trim it down aggressively.

- Keep `name` and at least one `[services.<name>]` block.
- Prefer string-array `command` values.
- Keep all fields for one service inside one table; do not reopen the same service later.
- Only add `[caddy.global]`, `[devtools]`, `[agent]`, or explicit health tables when the repo actually needs them.
- Before adding `[agent]`, read `references/agent-adapters.md` to choose between a built-in adapter and a custom command.
- For a routed service, include both `port` and `host`.
- For a non-routed service, omit `host`.
- Prefer the repo's real fixed ports when they are already established.
- Use `port = "auto"` for services and databases that can bind dynamically. To coordinate dynamic ports:
  - Consuming services should use late-binding service references (e.g., `env = { DATABASE_URL = "postgres://postgres:postgres@{{ services.db.bindHost }}:{{ services.db.port }}/mydb" }`) or read the auto-injected environment variable `DEVHOST_PORT_<SERVICE_NAME_UPPERCASE>`.
  - When `port = "auto"` is used, omit explicit `health` blocks so that `devhost` automatically applies a TCP health check on the dynamically allocated port.
- Prefer explicit HTTP health only when the repo already exposes a stable health URL; otherwise rely on the default TCP health for fixed-port services.

## Output

When writing the manifest:

- Place `devhost.toml` at the discovered manifest location.
- Keep comments minimal unless the user asked for an annotated file.
- Explain any assumptions that still remain.
- Name the unresolved gaps, if any, before claiming the manifest is ready.

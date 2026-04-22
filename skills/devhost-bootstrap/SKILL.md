---
name: devhost-bootstrap
description: Create an initial `devhost.toml` manifest for an existing repository. Use when asked to bootstrap, draft, or wire up a first devhost manifest. Start with repo discovery to identify runnable services, commands, ports, health checks, and the right manifest location. Ask the user to choose a base domain before writing routed hosts, with `*.localhost` as the default suggestion.
---

# Devhost Manifest Init

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
- For a routed service, include both `port` and `host`.
- For a non-routed service, omit `host`.
- Prefer the repo's real fixed ports when they are already established.
- Use `port = "auto"` only when the service can bind from `PORT` and does not need an explicit `health` block.
- Prefer explicit HTTP health only when the repo already exposes a stable health URL; otherwise rely on the default TCP health for fixed-port services.

## Output

When writing the manifest:

- Place `devhost.toml` at the discovered manifest location.
- Keep comments minimal unless the user asked for an annotated file.
- Explain any assumptions that still remain.
- Name the unresolved gaps, if any, before claiming the manifest is ready.

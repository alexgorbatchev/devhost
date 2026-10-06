# Repo Discovery and Manifest Setup

When initializing, drafting, or setting up a `devhost.toml` manifest for a repository, follow these procedures to discover service parameters and establish correct configurations.

---

## 1. Repo Discovery

Before proposing any manifest shape, inspect the repository to answer these questions with evidence instead of guessing:

- Where is the most likely location to run `devhost` from?
- Should the manifest live at the repo root or a workspace/package boundary?
- Which services are real HTTP entrypoints versus background dependencies?
- What command should start each service?
- Which services expose HTTP and need a routed `host`?
- Which ports are fixed already, and which services can use `port = "auto"`?
- Does any service already expose a health endpoint worth using?

### What to inspect:

- Root and workspace `package.json` configurations.
- Workspace `README.md` and `AGENTS.md` guidelines.
- Docker or Compose files (when present).
- Environment examples (`.env.example`) and app config files that declare ports or bind hosts.

_If discovery does not produce enough confidence to assign a command, port, health check, or manifest location, stop and ask the user instead of inventing values._

---

## 2. Base Domain Prompt

Do not silently choose routed hostnames. Ask one short question before writing any `host = ...` fields. Recommend `*.localhost` as the default suggestion because it is the safest zero-config choice.

Use a prompt in this shape:

> Which base domain should I use for routed services? Recommended default: a `*.localhost` domain such as `app.localhost` or `hello.localhost`.

### After the user answers:

- If there is one routed app, use the base domain directly for the primary service.
- If there are multiple routed HTTP services, derive clear names from the base domain such as `api.<base-domain>` or `admin.<base-domain>` unless the user asked for path-based composition instead.
- Do not assign hosts to non-routed background services.

---

## 3. Writing and Outputting Manifest

When writing the finalized manifest:

- Place `devhost.toml` at the discovered manifest location.
- Keep comments minimal unless the user explicitly asks for an annotated file.
- Explain any assumptions that still remain.
- Name any unresolved gaps before claiming the manifest is ready.

## 4. Git Worktree Selection

When the user requests worktree support:

1. Run `git -C <service-cwd> worktree list --porcelain` for each service repository. Require Git on `PATH` and keep configured directories in one checkout per repository.
2. Set `[worktrees].enabled = true` in the root manifest. Leave it omitted or false when checkout selection is not requested. Do not invent per-service selections, a branch setting, or a remember option.
3. Enable `[devtools.status]` for the Services picker. Select the repository branch button, inspect the target directory preview, and use **Switch and restart**. All services in that repository move together, retaining their directory offsets; other repositories and non-Git services stay independent.
4. Explain that the saved local choice is scoped to manifest path and repository and survives devhost restarts. Before the first choice, devhost uses the checkout containing the configured cwd values. Do not edit the manifest when changing checkout; its original commands and configuration remain authoritative.
5. If the saved checkout is unavailable or a group launch fails, keep the group stopped. Refresh a routed app to access Services recovery, then choose an available checkout, **Retry** after fixing the cause, or **Return to configured checkout**. Do not silently fall back or claim a selected checkout is running while an error is shown. Refresh the app after success.
6. If a repository contains a `managed = false` service, report that switches are blocked. Do not claim devhost can relocate an externally owned process. Existing terminal sessions keep their launch directories; resume a paused queue to launch an agent in the selected checkout.

Relative watch paths use the selected service cwd. Absolute watch paths remain absolute. New browser editor and annotation launches remap configured paths inside the selected repository; directories outside it remain configured. The selected checkout's manifest is never loaded.

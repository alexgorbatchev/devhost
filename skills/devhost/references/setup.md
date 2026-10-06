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

Worktree support is enabled by default. When configuring repository services or selecting a checkout:

1. Run `git -C <service-cwd> worktree list --porcelain` for each service repository. Require Git on `PATH` and keep configured directories in one checkout per repository.
2. Omit `[worktrees]` to keep checkout selection enabled. An empty table or `enabled = true` also enables it. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore; services then use their configured directories. Do not invent per-service selections, a branch setting, or a remember option.
3. Enable `[devtools.status]` for the Services picker. Select the repository branch button, inspect the target directory preview, and use **Switch and restart**. All services in that repository move together, retaining their directory offsets; other repositories and non-Git services stay independent.
4. Explain that the saved local choice is scoped to manifest path and repository and survives devhost restarts. Before the first choice, devhost uses the checkout containing the configured cwd values. Do not edit the manifest when changing checkout; its original commands and configuration remain authoritative.
5. If the saved checkout is unavailable or a group launch fails, keep the group stopped. Refresh a routed app to access Services recovery, then choose an available checkout, **Retry** after fixing the cause, or **Return to configured checkout**. Do not silently fall back or claim a selected checkout is running while an error is shown. Refresh the app after success.
6. If a repository contains a `managed = false` service, report that switches are blocked. Do not claim devhost can relocate an externally owned process. Existing terminal sessions keep their launch directories; resume a paused queue to launch an agent in the selected checkout.

Relative watch paths use the selected service cwd. Absolute watch paths remain absolute. New browser editor and annotation launches remap configured paths inside the selected repository; directories outside it remain configured. The selected checkout's manifest is never loaded.

Open the checkout picker or press **Refresh** to discover worktree additions and deletions. If the running checkout disappears, refresh stops only its repository group and blocks new tool launches there. Retain the missing selection and choose an available checkout for recovery; do not silently substitute another checkout.

## 5. Managed Caddy Startup

Start the shared proxy before launching stacks. Pass `--manifest <path>` to `devhost caddy start` to generate its configuration using `caddy.global.adminAddress`, `bindHost`, `http`, `httpPort`, and `httpsPort`. `DEVHOST_MANIFEST` supplies the same path when the flag is omitted; an explicit flag wins. `devhost caddy stop` and `trust` accept the same manifest option.

Active stack registrations take precedence for the shared admin address, bind host, and listener ports. Plain HTTP is enabled when the supplied manifest or any active stack sets `caddy.global.http = true`. Keep non-default global settings consistent across stacks sharing that proxy; do not treat them as isolated per-stack listeners.

## 6. Configuration Hot Reload

For manual recovery, restart an individual service to reuse its assigned port. If an automatic port is occupied, choose **Restart stack with new ports** in Services or the recovery overlay. This relaunches all managed services using the last accepted manifest, refreshes automatic ports and their injected references, and retains fixed ports, selected checkouts, control listeners, and terminal sessions. External processes keep running. Check the response and retained logs for launch, routing, or restoration failures before claiming recovery, then retry the action after addressing the failure. A fixed-port conflict requires freeing the port or changing its manifest setting.

Save service changes to the original root manifest or an included manifest while devhost is running. Files added or deleted under an `includes` glob also change the stack. Wait for `configuration reloaded`; invalid, conflicting, or restart-required edits print `configuration reload rejected` and do not apply.

Keep stack `name`, `killZombies`, Caddy settings, devtools settings, annotation settings, and `[worktrees].enabled` unchanged in a live edit. Stop and restart devhost to apply those settings. An edit changing one of them rejects its service changes as well.

Expect affected services, their dependents, and affected repository groups to restart in dependency order after stopping in reverse order. Compatible automatic ports and saved checkout selections are retained. Changing ports exported through `DEVHOST_PORT_*` can restart otherwise unchanged services. Existing terminal sessions and control connections remain available.

Read launch, routing, and restoration errors when a reload fails. Devhost attempts to restore the previous services and routes. Recover stopped services explicitly if restoration also fails; repair the manifest and save again to retry the desired configuration. Continue using the original manifest when selecting another checkout.

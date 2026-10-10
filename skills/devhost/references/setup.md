---
created_on: 2026-06-26 21:23
last_modified: 2026-10-09 22:39
status: current
---

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

The user chooses the routed hostnames. Ask one short question before writing any `host = ...` fields. Recommend `*.localhost` as the default suggestion because it is the safest zero-config choice.

Use a prompt in this shape:

> Which base domain should I use for routed services? Recommended default: a `*.localhost` domain such as `app.localhost` or `hello.localhost`.

### After the user answers:

- If there is one routed app, use the base domain directly for the primary service.
- If there are multiple routed HTTP services, derive clear names from the base domain such as `api.<base-domain>` or `admin.<base-domain>` unless the user asked for path-based composition instead.
- Give `host` to routed services alone; background services stay without one.

---

## 3. Writing and Outputting Manifest

When writing the finalized manifest:

- Place `devhost.toml` at the discovered manifest location.
- Keep comments minimal unless the user explicitly asks for an annotated file.
- Explain any assumptions that still remain.
- Name any unresolved gaps before claiming the manifest is ready.

For fixed or automatic ports, customize the implicit TCP readiness budget with `[services.<name>.health]` and `timeout = 60000` (milliseconds). Set `http = "/health"` to probe the service's direct HTTP endpoint instead. Use the discovered endpoint path. The full equivalent is `http = "{{ services.<name>.url }}/health"`; `url` builds the HTTP base from the assigned port and connectable loopback address, including IPv6 brackets. Use it in command arguments and environment values for direct HTTP connections too. The `host` property supplies the first public routing hostname, falling back to the bind host, so it can name Caddy rather than the application's listener. Health HTTP targets resolve to loopback HTTP/HTTPS URLs before launch; port retries and reloads rebuild their templates and retain timing settings.

## 4. Git Worktree Selection

Worktree support is enabled by default. When configuring repository services or selecting a checkout:

1. Run `git -C <service-cwd> worktree list --porcelain` for each service repository. Require Git on `PATH` and keep configured directories in one checkout per repository.
2. Omit `[worktrees]` to keep checkout selection enabled. An empty table or `enabled = true` also enables it. Set `[worktrees].enabled = false` only to disable discovery and saved-selection restore; services then use their configured directories. `enabled` is the only key of that table: a selection covers a whole repository and is saved automatically.
3. Enable `[devtools.status]` for the Services picker. Select the repository branch button, inspect the target directory preview, and use **Switch and restart**. All services in that repository move together, retaining their directory offsets; other repositories and non-Git services stay independent.
4. Explain that the saved local choice is scoped to manifest path and repository and survives devhost restarts. Before the first choice, devhost uses the checkout containing the configured cwd values. Leave the manifest as it is when changing checkout; its original commands and configuration remain authoritative.
5. If the saved checkout is unavailable or a group launch fails, keep the group stopped. Refresh a routed app to access Services recovery, then choose an available checkout, **Retry** after fixing the cause, or **Return to configured checkout**. While an error is shown, report the group as stopped and the selected checkout as unavailable. Refresh the app after success.
6. If a repository contains a `managed = false` service, report that switches are blocked. An externally owned process stays where its owner runs it. Existing terminal sessions keep their launch directories; resume a paused queue to launch an agent in the selected checkout.

Relative watch paths use the selected service cwd. Absolute watch paths remain absolute. New browser editor and annotation launches remap configured paths inside the selected repository; directories outside it remain configured. devhost keeps the original manifest loaded, whichever checkout is selected.

Open the checkout picker or press **Refresh** to discover worktree additions and deletions. If the running checkout disappears, refresh stops only its repository group and blocks new tool launches there. Retain the missing selection, and have the user choose an available checkout for recovery.

## 5. Managed Caddy Startup

Start the shared proxy before launching stacks. Pass `--manifest <path>` to `devhost caddy start` to generate its configuration using `caddy.global.adminAddress`, `bindHost`, `http`, `httpPort`, and `httpsPort`. `DEVHOST_MANIFEST` supplies the same path when the flag is omitted; an explicit flag wins. `devhost caddy stop` and `trust` accept the same manifest option.

Keep non-default global settings consistent across stacks sharing the proxy; explicit conflicts fail. Active registrations take precedence when generating the shared admin address, bind host, and listener ports. While registrations remain, enable HTTP only through active stacks' `caddy.global.http` votes: any true voter enables HTTP, and retiring the last true voter disables it while false/default siblings remain. A supplied manifest's true HTTP fallback does not override those active votes. With no active registrations, generated configuration uses the supplied manifest's settings, including HTTP.

Preserve each stack's captured shared management binding after startup stale cleanup. Sparse/default route settings inherit that binding. Stack retirement removes its host snippets, keeps the captured admin/listeners, and preserves live siblings and their HTTP votes. Final-registration cleanup retains the retiring stack's captured settings, including HTTP; it leaves Caddy running.

Stop the shared proxy manually with `devhost caddy stop --manifest ./devhost.toml` after its stacks stop. Use a manifest with matching custom admin and listener settings for Caddy lifecycle commands and for any new stack starting after all registrations are gone. Lifecycle commands contact the manifest-selected admin endpoint; neither they nor a new stack discover an empty custom runtime from its Caddyfile. Keep that manual shared lifecycle explicit when configuring multiple projects.

## 6. Configuration Hot Reload

For manual recovery, restart an individual service to reuse its assigned port. If an automatic port is occupied, choose **Restart stack with new ports** in Services or the recovery overlay. This relaunches all managed services using the last accepted manifest, refreshes automatic ports and their injected references, and retains fixed ports, selected checkouts, control listeners, and terminal sessions. External processes keep running. Check the response and retained logs for launch, routing, or restoration failures before claiming recovery, then retry the action after addressing the failure. A fixed-port conflict requires freeing the port or changing its manifest setting.

Save service changes to the original root manifest or an included manifest while devhost is running. Files added or deleted under an `includes` glob also change the stack. Wait for `configuration reloaded`; invalid, conflicting, or restart-required edits print `configuration reload rejected` and leave the running stack unchanged.

Keep stack `name`, `killZombies`, Caddy settings, devtools settings, annotation settings, and `[worktrees].enabled` unchanged in a live edit. Stop and restart devhost to apply those settings. An edit changing one of them rejects its service changes as well.

Expect affected services, their dependents, and affected repository groups to restart in dependency order after stopping in reverse order. Compatible automatic ports and saved checkout selections are retained. Changing ports exported through `DEVHOST_PORT_*` can restart otherwise unchanged services. Existing terminal sessions and control connections remain available.

Read launch, routing, and restoration errors when a reload fails. Devhost attempts to restore the previous services and routes. Recover stopped services explicitly if restoration also fails; repair the manifest and save again to retry the desired configuration. Continue using the original manifest when selecting another checkout.

## 7. Native React DevTools

Use an explicitly provisioned dedicated browser profile with original React Developer Tools installed before loading the host. The tested versions are Chrome for Testing 154.0.8037.92, extension 8.0.0 and React/React DOM 19.2.5. Other versions, late backend injection and inspection recovery after native window loss remain unverified.

1. Set `[devtools.browser].endpoint` to the exact browser loopback HTTP root with a nonzero port, or its complete loopback browser WebSocket URL. An empty endpoint disables native access. No default port is chosen; DNS names, non-loopback addresses, credentials, redirects, query/fragment values and page WebSockets are rejected. The optional `reactExtensionId` defaults to the official Chrome Web Store ID; an original unpacked extension needs its actual ID.
2. Keep `[devtools.externalToolbars].enabled = true`, visit the actual routed host, and choose **Connect browser control** directly in the dock. The same button reads **Disconnect browser control** while connecting or connected and remains operable. Read the full setup/status/observation/window/loss/error information in the dock and use **Copy** for errors. A uniquely bound mounted host and configured extension are required for the separate **React DevTools** action. Choose it to open native DevTools, then select the upstream Components or Profiler tab. Devhost leaves native panel selection to the user. This connection operation has no popup; Escape does not invoke Disconnect or window access.
3. Treat control connection, host/extension detection and native window presence as separate observations. A hook alone, devhost-only tree or unrelated page does not qualify. Missing, ambiguous, unsupported or lost sessions remain unavailable; report them as unavailable.
4. Choose **Disconnect browser control** to release devhost resources while leaving native windows, tabs and profile intact. Collapse hides the command and full diagnostics while preserving its connection, stack health and compact browser state/error/loss cue; expand to restore the command/readout. Disabling aggregation or actual App-root unmount releases owned control resources. DOM removal alone is not React unmount. Reconnect explicitly after a control failure or stack restart; it fetches current instance configuration.
5. Preserve the user-owned native window across connect/disconnect. Native manual close/reopen showed Loading/empty trees in isolated Chrome 147/154 probes; controller reconnect does not certify inspection recovery or clear observed native-session loss for that mounted App lifetime. Report that loss as observed, and leave reloading the app to the user.

Requests remain token-free for trusted local development. The Go runtime retains the endpoint privately and rechecks effective managed Caddy scheme/port, current root-route owner, service-path precedence and exact instance/document URL identity. These checks constrain targeting alone: same-origin scripts and local callers able to forge headers remain unauthenticated. Foreign or ambiguous documents cannot control the browser. Escaped matcher literals and repeated-slash registrations withhold native access rather than approximate Caddy matching. Preserve the recorded native-popup focus failure and unverified toolbar-wide arrow-key navigation separately from the direct command, as open limitations. See the [native architecture and support boundaries](https://alexgorbatchev.github.io/devhost/architecture/external-devtools/#native-react-devtools).

---
title: "Stack lifecycle"
sidebar:
  order: 3
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.webp" aria-label="stack lifecycle demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Start dependencies first. Stop the whole stack with one command.</p>
</details>
<!-- /guide-demo -->

The canonical manifest reference lives in [../devhost.example.toml](../reference/devhost-example/).
Use that file as the documented source of truth for top-level sections, allowed values, defaults, health variants, inline explanations, and copy/paste examples.

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

Each TOML table must be declared once. Keep all fields for a service inside a single `[services.<name>]` block instead of reopening that table later.

When you run `devhost start`, it:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` or `DEVHOST_MANIFEST` is provided
2. parses TOML and validates schema and semantics
3. resolves `port = "auto"` before spawning managed foreground children
4. requires the managed Caddy admin API to already be available
5. reserves the fixed numeric bind ports of the services it starts before starting any of them
6. reserves the public hostnames of the services it starts before starting any of them
7. registers all selected service routes and serves startup status at their domains before launching children
8. starts managed services in dependency order, using either a foreground `command` or daemon `lifecycle.start`, and forwards browser pages to each app once its health check and route update succeed
9. keeps the stack, sibling services, routes, and retained logs available after service launch errors, health timeouts, and foreground process exits, including exit code `0`, for explicit recovery
10. removes routes and reservations on explicit shutdown, idle timeout, or fatal startup errors, forwards shutdown signals to managed foreground services through the service-containment backend for the current platform, and runs daemon `lifecycle.stop` commands for managed daemon services

## Starting part of a stack

A monorepo manifest describes every app and backend in the repository, often merged from one file per package with [manifest includes](../manifest-includes/). A single task usually touches one or two of those apps, and plain `devhost start` launches all of them. Name the services you are working on to start one slice of the stack:

```bash
devhost start web admin
```

Starting a slice gives you:

- **Less to launch.** The services left out run no process, and startup waits only for the health checks of the services it starts.
- **Free hostnames and ports.** The services left out reserve no hostname and no fixed port, so another stack can use them at the same time.
- **Dependencies without bookkeeping.** devhost follows `dependsOn` from the services you name, so you name the app and get the backends it needs.
- **Room to grow the slice.** A service left out starts later from the devtools while the running services keep running.

devhost starts the named services, every service they reach through `dependsOn`, and every service marked `alwaysStart = true` together with its own `dependsOn` chain. Set `alwaysStart = true` on the services every slice needs, such as a database or a proxy.

Plain `devhost start` starts every service, whatever `alwaysStart` says. A name the manifest does not define fails the command before anything starts and lists the defined names.

### Example: slices of a monorepo

This manifest has three apps, one API they share, and a database:

```toml
name = "acme"

[services.db]
command = ["bun", "run", "db:dev"]
port = "auto"
alwaysStart = true

[services.api]
command = ["bun", "run", "api:dev"]
port = "auto"
dependsOn = ["db"]

[services.web]
command = ["bun", "run", "web:dev"]
port = "auto"
host = "web.acme.localhost"
dependsOn = ["api"]

[services.admin]
command = ["bun", "run", "admin:dev"]
port = "auto"
host = "admin.acme.localhost"
dependsOn = ["api"]

[services.docs]
command = ["bun", "run", "docs:dev"]
port = "auto"
host = "docs.acme.localhost"
```

| Command                   | Starts                              | Leaves stopped        |
| ------------------------- | ----------------------------------- | --------------------- |
| `devhost start web`       | `web`, `api`, `db`                  | `admin`, `docs`       |
| `devhost start web admin` | `web`, `admin`, `api`, `db`         | `docs`                |
| `devhost start docs`      | `docs`, `db`                        | `api`, `web`, `admin` |
| `devhost start`           | `db`, `api`, `web`, `admin`, `docs` | none                  |

`devhost start web` reaches `api` through `dependsOn` and `db` through `api`. `devhost start docs` starts `db` because of `alwaysStart`, although `docs` does not depend on it, and leaves `api` stopped because nothing started depends on it.

After `devhost start web`, startup names the services it left out:

```text
[acme] not started: admin, docs
```

### Stopped services

The services left out are stopped. They run no process, have no route, and hold no hostname or fixed-port reservation, so another stack can use those hostnames and ports. Startup prints them on a `not started:` line. They keep an assigned address: `{{ services.<name>.port }}` references and `DEVHOST_PORT_<NAME>` variables that name a stopped service resolve as they do when it runs, and stay the same when it starts. A reference without a `dependsOn` entry does not start the service it names.

With `[devtools.status]` enabled, the Services panel shows **Stopped services** with their count. It opens the list of stopped services; **Start** starts one together with what it depends on, and the services already running keep running. If the service fails to start, the list shows the error and the service stays stopped. Stopped services cannot be restarted, including by the restart shortcut when the primary service is one of them.

The selection lasts for the run. Manifest reloads and **Restart stack with new ports** keep it, a service added to the manifest stays stopped unless it is marked `alwaysStart`, and edits to a stopped service take effect when it starts. Stop and start devhost to run fewer services.

`devhost service list` prints the service names of the manifest, one per line in alphabetical order. `--startable` leaves out the `alwaysStart` services, which start whether or not they are named. Use it to pick a slice:

```bash
devhost start $(devhost service list --startable | fzf --multi)
```

Exited foreground services remain stopped until explicit recovery or a configuration edit affecting them. With status devtools enabled, exited services appear in a full-screen recovery overlay with their exit code, retained stdout/stderr logs, and a restart button. Failed attempts remain retryable. Executable launch errors and startup health timeouts also keep the supervisor running for recovery; daemon lifecycle and external services report health separately from foreground process exits.

## Startup and recovery pages

Open a service's domain while it starts to see **Starting <service>**, its assigned address, and recent stdout/stderr. Startup and recovery pages share the managed proxy's 404 page styling: a centered monospace card with light and dark themes following your browser preference. The existing tab reloads its original path and query string once health checks and routing succeed. Devhost never launches a browser.

Stopping the stack during startup cancels the health wait and reports shutdown progress for every launched service.

If startup times out, the process exits, or the backend is unreachable, the same domain shows the recorded failure and recent service logs. **Restart <service>** becomes available for managed services after stack initialization and stays disabled during an active restart. Failed attempts show their error and remain retryable. External services show status and require recovery outside devhost.

These pages work for aliases and path routes even when every devtools feature is disabled. They do not depend on the app or injected toolbar. With worktrees enabled, each repository has a checkout picker and **Switch worktree** action on the standalone page. **Refresh worktrees** discovers added and deleted checkouts. Switching restarts the repository's managed services together and reloads the current URL after success; failures stay visible and retryable. Repositories containing external services show why switching is unavailable. When enabled on a root route, the toolbar also remains available for stack recovery.

If a browser navigation reaches the app but the app returns HTTP 404, devhost shows the same standalone page with **Page not found** and the checkout picker. The HTTP status remains 404. The page retains its path and query string while you select another checkout, and waits until that path stops returning 404 before automatically reloading. API and asset 404 responses and other application errors pass through. Recovery responses are uncached HTTP errors. Assets and WebSocket traffic retain their direct proxy routes. Invalid configuration, ownership conflicts, and initial route registration failures still stop startup and are reported in the terminal.

To try this from a devhost repository checkout, configure `DEVHOST_RECOVERY` in `.envrc.local` if you need a hostname other than the default `recovery.localhost`, reload direnv, and run:

```bash
just devhost demo-recovery
```

Open that hostname manually. The separate `demos/recovery/devhost.toml` starts a service that deliberately leaves its automatic port closed: the page shows startup progress, then a health timeout after ten seconds with its logs and a **Restart unhealthy** button. Restart repeats the deliberate failure. The demo disables the injected toolbar so you can inspect the standalone recovery page. Press **Ctrl-C** to stop the demo stack.

## Configuration hot reload

Saving the root manifest or an included manifest reloads service configuration. Added and deleted files matching an `includes` pattern change service membership. The whole candidate must parse, validate, and have a valid dependency order before devhost changes running services. Invalid edits print `configuration reload rejected` and leave the stack running.

Service commands, environment, working directories, health checks, dependencies, routes, watch paths, additions/removals, and primary-service selection reload. Compatible automatic ports and selected Git checkouts are preserved. Affected services and their dependents stop in reverse dependency order and start in dependency order; an affected repository restarts as a group. A service that joins a repository, whether added to the manifest or started from **Stopped services**, starts in the checkout that repository runs from and leaves its other services running. Changes to injected `DEVHOST_PORT_*` values can require restarting otherwise unchanged services.

Devhost updates routing and ownership claims and retains its control listener, connected browsers, and existing terminal sessions. Launch or routing failures trigger restoration of the previous services and routes, with restoration errors reported explicitly. Unrelated edits preserve stopped services' recovery state. Unrelated filesystem writes do not trigger or postpone a reload. Shutdown signals interrupt replacement health waits and clean up the stack without launching restoration services. Successful reloads print `configuration reloaded`.

Changes to stack `name`, `killZombies`, Caddy settings, devtools settings, annotation settings, or worktree enablement require stopping and restarting devhost. The entire edit is rejected when it changes one of these settings; service changes in the same edit are not applied.

Worktree additions and deletions are discovered when opening the Services checkout picker or pressing **Refresh**. Deleting an inactive worktree does not restart services. If it contained the configured service directories, reload retains the known repository and maps their directory offsets into the selected checkout; the original manifest and its includes must remain accessible. Refreshing after deletion of the running checkout stops only that repository's group and blocks new editor/annotation launches until an available checkout is selected. The saved selection remains visible with a recovery error; devhost does not silently fall back. Manifest reload uses the original manifest and retains the selected checkout.

Foreground restart success requires both a healthy replacement and refreshed routes. A single-service restart keeps its assigned automatic port. If another listener occupies it, the service remains stopped and the error points to **Restart stack with new ports**. Health remains pending until routing completes. If routing fails, devhost restores the previous route registration, configuration, and document backend, stops the replacement, and leaves recovery available for another attempt. The restart response and retained service logs include routing and restoration errors.

Devhost checks each foreground service's assigned automatic port before launching it. Startup, manifest reload, and **Restart stack with new ports** retry detected bind collisions with another automatic port, up to three times. Individual restarts keep their assigned port and report a conflict instead.

**Restart stack with new ports** is available in the Services panel and recovery overlay. It stops every managed service in reverse dependency order, assigns fresh automatic ports, rebuilds command templates and injected environments, and starts services in dependency order before updating routes. Fixed ports and selected worktrees are retained; external services keep running. The control listener, document recovery listeners, and existing terminal sessions stay available. The action uses the last accepted manifest, including when an edit on disk is invalid. Failed launches or route updates attempt to restore the previous stack and report restoration errors, with another stack restart available. Reassigning automatic ports cannot resolve a fixed-port conflict; free that port or change its manifest setting.

`devhost`-owned logs use the manifest `name` when available and fall back to `[devhost]`. Child service logs remain prefixed with `[service-name]`.

Managed Caddy runtime logs are discarded by the generated Caddyfile so background Caddy stderr does not leak into `devhost` stack output. Managed Caddy command output from stack route reloads is hidden by default during `devhost start` runs. Use `devhost start --debug` when you need to see those reload stdout/stderr lines while debugging routing. Explicit `devhost caddy ...` lifecycle and setup commands still print their normal command output.

Managed foreground-service shutdown is best-effort and platform-specific. On Linux, `devhost` enables child-subreaper tracking, remembers discovered descendants, and keeps a short post-signal watch on managed service ports so late rebinds by owned processes can still be terminated before shutdown completes. On macOS and other platforms, `devhost` falls back to descendant discovery and signaling without Linux subreaper guarantees. Services that intentionally daemonize or fully detach from `devhost` supervision are unsupported in foreground `command` mode unless they also provide a cooperative shutdown path that `devhost` can call explicitly. If `devhost` still cannot stop managed services during cleanup, it exits non-zero and reports each affected service plus any surviving listener or descendant details it could still observe.

## Stopping a Stack

Press **Ctrl-C** in the stack's terminal to stop it. Devhost prints `Stopping service <name>...` for each managed service as shutdown begins and `Stopped service <name>.` after its cleanup succeeds, all prefixed with the stack name. `Stack stopped.` confirms that service and routing cleanup finished successfully. Child stdout/stderr remains visible during shutdown, and cleanup failures report the affected services instead of claiming success. Ctrl-C exits with code `130`; SIGTERM exits with `143`.

To shut down a running stack cleanly, you can run the `stop` command from your project's manifest directory, or point to it explicitly:

```bash
devhost stop
# Or with an explicit manifest:
devhost stop --manifest path/to/devhost.toml
```

A stack is identified by the absolute path of its manifest, whichever way `--manifest` was written when it started. `devhost stack list` prints every stack running on the machine, one per line in manifest path order, and prints nothing when none runs. Each line is the PID of the stack's devhost process, one tab, and the absolute manifest path; the path runs to the end of the line, so it stays one field when it holds spaces. Every running stack is listed, including one whose services have no hostname and no port. Use it to stop a stack from another directory, such as one that holds a hostname you need:

```bash
devhost stack list
# 3596463	/home/me/projects/app/devhost.toml
devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"
```

The last line stops a stack you pick, from any directory:

1. `devhost stack list` prints the running stacks.
2. [`fzf`](https://github.com/junegunn/fzf) shows them as a list and prints the line you choose. Any picker that prints one of its input lines works in its place.
3. `cut -f2` keeps the second tab-separated field, the manifest path. `cut -f1` gives the PID.
4. `devhost stop --manifest` stops the stack of that manifest. The quotes keep a path with spaces in one piece.

When you already know which stack you want, filter instead of picking, with a pattern that matches one stack:

```bash
devhost stop --manifest "$(devhost stack list | cut -f2 | grep my-project)"
```

When you run `devhost stop`, the command performs the following lifecycle operations:

1. **Path Resolution**: Resolves the absolute and clean filesystem path of the target manifest file.
2. **Scan Records**: Reads the record every running stack keeps of itself (`stacks`), and the claims and registrations directories (`.host-claims`, `port-claims`, and `.registrations`), to discover all PIDs registered under that manifest path. Each record also carries the start identity of the process that wrote it, so a record left by a stack that exited is skipped even when its PID has since gone to another process. Records written by a devhost version without start identities are matched by PID alone until those stacks restart.
3. **Graceful Term**: Sends `SIGTERM` (or platform equivalent) to each active process, and polls for up to 15 seconds to allow them to stop cleanly.
4. **Force Kill Escalation**: If any target processes remain active after the 15-second grace period, it escalates to `SIGKILL` (force-killing) to ensure the stack is fully cleared.

When no stack runs from that manifest, `devhost stop` says so and exits `0`. If other stacks are running it adds a line that points to `devhost stack list`, because the stack you mean may have been started from another manifest.

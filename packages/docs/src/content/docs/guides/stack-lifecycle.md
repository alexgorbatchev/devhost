---
title: "Stack lifecycle"
sidebar:
  order: 3
---

The canonical manifest reference lives in [../devhost.example.toml](../reference/devhost-example/).
Use that file as the documented source of truth for top-level sections, allowed values, defaults, health variants, inline explanations, and copy/paste examples.

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

Each TOML table must be declared once. Keep all fields for a service inside a single `[services.<name>]` block instead of reopening that table later.

When you run `devhost start`, it:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` or `DEVHOST_MANIFEST` is provided
2. parses TOML and validates schema and semantics
3. resolves `port = "auto"` before spawning managed foreground children
4. requires the managed Caddy admin API to already be available
5. reserves fixed numeric bind ports before starting any service that uses them
6. reserves every public hostname before starting any service
7. starts managed services in dependency order, using either a foreground `command` or daemon `lifecycle.start`, and evaluates unmanaged services in the same dependency graph
8. waits for each managed service health check before routing it; a foreground service that exits during startup keeps its route available for recovery, while unmanaged routed services claim their routes immediately once dependencies are satisfied
9. keeps the stack, sibling services, routes, and devtools running after foreground service exits, including exit code `0`, so you can inspect retained logs and restart the exited service
10. removes routes and reservations on explicit shutdown, idle timeout, or fatal startup errors, forwards shutdown signals to managed foreground services through the service-containment backend for the current platform, and runs daemon `lifecycle.stop` commands for managed daemon services

Exited foreground services remain stopped until explicit recovery or a configuration edit affecting them. With status devtools enabled, exited services appear in a full-screen recovery overlay with their exit code, retained stdout/stderr logs, and a restart button. Failed attempts remain retryable. Executable launch errors and startup health timeouts remain fatal startup errors; daemon lifecycle and external services report health separately from foreground process exits.

## Configuration hot reload

Saving the root manifest or an included manifest reloads service configuration. Added and deleted files matching an `includes` pattern change service membership. The whole candidate must parse, validate, and have a valid dependency order before devhost changes running services. Invalid edits print `configuration reload rejected` and leave the stack running.

Service commands, environment, working directories, health checks, dependencies, routes, watch paths, additions/removals, and primary-service selection reload. Compatible automatic ports and selected Git checkouts are preserved. Affected services and their dependents stop in reverse dependency order and start in dependency order; an affected repository restarts as a group. Changes to injected `DEVHOST_PORT_*` values can require restarting otherwise unchanged services.

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

To shut down a running stack cleanly, you can run the `stop` command from your project's manifest directory, or point to it explicitly:

```bash
devhost stop
# Or with an explicit manifest:
devhost stop --manifest path/to/devhost.toml
```

When you run `devhost stop`, the command performs the following lifecycle operations:

1. **Path Resolution**: Resolves the absolute and clean filesystem path of the target manifest file.
2. **Scan Claims**: Scans the registrations and claims directories (`.host-claims`, `.port-claims`, and `.registrations`) to discover all PIDs registered under that manifest path.
3. **Graceful Term**: Sends `SIGTERM` (or platform equivalent) to each active process, and polls for up to 15 seconds to allow them to stop cleanly.
4. **Force Kill Escalation**: If any target processes remain active after the 15-second grace period, it escalates to `SIGKILL` (force-killing) to ensure the stack is fully cleared.

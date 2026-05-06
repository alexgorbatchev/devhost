---
title: "Stack lifecycle"
sidebar:
  order: 3
---

The canonical manifest reference lives in [../devhost.example.toml](../reference/devhost-example/).
Use that file as the documented source of truth for top-level sections, allowed values, defaults, health variants, inline explanations, and copy/paste examples.

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

Each TOML table must be declared once. Keep all fields for a service inside a single `[services.<name>]` block instead of reopening that table later.

When you run `devhost`, it:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` or `DEVHOST_MANIFEST` is provided
2. parses TOML and validates schema and semantics
3. resolves `port = "auto"` before spawning managed foreground children
4. requires the managed Caddy admin API to already be available
5. reserves fixed numeric bind ports before starting any service that uses them
6. reserves every public hostname before starting any service
7. starts managed services in dependency order, using either a foreground `command` or daemon `lifecycle.start`, and evaluates unmanaged services in the same dependency graph
8. waits for each managed service health check before routing it, while unmanaged routed services claim their routes immediately once dependencies are satisfied
9. removes routes and reservations on shutdown or startup failure, forwards shutdown signals to managed foreground services through the service-containment backend for the current platform, and runs daemon `lifecycle.stop` commands for managed daemon services

`devhost`-owned logs use the manifest `name` when available and fall back to `[devhost]`. Child service logs remain prefixed with `[service-name]`.

Managed Caddy runtime logs are discarded by the generated Caddyfile so background Caddy stderr does not leak into `devhost` stack output. Managed Caddy command output from stack route reloads is hidden by default during `devhost` runs. Use `devhost --verbose` when you need to see those reload stdout/stderr lines while debugging routing. Explicit `devhost caddy ...` lifecycle and setup commands still print their normal command output.

Managed foreground-service shutdown is best-effort and platform-specific. On Linux, `devhost` enables child-subreaper tracking, remembers discovered descendants, and keeps a short post-signal watch on managed service ports so late rebinds can still be terminated before shutdown completes. On macOS and other platforms, `devhost` falls back to descendant discovery and signaling without Linux subreaper guarantees. Services that intentionally daemonize or fully detach from `devhost` supervision are unsupported in foreground `command` mode unless they also provide a cooperative shutdown path that `devhost` can call explicitly. If `devhost` still cannot stop managed services during cleanup, it exits non-zero and reports each affected service plus any surviving listener or descendant details it could still observe.

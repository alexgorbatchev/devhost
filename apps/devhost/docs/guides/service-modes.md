# Service lifecycle and manifest patterns

The canonical manifest reference lives in [../devhost.example.toml](../devhost.example.toml).
Use that file as the documented source of truth for top-level sections, allowed values, defaults, health variants, inline explanations, and copy/paste examples.

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

Each TOML table must be declared once. Keep all fields for a service inside a single `[services.<name>]` block instead of reopening that table later.

## Stack lifecycle

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

## Shared managed Caddy settings

To also serve the same routed hosts through plain HTTP, add this top-level setting:

```toml
[caddy.global]
http = true
```

This is a global managed-Caddy toggle, not an isolated per-stack listener. If any active stack enables `caddy.global.http = true`, the shared Caddy instance serves HTTP for all active stacks until the last opting-in stack stops.

To move the shared managed Caddy listeners off the default privileged ports, set one or both listener ports:

```toml
[caddy.global]
httpPort = 8080
httpsPort = 4443
```

Those are shared managed-Caddy settings too. Active stacks must agree on any non-default `caddy.global.httpPort` and `caddy.global.httpsPort` values because they all route through the same Caddy instance.

To expose the managed Caddy front door beyond loopback, set a shared listener bind host:

```toml
[caddy.global]
bindHost = "0.0.0.0"
```

That widens only the managed Caddy HTTP/HTTPS listeners. The admin API stays on `127.0.0.1`, and routed backends can keep their own `services.<name>.bindHost` on loopback behind Caddy.
Active stacks must agree on any non-default `caddy.global.bindHost` value because they share one managed Caddy instance.

To move the managed Caddy admin API off the default endpoint, set:

```toml
[caddy.global]
adminAddress = "127.0.0.1:22000"
```

Active stacks must agree on any non-default `caddy.global.adminAddress` value because they share one managed Caddy instance.

For same-host composition within one manifest, use distinct paths such as `/api/*` and `/admin/*`, or combine one root-mounted fallback service with more specific subpath services on the same hostname.

## Docker-backed services

`devhost` can front a Docker- or Compose-managed backend, but only when the container publishes a port onto the host and `devhost` routes to that host-visible port.
`devhost` does not proxy to Docker-internal service names or container-network-only addresses.

If another process or tool already owns the backend lifecycle, declare that service with `managed = false` so `devhost` claims the hostname and fixed port without trying to spawn or restart it.

For example, if your Compose service publishes `4000:4000`, you can route it like this:

```toml
name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "hello.localhost"
dependsOn = ["api"]

[services.api]
command = ["docker", "compose", "up", "--build", "api"]
port = 4000
host = "api.hello.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

That works because the API is reachable from the host on `127.0.0.1:4000`.
If the API only exists inside the Docker network, for example as `http://api:4000`, `devhost` cannot route to it directly.

For a backend that is started separately and only becomes reachable later, use an unmanaged service instead:

```toml
name = "hello-stack"

[services.dev]
command = ["bun", "run", "dev:infra"]
health = { process = true }

[services.preview]
managed = false
dependsOn = ["dev"]
port = 4100
host = "preview.hello.localhost"
```

Unmanaged services must omit `command`, `injectPort`, and `port = "auto"`.
They can still use fixed-port routing and explicit TCP or HTTP health checks, but `health.process` is invalid because `devhost` does not own a child process for them.

## Managed daemon-style services

Use daemon lifecycle mode when `devhost` should own a service, but the service runs in the background or is managed through explicit `start` / `stop` commands rather than one long-lived foreground process.

This is the correct mode for services that intentionally daemonize, re-exec into detached workers, or otherwise cannot guarantee that their long-lived process tree will stay attached to the foreground `command` that `devhost` started.

Daemon lifecycle services use a nested `[services.<name>.lifecycle]` table:

- `mode = "daemon"` switches the service out of the default foreground `command` model
- `start` and `stop` are required command arrays
- `status` is optional and lets `devhost` treat an already-running daemon as healthy without re-running `start`
- top-level `command` is invalid in daemon mode
- `managed` must stay `true`
- `port = "auto"` and `health.process` are invalid in daemon mode

Example:

```toml
name = "hello-stack"

[services.mailpit]
port = 8025
host = "mail.hello.localhost"
health = { http = "http://127.0.0.1:8025/api/v1/info" }

[services.mailpit.lifecycle]
mode = "daemon"
start = ["./scripts/mailpit-devctl", "start"]
status = ["./scripts/mailpit-devctl", "status"]
stop = ["./scripts/mailpit-devctl", "stop"]
```

`devhost` runs `lifecycle.start`, waits for the service health check, and then installs routes. On shutdown or restart it runs `lifecycle.stop`. When `status` exits successfully, `devhost` treats the daemon as already running and skips `start`.

## Injected environment

`devhost` injects environment variables into each managed service command invocation.
Only `DEVHOST_BIND_HOST` and `PORT` are operational bind inputs.
The remaining variables are context metadata and must not be used as socket bind targets.
Undocumented `DEVHOST_*` variables are reserved for internal supervision and may change without notice.

### Operational bind inputs

- `DEVHOST_BIND_HOST`
  - the actual interface the child process is expected to listen on
  - use this for binding sockets
- `PORT`
  - the listening port selected by `devhost`
  - injected when the service defines `port`, including foreground services with `port = "auto"`, unless `injectPort = false`
  - for `port = "auto"`, the selected port is best-effort and may be retried if the child reports a clear bind collision during startup
  - not injected for services that do not define `port` or for unmanaged services
- `injectPort = false`
  - service-level opt-out for `PORT` injection
  - keeps routing and health checks on the configured service `port`, but does not export `PORT` into the child process environment
  - useful for wrapper commands that launch multiple dev processes under one top-level command

### Routed-service context

- `DEVHOST_HOST`
  - injected only for routed services with `host`
  - the public routed hostname from the service `host` field
  - use this when the app needs to know its public development URL or origin
- `DEVHOST_PATH`
  - injected only for routed services with `host` and an explicit `path`
  - the public routed subpath from the service `path` field
  - use this when the app needs to mount its router under a specific prefix

### Manifest metadata

- `DEVHOST_SERVICE_NAME`
  - the manifest service key for the current child process
- `DEVHOST_MANIFEST_PATH`
  - the absolute path to the resolved `devhost.toml`

# devhost

`devhost` is a Bun-based local development host runner for projects behind a devhost-managed Caddy instance.

It has two runtime modes:

- **single-service mode** — start one app, wait for its health gate, and register one public host
- **manifest mode** — load `devhost.toml`, start a local stack, wait for each service health gate, and register routed hosts

It also has Caddy lifecycle commands:

- `devhost caddy start`
- `devhost caddy stop`
- `devhost caddy trust`

## What it does

`devhost`:

- starts local child processes
- injects `PORT` and `DEVHOST_*` environment variables
- validates and loads `devhost.toml` with Bun TOML parsing plus Zod v4 validation
- reserves public hosts before starting routed services
- waits for health checks before enabling routes
- reloads a managed Caddy instance when routes change
- stores generated Caddy config under `DEVHOST_STATE_DIR`, `XDG_STATE_HOME/devhost`, or `~/.local/state/devhost/caddy`
- uses wildcard listeners on macOS so rootless Caddy can open `:443`
- keeps loopback-only binding on non-macOS platforms
- prefixes its own logs with the manifest `name` in manifest mode, falling back to `[devhost]`
- prefixes child service logs with `[service-name]`
- optionally injects a small devtools UI into HTML document navigations
- exposes devhost control routes under `/__devhost__/*`
- includes a websocket status stream when devtools control routing is enabled

## Requirements

- `bun`
- `caddy`

## CLI usage

Show help:

```bash
bun run dev --help
```

### Managed Caddy commands

Start the managed Caddy instance:

```bash
bun run dev caddy start
```

Stop it:

```bash
bun run dev caddy stop
```

Managed Caddy may prompt for your password when it needs to install its local CA into the system trust store.
`devhost caddy start` and `devhost caddy trust` stream Caddy's own output directly so the trust/install flow is visible.
Trust its local CA once after it is running:

```bash
bun run dev caddy trust
```

The generated Caddy config uses these defaults:

- state dir: `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`
- admin API: `127.0.0.1:20193` unless `DEVHOST_CADDY_ADMIN_ADDRESS` is set
- listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on `:443`
- listener binding on non-macOS: loopback only via Caddy `default_bind 127.0.0.1 [::1]`

### Single-service mode

```bash
bun run dev --host hello.local.test --port 3200 -- bun run test:hello
```

Behavior:

1. verifies the managed Caddy admin API is available
2. reserves the host
3. starts the child command
4. waits for the target port to accept connections
5. starts devtools control/document servers
6. writes the Caddy route and reloads the managed Caddy instance
7. removes the route on exit

### Manifest mode

```bash
bun run dev
```

or:

```bash
bun run dev --manifest ../test/devhost.toml
```

Behavior:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` is provided
2. parses TOML with Bun
3. validates schema and semantics
4. resolves `port = "auto"`
5. verifies the managed Caddy admin API is available
6. reserves all public hosts
7. starts services in dependency order
8. waits for each service health check before routing it
9. tears down routes and children on exit or failure

## Platform caveat

On macOS, this now starts rootlessly by avoiding loopback-specific listener binding.
That fixes startup, but it also means the managed Caddy instance is not loopback-only on that platform.
If you need strict loopback-only HTTPS on privileged ports, the correct solution is a privileged launcher such as `launchd` socket activation, not pretending wildcard binding is equivalent.

On non-macOS platforms, opening HTTPS on `:443` still requires privileged-port setup outside `devhost`.
`devhost` does not configure `sudo`, `setcap`, `authbind`, or firewall redirection for you.

## DNS caveat

`devhost` manages Caddy, not name resolution.
Your chosen hostnames must already resolve to this machine.
Without that, automatic Caddy management is irrelevant because the browser will never reach the local proxy.

## `devhost.toml`

Top-level fields:

```toml
name = "hello-test-app"
primaryService = "hello"
devtools = true
devtoolsMinimapPosition = "right"
devtoolsPosition = "bottom-right"
```

Example routed service:

```toml
[services.hello]
command = ["bun", "run", "dev"]
cwd = "."
port = 3200
host = "hello.local.test"
```

Supported service fields:

- `command: string[]`
- `cwd?: string`
- `env?: Record<string, string>`
- `port?: number | "auto"`
- `bindHost?: "127.0.0.1" | "0.0.0.0" | "::1" | "::"`
- `host?: string`
- `dependsOn?: string[]`
- `health?: { tcp: number } | { http: string } | { process: true }`

For the full contract, read `../docs/toml-config.md`.

## Injected environment

### Always relevant

- `DEVHOST_BIND_HOST`
  - the actual interface the child process is expected to listen on
  - use this for binding sockets
- `PORT`
  - the listening port selected by `devhost`
  - in manifest mode this is the resolved port, including `port = "auto"`

### Manifest-mode variables

- `DEVHOST_STACK`
- `DEVHOST_SERVICE_NAME`
- `DEVHOST_MANIFEST_PATH`

### Routed-service variables

- `DEVHOST_HOST`
  - the public routed hostname from the service `host` field

## Devtools injection

When devtools are enabled, routed traffic is split like this:

- `/__devhost__/*` → devtools control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path.

If manifest `devtools = false`, devhost does not mount these control routes for that stack.

## Contributor notes

Internal development details live in:

- `./AGENTS.md`

## Non-goals

`devhost` is not trying to be:

- Docker Compose
- a persistent daemon beyond the explicitly managed Caddy process
- a remote orchestration system
- a DNS manager
- a generic wildcard-host generator

# devhost

`devhost` is a Bun-based local development host runner for projects behind Caddy.

It has two modes:

- **single-service mode** — start one app, wait for its health gate, and register one public host
- **manifest mode** — load `devhost.toml`, start a local stack, wait for each service health gate, and register routed hosts

## What it does

`devhost`:

- starts local child processes
- injects `PORT` and `DEVHOST_*` environment variables
- validates and loads `devhost.toml` with Bun TOML parsing plus Zod v4 validation
- reserves public hosts before starting routed services
- waits for health checks before enabling routes
- reloads Caddy when routes change
- prefixes its own logs with the manifest `name` in manifest mode, falling back to `[devhost]`
- prefixes child service logs with `[service-name]`
- optionally injects a small devtools UI into HTML document navigations
- exposes devhost control endpoints under `/__devhost__/*` when devtools control routing is enabled

## Requirements

- `bun`
- `caddy`
- a running Caddy admin API reachable at `127.0.0.1:2019`

If Caddy is not running, `devhost` now fails fast before spawning child apps.

## CLI usage

Show help:

```bash
bun run dev --help
```

### Single-service mode

```bash
bun run dev --host hello.local.test --port 3200 -- bun run test:hello
```

Behavior:

1. verifies Caddy admin availability
2. reserves the host
3. starts the child command
4. waits for the target port to accept connections
5. starts devtools control/document servers
6. writes the Caddy route and reloads Caddy
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
5. verifies Caddy admin availability
6. reserves all public hosts
7. starts services in dependency order
8. waits for each service health check before routing it
9. tears down routes and children on exit or failure

## `devhost.toml`

Top-level fields:

```toml
name = "hello-test-app"
primaryService = "hello"
devtools = true
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

Rules worth remembering:

- `cwd` is resolved relative to the directory containing `devhost.toml`
- `cwd` must stay inside the manifest directory tree
- `command` must be an argv array, not a shell string
- `port = "auto"` is supported
- `port = "auto"` must omit explicit `health` in v1
- `devtools` defaults to `true`

For the full contract, read `../docs/toml-config.md`.

## Injected environment

`devhost` injects different variables depending on mode.

### Always relevant

- `DEVHOST_BIND_HOST`
  - the actual interface the child process is expected to listen on
  - use this for binding sockets
- `PORT`
  - the listening port selected by `devhost`
  - in manifest mode this is the resolved port, including `port = "auto"`

### Manifest-mode variables

- `DEVHOST_STACK`
  - the manifest `name`
- `DEVHOST_SERVICE_NAME`
  - the service's manifest name
  - example: `[services.api]` means `DEVHOST_SERVICE_NAME=api`
- `DEVHOST_MANIFEST_PATH`
  - the absolute path to the active `devhost.toml`

### Routed-service variables

- `DEVHOST_HOST`
  - the public routed hostname from the service `host` field
  - use this when the app needs to know its external development URL host
  - example: `host = "hello.xcv.lol"` means `DEVHOST_HOST=hello.xcv.lol`

## Devtools injection

When devtools are enabled, routed traffic is split like this:

- `/__devhost__/*` → devtools control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path.

Current control endpoints:

- `/__devhost__/api/time`
- `/__devhost__/api/health`
  - returns `{ services: [{ name, status }] }`
  - `status` is a live boolean derived from the managed service's configured health check

If manifest `devtools = false`, devhost does not mount these control endpoints for that stack.

### Important caveat

The current HTML injector rewrites HTML and strips these headers from rewritten responses:

- `content-security-policy`
- `content-security-policy-report-only`

That is acceptable for the current prototype, but it is a real correctness/security compromise and must not be ignored.

## Logging

- manifest-mode `devhost` logs are prefixed with `[<manifest name>]`
- single-service and pre-manifest `devhost` logs fall back to `[devhost]`
- child stdout/stderr lines are prefixed with `[service-name]`

Example:

```text
[hello-test-app] primary https://hello.local.test
[hello] helloWorldServer listening on http://127.0.0.1:3200 for hello.local.test
```

## Workspace usage in this repository

From the repository root:

```bash
bun run devhost --manifest ./test/devhost.toml
```

From the `test/` workspace, using `devhost` as a workspace dev dependency:

```bash
cd test && bun run devhost --manifest ./devhost.toml
```

## Contributor notes

Internal development details now live in:

- `./AGENTS.md`

That file covers:

- contributor workflow and test commands
- internal package layout
- logging rules
- devtools UI rules
- the requirement to keep this README up to date after changes

## Non-goals

`devhost` is not trying to be:

- Docker Compose
- a persistent daemon
- a remote orchestration system
- a generic wildcard-host generator

If you want those, this tool is the wrong layer.

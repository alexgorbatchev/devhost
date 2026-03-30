# devhost

`devhost` is a Bun-based local development host runner for projects behind Caddy.

It has two modes:

- **single-service mode** — start one app, wait for readiness, and register one public host
- **manifest mode** — load `devhost.toml`, start a local stack, wait for each service, and register routed hosts

## What it does

`devhost`:

- starts local child processes
- injects `HOST`, `PORT`, and `DEVHOST_*` environment variables
- validates and loads `devhost.toml` with Bun TOML parsing plus Zod v4 validation
- reserves public hosts before starting routed services
- waits for readiness before enabling routes
- reloads Caddy when routes change
- prefixes its own logs with the manifest `name` in manifest mode, falling back to `[devhost]`
- prefixes child service logs with `[service-name]`
- optionally injects a small devtools UI into HTML document navigations

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
bun run dev --host hello.xcv.lol --port 3200 -- bun run test:hello
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
8. waits for readiness before routing each service
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
publicHost = "hello.xcv.lol"
```

Supported service fields:

- `command: string[]`
- `cwd?: string`
- `env?: Record<string, string>`
- `port?: number | "auto"`
- `bindHost?: "127.0.0.1" | "0.0.0.0" | "::1" | "::"`
- `publicHost?: string`
- `dependsOn?: string[]`
- `ready?: { tcp: number } | { http: string } | { process: true }`

Rules worth remembering:

- `cwd` is resolved relative to the directory containing `devhost.toml`
- `cwd` must stay inside the manifest directory tree
- `command` must be an argv array, not a shell string
- `port = "auto"` is supported
- `port = "auto"` must omit explicit `ready` in v1
- `devtools` defaults to `true`

For the full contract, read `../docs/toml-config.md`.

## Injected environment

For routed services, `devhost` injects:

- `DEVHOST_STACK`
- `DEVHOST_SERVICE`
- `DEVHOST_BIND_HOST`
- `DEVHOST_MANIFEST_PATH`
- `PORT` when a resolved port exists
- `DEVHOST_PUBLIC_HOST` when routed
- `HOST` when routed

`HOST` is compatibility-only. Some frameworks treat it as a bind address, so do not assume every dev server handles it correctly.

## Devtools injection

When devtools are enabled, routed traffic is split like this:

- `/__devhost__/*` → devtools control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path.

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

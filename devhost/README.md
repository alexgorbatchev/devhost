# devhost

`devhost` is a CLI utility for local development that lets you open your local apps on HTTPS domains instead of raw `localhost:port` URLs, and can inject useful devtools directly into routed pages.

Configure your stack in `devhost.toml`, then run it through `devhost`.

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
> For custom domains, that means loopback resolution, such as exact `A` / `AAAA` records to `127.0.0.1` / `::1`, wildcard DNS records on your domain, or local host entries for exact names.
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.
> If you use other domains, such as `*.local.test`, you must provide name resolution yourself. `/etc/hosts` only handles exact hostnames, so wildcard setups need real DNS records somewhere.

## Quick start

```toml
name = "hello-stack"

[caddy]
autostop = true

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
cwd = "."
port = 3000
host = "foo.localhost"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api:dev"]
cwd = "."
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

Then:

```bash
$ devhost
$ open https://foo.localhost
```

`devhost` also has managed Caddy lifecycle commands:

- `devhost caddy start`
- `devhost caddy stop`
- `devhost caddy trust`
- `devhost caddy download`

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
- includes an Alt-held annotation mode for selecting multiple page elements, drafting a comment, and starting a Pi session from that draft
- exposes devhost control routes under `/__devhost__/*`
- includes a websocket status stream when devtools control routing is enabled

## Requirements

- `bun`
- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` when `[devtools.editor].ide = "neovim"`

## CLI usage

Show help:

```bash
devhost --help
```

### Managed Caddy commands

Download the managed Caddy binary if you do not already have `caddy` on your `PATH`:

```bash
devhost caddy download
```

`devhost` uses that downloaded binary when present. Otherwise it falls back to the global `caddy` executable from your `PATH`.
It does **not** auto-download Caddy during `devhost caddy start` or stack startup.

Start the managed Caddy instance:

```bash
devhost caddy start
```

Stop it:

```bash
devhost caddy stop
```

Managed Caddy may prompt for your password when it needs to install its local CA into the system trust store.
`devhost caddy start` and `devhost caddy trust` stream Caddy's own output directly so the trust/install flow is visible.
Trust its local CA once after it is running:

```bash
devhost caddy trust
```

The generated Caddy config uses these defaults:

- state dir: `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`
- admin API: `127.0.0.1:20193` unless `DEVHOST_CADDY_ADMIN_ADDRESS` is set
- listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on `:443`
- listener binding on non-macOS: loopback only via Caddy `default_bind 127.0.0.1 [::1]`

### Start a stack

```bash
devhost
```

or:

```bash
devhost --manifest ../test/devhost.toml
```

Behavior:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` is provided
2. parses TOML and validates schema and semantics
3. resolves `port = "auto"`
4. starts managed Caddy automatically when `[caddy].autostop = true`, otherwise requires the managed Caddy admin API to already be available
   - this manages the process lifecycle only; it does **not** auto-download the Caddy binary
5. reserves all public hosts
6. starts services in dependency order
7. waits for each service health check before routing it
8. tears down routes and children on exit or failure
9. stops managed Caddy on exit when `[caddy].autostop = true`

When `[caddy].autostop = true`, `devhost` blocks other stacks from starting until the owning stack exits.

## Platform caveat

On macOS, this now starts rootlessly by avoiding loopback-specific listener binding.
That fixes startup, but it also means the managed Caddy instance is not loopback-only on that platform.
If you need strict loopback-only HTTPS on privileged ports, the correct solution is a privileged launcher such as `launchd` socket activation, not pretending wildcard binding is equivalent.

On non-macOS platforms, opening HTTPS on `:443` still requires privileged-port setup outside `devhost`.
`devhost` does not configure `sudo`, `setcap`, `authbind`, or firewall redirection for you.

## `devhost.toml`

The manifest reference lives in [`./devhost.example.toml`](./devhost.example.toml).
Use that file as the documented source of truth for:

- top-level sections
- allowed values
- defaults
- health variants
- inline explanations and copy/paste examples

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

## Injected environment

`devhost` injects environment variables into each service child process.
Only `DEVHOST_BIND_HOST` and `PORT` are operational bind inputs.
The remaining variables are context metadata and must not be used as socket bind targets.

### Operational bind inputs

- `DEVHOST_BIND_HOST`
  - the actual interface the child process is expected to listen on
  - use this for binding sockets
- `PORT`
  - the listening port selected by `devhost`
  - injected when the service defines `port`, including `port = "auto"`
  - not injected for services that do not define `port`

### Routed-service context

- `DEVHOST_HOST`
  - injected only for routed services with `host`
  - the public routed hostname from the service `host` field
  - use this when the app needs to know its public development URL or origin

### Manifest metadata

- `DEVHOST_SERVICE_NAME`
  - the manifest service key for the current child process
- `DEVHOST_MANIFEST_PATH`
  - the absolute path to the resolved `devhost.toml`

## Devtools injection

When devtools are enabled, routed traffic is split like this:

- `/__devhost__/*` → devtools control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path.

The injected devtools UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page.

The injected UI now uses a hold-to-select annotation trigger instead of a persistent corner button. In annotation mode:

- hold `Alt` (`Option` on macOS) to enter annotation selection mode
- click one or more page elements while holding `Alt` to place numbered markers
- release `Alt` to leave selection mode while keeping the current draft open
- write a comment that references markers like `#1` and `#2`
- click `Submit` or press `⌘ ↵` / `Ctrl + Enter` to start an agent session seeded with the draft
- click `Cancel` or press `Escape` to discard the draft

The submitted draft includes the current stack name, page URL/title, comment text, and collected per-marker element metadata.

When the host page is a React development build that exposes component source metadata, each marker also captures the nearest available component source location (file path, line, column, and component name when available). When the host app serves fetchable source maps, devhost also attempts to symbolicate generated bundle locations back to original source files before storing the annotation.

Alt + right-click component-source navigation uses the configured `[devtools.editor].ide` value. The popup title names that configured editor directly, so the action stays aligned with the actual target. Protocol-based editors such as VS Code, VS Code Insiders, Cursor, and WebStorm open via their browser URL handlers. When `[devtools.editor].ide = "neovim"`, devhost launches Neovim inside the injected xterm terminal instead, so `nvim` must be available on the machine running `devhost`.

Embedded terminal sessions now normalize their terminal environment to `TERM=xterm-256color` and `COLORTERM=truecolor` so terminal UIs like Neovim render against the actual xterm.js emulator instead of inheriting incompatible host-terminal identities. Neovim component-source sessions also expand to fill the available viewport when opened as a modal.

When all devtools features are disabled, devhost does not mount these control routes for that stack.

### Annotation agents

Configure a project-local annotation launcher with a root-level `[agent]` table.

Use built-in agent adapters for quick setup:

```toml
[agent]
adapter = "claude-code"
```

Supported adapters: `"pi"`, `"claude-code"`, and `"opencode"`. When `[agent]` is omitted, `devhost` starts Pi by default.

For custom annotation agents, provide an explicit command:

```toml
[agent]
displayName = "My Agent"
command = ["bun", "./scripts/devhost-agent.ts"]
cwd = "."

[agent.env]
DEVHOST_AGENT_MODE = "annotation"
```

`devhost` executes custom agent commands directly, not through a shell string.
For configured commands, `devhost` writes the annotation JSON and rendered prompt to temp files and injects them via `DEVHOST_AGENT_*` environment variables. Built-in adapters receive the rendered prompt natively via command-line arguments.

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

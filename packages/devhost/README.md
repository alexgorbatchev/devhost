# @alexgorbatchev/devhost

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough — auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app.

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`
- waits for health checks before exposing routes
- optionally injects browser devtools for logs, service status, annotations, source jumping, browser-hosted Neovim, and aggregated third-party launcher buttons

## Quick start

### Installation

```bash
npm install -g @alexgorbatchev/devhost
```

### Minimal example

Configure your stack in `devhost.toml`, then run it through `devhost`.

```toml
name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

Most projects should wrap `devhost` in the package's `package.json` so you can run it through the usual dev script from the manifest directory:

```json
{
  "scripts": {
    "dev": "devhost"
  }
}
```

Then run your usual package-manager dev command from that package directory:

```bash
$ npm run dev
$ open https://foo.localhost
```

(`pnpm dev`, `yarn dev`, and `bun run dev` work the same way when they invoke the same script.)

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
>
> For custom domains, that means loopback resolution, such as exact `A` / `AAAA` records to `127.0.0.1` / `::1`, wildcard DNS records on your domain, or local host entries for exact names. `/etc/hosts` can be
> used, however it only handles _exact_ hostnames.
>
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

## What it does

`devhost`:

- routes local apps onto HTTPS hostnames through one shared managed Caddy instance
- starts local child processes from `devhost.toml`
- injects runtime context such as `PORT` and `DEVHOST_*` environment variables
- validates manifests, reserves public hosts, reserves fixed bind ports, and waits for health checks before routing traffic
- allocates `port = "auto"` best-effort and retries on clear bind-collision startup failures
- optionally injects a devtools UI for annotations, source navigation, browser-hosted Neovim, and aggregated third-party devtools launchers

## Requirements

- `bun`
- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` when `[devtools.editor].ide = "neovim"`

## Managed Caddy

Download the managed Caddy binary if you do not already have `caddy` on your `PATH`:

```bash
devhost caddy download
```

`devhost` uses that downloaded binary when present. Otherwise it falls back to the global `caddy` executable from your `PATH`. It does **not** auto-download Caddy during `devhost caddy start` or stack startup.

> [!IMPORTANT]
> To get HTTPS working, Caddy uses a self-signed certificate, which obviously isn't trusted by default.
>
> The `devhost caddy trust` will prompt for your password and install Caddy's CA into the system trust store.

Start the shared managed Caddy instance before running one or more stacks:

```bash
devhost caddy start
```

Stop it when you are done with all stacks:

```bash
devhost caddy stop
```

The generated Caddy config uses these defaults:

- state dir: `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`
- admin API: `127.0.0.1:20193` unless `DEVHOST_CADDY_ADMIN_ADDRESS` is set
- listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on `:443`
- listener binding on non-macOS: loopback only via Caddy `default_bind 127.0.0.1 [::1]`
- unmatched hostnames: a generated 404 page listing the currently active devhost hostnames as HTTPS links

Managed Caddy lifecycle is shared and manual. `devhost` stack startup requires the managed Caddy admin API to already be available.

### Shared multi-stack behavior

Multiple projects can run against the same managed Caddy instance at the same time.

The routing contract is strict:

- hostname ownership is exclusive across projects
- one project cannot claim a hostname that is already owned by another live devhost process
- one manifest may mount multiple services under the same hostname on distinct paths
- fixed numeric bind ports are claimed globally across devhost processes before service spawn
- `port = "auto"` remains best-effort in v1; devhost retries on clear bind collisions, but it does not provide a cross-process global auto-port allocator

### Platform caveats

On macOS, this now starts rootlessly by avoiding loopback-specific listener binding.
That fixes startup, but it also means the managed Caddy instance is not loopback-only on that platform.
If you need strict loopback-only HTTPS on privileged ports, the correct solution is a privileged launcher such as `launchd` socket activation, not pretending wildcard binding is equivalent.

On non-macOS platforms, opening HTTPS on `:443` still requires privileged-port setup outside `devhost`.
`devhost` does not configure `sudo`, `setcap`, `authbind`, or firewall redirection for you.

## Stack lifecycle

When you run `devhost`, it:

1. discovers `devhost.toml` upward from the current directory, unless `--manifest` is provided
2. parses TOML and validates schema and semantics
3. resolves `port = "auto"` before spawning children
4. requires the managed Caddy admin API to already be available
5. reserves fixed numeric bind ports before starting any service that uses them
6. reserves every public hostname before starting any service
7. starts services in dependency order
8. waits for each service health check before routing it
9. removes routes and reservations on shutdown or startup failure

`devhost`-owned logs use the manifest `name` when available and fall back to `[devhost]`. Child service logs remain prefixed with `[service-name]`.

## `devhost.toml`

The manifest reference lives in [`./devhost.example.toml`](./devhost.example.toml).
Use that file as the documented source of truth for:

- top-level sections
- allowed values
- defaults
- health variants
- inline explanations and copy/paste examples

Copy it to `devhost.toml` in your project root and trim it down to the services you actually run.

Each TOML table must be declared once. Keep all fields for a service inside a single `[services.<name>]` block instead of reopening that table later.

For same-host composition within one manifest, use distinct paths such as `/api/*` and `/admin/*`, or combine one root-mounted fallback service with more specific subpath services on the same hostname.

### Docker-backed services

`devhost` can front a Docker- or Compose-managed backend, but only when the container publishes a port onto the host and `devhost` routes to that host-visible port.
`devhost` does not proxy to Docker-internal service names or container-network-only addresses.

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
  - for `port = "auto"`, the selected port is best-effort in v1 and may be retried if the child reports a clear bind collision during startup
  - not injected for services that do not define `port`

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

## Devtools

When `devtools` are enabled, routed traffic is split like this:

- `/__devhost__/*` → `devtools` control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path. The control server also owns the websocket status stream used by the injected UI.

The injected `devtools` UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page.

When `[devtools.externalToolbars].enabled = true` (the default), devhost also detects supported third-party devtools launcher buttons on the host page, hides the native launcher buttons, and re-renders those launchers inside the injected overlay. The native panels themselves stay owned by the host tools.

### AI annotations

- hold `Alt` (`Option` on macOS) to enter annotation selection mode
- click one or more page elements while holding `Alt` to place numbered markers
- release `Alt` to leave selection mode while keeping the current draft open
- write a comment that references markers like `#1` and `#2`
- click `Submit` or press `⌘ ↵` / `Ctrl + Enter` to start an agent session seeded with the draft
- when `Append to active session queue` is enabled, the draft is added to the matching routed service's active agent queue instead of being injected immediately into a busy terminal
- queued annotations are bucketed by routed service host/path, survive browser reloads and `devhost` restarts, drain automatically when the agent emits `OSC 1337;SetAgentStatus=finished`, and can be edited or removed from the injected queue panel while they are queued or paused
- click `Cancel` or press `Escape` to discard the draft

The submitted draft includes the current stack name, page URL/title, comment text, and collected per-marker element metadata.

When the host page is a React development build that exposes component source metadata, each marker also captures the nearest available component source location (file path, line, column, and component name when available). When the host app serves fetchable source maps, devhost also attempts to symbolicate generated bundle locations back to original source files before storing the annotation.

### Open source in IDE

`Alt` + `right-click` component-source navigation uses the configured `[devtools.editor].ide` value. The popup title names that configured editor directly, so the action stays aligned with the actual target. Protocol-based editors such as VS Code, VS Code Insiders, Cursor, and WebStorm open via their browser URL handlers. When `[devtools.editor].ide = "neovim"`, devhost launches Neovim inside the injected xterm terminal instead, so `nvim` must be available on the machine running `devhost`.

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

All built-in adapters natively integrate terminal OSC sequences to reflect working and idle states during embedded session execution, and the durable annotation queue now depends on those same status events to know when to drain queued work:

- `pi` leverages an injected extension to capture `agent_start` and `agent_end` hooks
- `claude-code` utilizes its `--settings` API mapping commands to its native session and user prompt hooks
- `opencode` integrates via an inline `--config` plugin listening for `session.status` events

Custom annotation agents must emit `OSC 1337;SetAgentStatus=working` when they begin handling an annotation and `OSC 1337;SetAgentStatus=finished` when they are ready for the next queued item. `devhost` accepts either BEL (`\x07`) or ST (`\x1b\\`) OSC terminators.

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

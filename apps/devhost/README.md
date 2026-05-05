# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough — auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app.

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- waits for health checks before exposing managed routes
- optionally injects browser devtools for logs, service status, annotations, browser-hosted Neovim sessions, and aggregated third-party launcher buttons

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases also include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To install the manifest-authoring bootstrap skill from this repository:

```bash
npx skills add https://github.com/alexgorbatchev/devhost --skill devhost-bootstrap -y
```

Omit `-y` to choose target agents interactively.

To print the CLI build version:

```bash
devhost --version
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
- starts managed foreground child processes, can drive managed daemon-style services through explicit lifecycle commands, and can also route already-running services from `devhost.toml`
- injects runtime context such as `PORT` and `DEVHOST_*` environment variables into managed service commands
- validates manifests, reserves public hosts, reserves fixed bind ports, and waits for managed-service health checks before routing traffic
- allocates `port = "auto"` best-effort and retries on clear bind-collision startup failures
- optionally injects a devtools UI for annotations, browser-hosted Neovim sessions, and aggregated third-party devtools launchers

## Requirements

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

On Linux, set up low-port binding for the managed Caddy binary once before the first HTTPS start:

```bash
devhost caddy privileged-ports
```

That command downloads the managed Caddy binary first when needed, then runs `sudo setcap 'cap_net_bind_service=+ep'` against that managed binary so later `devhost caddy start` runs can stay unprivileged.

> [!IMPORTANT]
> To get HTTPS working, Caddy uses a self-signed certificate that is not trusted by default.
>
> The `devhost caddy trust` will prompt for your password and install Caddy's CA into the system trust store.

If you want to trust that same managed Caddy CA from another macOS machine without exposing the Caddy admin API, run this from the client machine:

```bash
devhost caddy trust-remote devbox
```

That command SSHes to `devbox`, runs `devhost caddy print-root-cert` remotely, prints the fetched root certificate SHA-256 fingerprint, and installs it into the local macOS System keychain. It requires `ssh` locally, `devhost` on the remote host's `PATH`, and a root certificate that has already been generated on the remote host by `devhost caddy start`.

Start the shared managed Caddy instance before running one or more stacks:

```bash
devhost caddy start
```

If you want `devhost caddy start`, `stop`, or `trust` to honor a manifest-defined admin API address, pass the manifest explicitly on that subcommand:

```bash
devhost caddy start --manifest ./devhost.toml
```

You can also set `DEVHOST_MANIFEST=./devhost.toml` as the environment-backed equivalent of `--manifest` for `devhost` and for `devhost caddy start|stop|trust`. If both are set for the same command, the CLI flag wins.

Stop it when you are done with all stacks:

```bash
devhost caddy stop
```

The generated Caddy config uses these defaults:

- state dir: `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`
- admin API: `127.0.0.1:20197` by default via `caddy.global.adminAddress`
- HTTPS listener port: `443` by default via `caddy.global.httpsPort = 443`
- listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on the default privileged HTTPS port
- listener binding on non-macOS: loopback only by default via `caddy.global.bindHost = "127.0.0.1"`, rendered as Caddy `default_bind 127.0.0.1 [::1]`
- plain HTTP: disabled by default; any active stack with `caddy.global.http = true` enables the same routed hosts and shared fallback page on HTTP for all active stacks
- HTTP listener port: `80` by default via `caddy.global.httpPort = 80`
- unmatched hostnames: a generated 404 page listing the active devhost hostnames as HTTPS links

Managed Caddy lifecycle is shared and manual. `devhost` stack startup requires the managed Caddy admin API to already be available.

### Shared multi-stack behavior

Multiple projects can run against the same managed Caddy instance at the same time.

The routing contract is strict:

- hostname ownership is exclusive across projects
- one project cannot claim a hostname that is already owned by another live devhost process
- one manifest may mount multiple services under the same hostname on distinct paths
- fixed numeric bind ports are claimed globally across devhost processes before service spawn, and claim failures report a quoted normalized listening command line plus manifest path when devhost can discover the active socket listener
- `port = "auto"` is best-effort; `devhost` retries on clear bind collisions, but it does not provide a cross-process global auto-port allocator

### Platform caveats

On macOS, the managed Caddy instance starts rootlessly by avoiding loopback-specific listener binding.
That keeps startup unprivileged, but it also means the managed Caddy instance is not loopback-only on that platform.
If you need strict loopback-only HTTPS on privileged ports, the correct solution is a privileged launcher such as `launchd` socket activation, not pretending wildcard binding is equivalent.

On non-macOS platforms, opening HTTPS on the configured `caddy.global.httpsPort` still requires privileged-port setup outside `devhost` when that port is privileged.
Enabling `caddy.global.http = true` adds the same requirement for `caddy.global.httpPort` when that port is privileged.
On Linux, `devhost caddy privileged-ports` configures the managed Caddy binary for this with `setcap`.
`devhost` does not configure `authbind` or firewall redirection for you.
`caddy.global.bindHost`, `caddy.global.httpPort`, and `caddy.global.httpsPort` only change the public HTTP/HTTPS listeners. `caddy.global.adminAddress` configures the separate managed Caddy admin API endpoint.

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

### Docker-backed services

`devhost` can front a Docker- or Compose-managed backend, but only when the container publishes a port onto the host and `devhost` routes to that host-visible port.
`devhost` does not proxy to Docker-internal service names or container-network-only addresses.

If another process or tool already owns the backend lifecycle, declare that service with `managed = false` so devhost claims the hostname and fixed port without trying to spawn or restart it.

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
They can still use fixed-port routing and explicit TCP or HTTP health checks, but `health.process` is invalid because devhost does not own a child process for them.

### Managed daemon-style services

Use daemon lifecycle mode when `devhost` should own a service, but the service itself backgrounds or is controlled through explicit `start` / `stop` commands instead of one long-lived foreground child process.

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

## Devtools

When `devtools` are enabled, routed traffic is split like this:

- `/__devhost__/*` → `devtools` control server
- `Sec-Fetch-Dest: document` requests → document injector server
- everything else → app directly

That keeps assets, HMR, fetches, SSE, and WebSockets off the injection path. The control server also owns the websocket status stream used by the injected UI.

The injected `devtools` UI mounts inside its own Shadow DOM container so its runtime styles do not leak into the host page.

Routed services in the injected status panel become links automatically, and clicking one opens that service URL in a new browser tab/window by default.
The panel labels devhost-owned services as `managed` and externally owned services as `external`; only managed services expose restart controls.

When `[devtools.externalToolbars].enabled = true` (the default), devhost also detects supported third-party devtools launcher buttons on the host page, hides the native launcher buttons, and re-renders those launchers inside the injected overlay. The native panels themselves stay owned by the host tools.

The injected overlay is always docked on the right edge of the browser. Use `[devtools.status].position` to switch between `top-right` and `bottom-right`.

### AI annotations

- hold `Alt` (`Option` on macOS) to enter annotation selection mode
- click one or more page elements while holding `Alt` to place numbered markers
- release `Alt` to leave selection mode while keeping the current draft open
- write a comment that references markers like `#1` and `#2`
- click `Submit` or press `⌘ ↵` / `Ctrl + Enter` to start the selected annotation action with the draft
- when `Append to active session queue` is enabled, the draft is added to the matching routed service's active agent queue instead of being injected immediately into a busy terminal
- queued annotations are bucketed by routed service host/path, survive browser reloads and `devhost` restarts, drain automatically when the agent emits `OSC 1337;SetAgentStatus=finished`, and stay collapsed into a compact progress summary until you expand the queue to edit or delete queued or paused items
- click `Cancel` or press `Escape` to discard the draft

Annotation selection runs through a selector plugin. The built-in DOM picker is one plugin in that registry, so custom host pages can replace it with a higher-priority selector when the selectable surface is not plain DOM.

`devhost` exposes that registry through the host page at runtime so mirrored previews, canvas-based UIs, terminal surfaces, and other non-DOM inspection targets can participate in the same annotation draft, queue, and submission flow.

The exact runtime contract is:

```ts
type AnnotationSelectionIntent = "hover" | "select";

interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IAnnotationSourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface IAnnotationMarkerPayload {
  accessibility: string;
  boundingBox: IRectSnapshot;
  computedStyles: string;
  computedStylesObj: Record<string, string>;
  cssClasses: string;
  element: string;
  elementPath: string;
  fullPath: string;
  isFixed: boolean;
  markerNumber: number;
  nearbyElements: string;
  nearbyText: string;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

interface IAnnotationSelectionCandidate {
  id: string;
  label: string;
  readRect(): IRectSnapshot | null;
  buildMarkerPayload(markerNumber: number): Promise<IAnnotationMarkerPayload>;
}

interface IAnnotationSelectionPluginContext {
  isDevtoolsEventTarget(target: EventTarget | null): boolean;
}

interface IAnnotationSelectionPlugin {
  id: string;
  label: string;
  priority?: number;
  matches?(): boolean;
  getCursorStyleText?(): string | null;
  resolveCandidate(
    event: MouseEvent,
    intent: AnnotationSelectionIntent,
    context: IAnnotationSelectionPluginContext,
  ): IAnnotationSelectionCandidate | Promise<IAnnotationSelectionCandidate | null> | null;
}

interface IAnnotationSelectionPluginRegistry {
  listPlugins(): IAnnotationSelectionPlugin[];
  registerPlugin(plugin: IAnnotationSelectionPlugin): () => void;
  subscribe(listener: () => void): () => void;
  unregisterPlugin(pluginId: string): void;
}
```

At runtime, `devhost` installs `globalThis.__DEVHOST__` as an `IAnnotationSelectionPluginRegistry`, drains any plugins preloaded into `globalThis.__DEVHOST_PLUGINS__`, and dispatches `window` event `devhost:annotation-selection-ready` after the registry is ready.

Selection semantics:

- the built-in DOM selector plugin is always registered with id `dom-elements`
- `matches()` defaults to `true` when omitted
- `priority` defaults to `0` when omitted
- the active selector is the highest-priority matching plugin
- when priorities tie, the earlier-registered matching plugin stays active
- returning `null` from `resolveCandidate(...)` means that event does not produce a candidate
- `readRect()` controls the draft highlight box; return `null` when there is nothing to highlight
- `getCursorStyleText()` returns raw CSS text that `devhost` injects only while annotation selection mode is active; return `null` or omit it for no cursor override

Register a host-page plugin directly against the runtime registry:

```js
const plugin = {
  id: "custom-surface",
  label: "Custom surface",
  priority: 10,
  matches() {
    return true;
  },
  resolveCandidate(event, intent, context) {
    if (context.isDevtoolsEventTarget(event.target)) {
      return null;
    }

    return {
      id: "target-1",
      label: "Target 1",
      readRect() {
        return { x: 0, y: 0, width: 100, height: 40 };
      },
      async buildMarkerPayload(markerNumber) {
        return {
          accessibility: "",
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
          computedStyles: "",
          computedStylesObj: {},
          cssClasses: "",
          element: "Target 1",
          elementPath: "Target 1",
          fullPath: "Target 1",
          isFixed: false,
          markerNumber,
          nearbyElements: "",
          nearbyText: "",
        };
      },
    };
  },
};

const registry = globalThis.__DEVHOST__;

if (registry) {
  registry.registerPlugin(plugin);
} else {
  globalThis.__DEVHOST_PLUGINS__ ??= [];
  globalThis.__DEVHOST_PLUGINS__.push(plugin);
}
```

The submitted draft includes the current stack name, page URL/title, comment text, and collected per-marker element metadata.

When the host page is a React development build that exposes component source metadata, each marker captures the nearest available component source location (file path, line, column, and component name when available). When the host app serves fetchable source maps, `devhost` attempts to symbolicate generated bundle locations back to original source files before storing the annotation.

### Open component source

The shipped Go runtime supports `Alt` + `right-click` component-source navigation whenever `[devtools.editor].enabled = true`.

- When `[devtools.editor].ide = "neovim"`, devhost launches Neovim inside the injected xterm terminal, so `nvim` must be available on the machine running `devhost`.
- Other supported editors use their direct external-editor URL launch path instead of the embedded terminal.

Embedded terminal sessions normalize their terminal environment to `TERM=xterm-256color` and `COLORTERM=truecolor` so terminal UIs like Neovim render against the xterm.js emulator instead of inheriting incompatible host-terminal identities. Neovim component-source sessions expand to fill the available viewport when opened as a modal.

When all devtools features are disabled, devhost does not mount these control routes for that stack.

## Troubleshooting

### Vite: `localhost` and `127.0.0.1` can be different apps

Some dev servers print a URL like `http://localhost:5173`, and many projects copy that port directly into `devhost.toml`.

On some machines, though, `http://localhost:5173` and `http://127.0.0.1:5173` do not hit the same listener:

- `localhost` may resolve to `::1`
- `devhost` defaults `bindHost` to `127.0.0.1`
- a routed hostname such as `https://app.localhost` will therefore proxy to `127.0.0.1:<port>` unless you override `bindHost`

That can produce confusing behavior where the direct printed `localhost` URL works, but the routed `*.localhost` hostname lands on a different local process or response.

When `devhost` detects that mismatch, it logs an explicit startup warning.

For Vite-style apps that are actually listening on IPv6 loopback, set `bindHost = "::1"` explicitly:

```toml
[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
bindHost = "::1"
host = "app.localhost"
```

If you are unsure which listener your app is using, compare these directly:

```bash
curl -I http://localhost:5173/
curl -I http://127.0.0.1:5173/
curl -I http://[::1]:5173/
```

If those responses differ, set `bindHost` explicitly instead of relying on the default.

### Composite services: inherited `PORT` can miswire child processes

Some "one command" dev scripts are really wrappers that launch multiple long-lived processes, such as a frontend dev server plus an API worker.

By default, `devhost` injects the configured service `port` as `PORT` into that top-level command.
If the wrapper passes its environment through unchanged, every nested child process may inherit the same `PORT`.

That can produce confusing failures such as:

- one child binding the routed service port even though that port was intended for a different nested process
- another child silently moving to a fallback port after seeing the inherited `PORT` already in use
- the frontend proxying `/api` to its usual target while the API actually bound somewhere else
- routed requests returning backend `404`s even though the main page appears to load normally

If your manifest service launches multiple dev processes under one command, prefer splitting them into separate `devhost` services.
If you intentionally keep a composite wrapper, set `injectPort = false` on that service and configure the underlying processes explicitly instead:

```toml
[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
injectPort = false
host = "app.localhost"
```

### Annotation actions

Configure annotation launchers with a root-level `[annotation]` table and one or more `[[annotation.actions]]` entries.
Each action declares a stable `id`, a UI `label`, and a `kind`. Set `defaultAction` when the UI should preselect an action other than the first one.

Agent actions use the existing built-in integrations:

```toml
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
label = "Ask Claude"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"
```

Supported agent adapters are `"pi"`, `"claude-code"`, and `"opencode"`.
For a custom agent action, omit `adapter` and set `command` plus `displayName` inside `[annotation.actions.agent]`; the parent `label` is the action label shown in the composer, and `displayName` remains the agent display name used by the legacy agent environment contract.

Generic command actions run directly in a devhost terminal and receive the annotation through context files:

```toml
[annotation]

[[annotation.actions]]
id = "lint"
label = "Run lint"
kind = "command"

[annotation.actions.command]
command = ["bun", "run", "lint"]
cwd = "."

[annotation.actions.command.env]
CI = "1"
```

`devhost` executes command actions directly, not through a shell string. Command actions receive:

- `DEVHOST_ANNOTATION_ACTION_ID`
- `DEVHOST_ANNOTATION_ACTION_KIND`
- `DEVHOST_ANNOTATION_ACTION_LABEL`
- `DEVHOST_ANNOTATION_DISPLAY_NAME`
- `DEVHOST_ANNOTATION_FILE`
- `DEVHOST_ANNOTATION_PROMPT_FILE`
- `DEVHOST_ANNOTATION_TRANSPORT=files`
- `DEVHOST_PROJECT_ROOT`
- `DEVHOST_STACK_NAME`

Agent actions continue to support durable annotation queues. Command actions start standalone terminal sessions and are not queued.

The injected config includes UI-safe action metadata as `annotationActions`, with each action exposing `id`, `displayName`, `kind`, and `queueEnabled`, plus `annotationDefaultActionId` for the selected default. The legacy `agentDisplayName` field remains present for compatibility.

### Legacy annotation agents

Configure a project-local annotation launcher with a root-level `[agent]` table.

Use built-in agent adapters for quick setup:

```toml
[agent]
adapter = "claude-code"
```

Supported adapters: `"pi"`, `"claude-code"`, and `"opencode"`. When both `[agent]` and `[annotation]` are omitted, `devhost` starts Pi by default. When `[annotation]` is omitted but `[agent]` is present, devhost exposes one default annotation action backed by `[agent]`.
Define either `[annotation]` or `[agent]`, not both, in the same manifest.

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
For configured commands, `devhost` writes the annotation JSON and rendered prompt to temp files and injects them via `DEVHOST_AGENT_*` and neutral `DEVHOST_ANNOTATION_*` environment variables. Built-in adapters receive the rendered prompt natively via command-line arguments.

All built-in adapters integrate terminal OSC sequences to reflect working and idle states during embedded session execution, and the durable annotation queue uses those same status events to decide when to drain queued work:

- `pi` leverages an injected extension to capture `agent_start` and `agent_end` hooks
- `claude-code` utilizes its `--settings` API mapping commands to its native session and user prompt hooks
- `opencode` integrates via an inline `--config` plugin listening for `session.status` events

Custom annotation agents must emit `OSC 1337;SetAgentStatus=working` when they begin handling an annotation and `OSC 1337;SetAgentStatus=finished` when they are ready for the next queued item. `devhost` accepts either BEL (`\x07`) or ST (`\x1b\\`) OSC terminators.

## Development

### Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
bun run compile:devhost
./apps/devhost/dist/devhost --version
```

That build refreshes the embedded injected devtools bundle with Bun and writes the CLI binary to `apps/devhost/dist/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`. The generated devtools bundle lives under `apps/devhost/internal/devtools/dist/` for Go `//go:embed` and is not committed; run `bun run build:devtools-bundle:devhost` if you need to refresh only those assets. Source-checkout runs such as `go run ./cmd/devhost --version` use the local placeholder version instead of the packaged release metadata. Bun is only required for source builds inside this repository; the shipped `devhost` binary does not require Bun.

## Contributor notes

Internal development details live in:

- `./AGENTS.md`

## Non-goals

`devhost` is not trying to be:

- Docker Compose
- a persistent stack supervisor; `devhost` still runs in the foreground even when a managed service uses daemon lifecycle commands
- a remote orchestration system
- a DNS manager
- a generic wildcard-host generator

# localhost domains with managed Caddy

This repo gives you a `devhost` Bun wrapper plus a devhost-managed Caddy instance.

`devhost` supports two runtime modes:
- **single-service mode** via `--host` / `--port`
- **manifest mode** via `devhost.toml`

## Requirements

- `bun`
- `caddy`

On macOS:

```bash
brew install caddy
```

## Managed Caddy

`devhost` no longer relies on a checked-in `caddy/` directory.
Instead it generates and manages its own Caddy config under:

- `DEVHOST_STATE_DIR`, when set
- otherwise `XDG_STATE_HOME/devhost`, when `XDG_STATE_HOME` is set
- otherwise `~/.local/state/devhost/caddy`

Start the managed Caddy instance once:

```bash
bun run devhost caddy start
```

Stop it later:

```bash
bun run devhost caddy stop
```

On first startup, managed Caddy may prompt for your password so it can install its local CA into the system trust store.
`devhost caddy start` and `devhost caddy trust` now stream Caddy's own output directly so you can see exactly what is happening.
If your browser does not trust Caddy's local CA yet, trust it once after Caddy is running:

```bash
bun run devhost caddy trust
```

The managed Caddy admin API listens on `http://127.0.0.1:20193/config/` by default.
Override it with `DEVHOST_CADDY_ADMIN_ADDRESS` if needed.

On macOS, `devhost caddy start` now uses wildcard listeners instead of loopback-only binding.
That is deliberate: macOS allows rootless binds on `:443` for wildcard listeners, but still rejects loopback-specific binds like `127.0.0.1:443`.
On non-macOS platforms, opening `:443` still requires privileged-port setup outside `devhost`.

## Important limitation: DNS is still your job

`devhost` now manages Caddy config and lifecycle, but it still does **not** manage DNS.
Your development hostnames must already resolve to this machine.
That can come from `/etc/hosts`, a local DNS server, or a real wildcard DNS setup.

## Demo app setup

This repository uses Bun workspaces.
Install dependencies once from the repository root:

```bash
bun install
```

## Single-service mode

Run the sample app through `devhost`:

```bash
bun run devhost --host hello.xcv.lol --port 3200 -- bun run test:hello
```

Then open:

```text
https://hello.xcv.lol
```

`devhost` uses a split-routing model:

- `/__devhost__/*` goes to the local devhost control server
- document navigation requests go to a small HTML injector that appends one script tag
- all other requests go directly to the app server

This keeps assets, HMR, fetches, and WebSockets out of devhost's proxy path while still allowing page-level injection.

## Manifest mode

The test app has a sample manifest at `test/devhost.toml`.

Run it explicitly from the repository root:

```bash
bun run devhost --manifest ./test/devhost.toml
```

Or run `devhost` from inside the test workspace through its local devDependency:

```bash
cd test && bun run devhost --manifest ./devhost.toml
```

Manifest mode uses Bun's built-in TOML parser and Zod v4 validation.
A root-level `devtools` flag is supported and defaults to `true`.
A root-level `devtoolsComponentEditor` flag is supported and defaults to `"vscode"`.
Supported editor values are `"vscode"`, `"vscode-insiders"`, `"cursor"`, and `"webstorm"`.
When `devtools = false`, routed services bypass the HTML injector and proxy straight to the app.

## How `devhost` works

### Single-service mode

`devhost`:
- starts your app
- sets `PORT`
- sets `DEVHOST_BIND_HOST=127.0.0.1` for safe local binding
- sets `DEVHOST_HOST=<public hostname>` for routed-host awareness
- defaults Alt + right-click component navigation to `vscode`
- accepts `DEVHOST_COMPONENT_EDITOR` to override the single-service editor target
- waits for the app port to open
- registers `https://<host>` in Caddy
- removes the route when the app exits

### Manifest mode

`devhost`:
- discovers `devhost.toml` or accepts `--manifest`
- validates the manifest with Zod v4
- resolves `port = "auto"` before spawning children
- reserves every public host before starting any service
- starts services in dependency order
- prefixes service logs with `[service-name]`
- injects Alt + right-click React component-source navigation for routed pages when devtools are enabled
- opens component sources through the configured editor protocol and also copies the resolved source path to the clipboard when the browser allows it
- activates Caddy routes only after health checks pass
- removes routes and reservations on shutdown or startup failure

## Important note about bind vs routed host

`devhost` separates bind behavior from routed-host awareness.

Use:

```text
DEVHOST_BIND_HOST=127.0.0.1
```

for socket binding, and use:

```text
DEVHOST_HOST=<public hostname>
```

when the app needs to know its routed development hostname.

For manifest mode, `DEVHOST_BIND_HOST` is the configured service bind host.
Do not reuse the routed host as the bind address unless the framework explicitly requires that behavior and you have verified it.

## Component-source navigation

When devtools are enabled on a routed page, `devhost` now supports Alt + right-click component inspection for React apps.
If the host page exposes React development source metadata, `devhost` opens the matching source file in the configured editor protocol and copies the resolved source path to the clipboard.

Important constraints:
- this is best-effort React development metadata introspection, not a production-safe contract
- host apps that strip React source metadata or source maps may show no component-source menu
- relative source paths are resolved against the stack manifest directory before editor URLs are built

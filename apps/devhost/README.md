# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app. Any domain can work as well, as long as it is configured to resolve to the machine running `devhost`.

Documentation: [alexgorbatchev.github.io/devhost](https://alexgorbatchev.github.io/devhost/)

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- waits for health checks before exposing managed routes
- optionally injects browser devtools for logs, service status, annotations, browser-hosted Neovim sessions, hotkey-driven parallel restarts, and aggregated third-party launcher buttons

The injected log minimap is intentionally a compact preview: each log entry stays on a single row and clips horizontally instead of wrapping into a full log viewer.

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To print the CLI build version:

```bash
devhost --version
```

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` and `curl` when `[devtools.editor].ide = "neovim"`

When Neovim editor integration is enabled, devhost loads a bundled `devhost-react-highlight.nvim` plugin for that
devhost instance. The plugin streams TSX/JSX cursor locations back to the injected browser overlay through the
instance's local control port and token, so multiple devhost stacks can run at the same time without sharing editor
state. The browser overlay matches React fiber source metadata first and falls back to fetchable source maps for
bundlers that do not expose fiber source locations. While the stack is running, devhost also writes an instance-scoped
shell launcher at `.tmp/devhost/<stack-name>/nvim-shell/bin/devhost-nvim`; run it from the project to open Neovim with
the same plugin, token, and project root as the browser-launched editor.

### Minimal example

Configure your stack in `devhost.toml`, then run it through `devhost`.

```toml
name = "hello-stack"

[devtools.shortcuts]
restartServices = "alt+ctrl+r"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]
watch = ["src/"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

Most projects should add `devhost` to the relevant `package.json` so you can run it through the usual dev script from the directory that contains the manifest:

```json
{
  "scripts": {
    "dev": "devhost"
  }
}
```

Then prepare Caddy once and start your stack:

```bash
devhost caddy download
devhost caddy trust
devhost caddy start
npm run dev
open https://foo.localhost
```

(`pnpm dev`, `yarn dev`, and `bun run dev` work the same way when they invoke the same script.)

To shut down a running stack cleanly, run the `stop` command from the manifest directory, or point to it explicitly:

```bash
devhost stop
# Or with an explicit manifest:
devhost stop --manifest path/to/devhost.toml
```

This scans active registrations and host/port claims, targets the matching running processes, signals them with SIGTERM, waits for them to stop, and falls back to a force-kill if they do not stop within 15 seconds.

After startup, `devhost` prints one line per reachable service URL using the format `service-name: url`.

### Manifest Interpolation

Manifest string values support environment-variable interpolation with `{{ env.NAME }}` placeholders. This applies to
string fields throughout the manifest, including hosts, paths, cwd values, command arguments, labels, and `env` maps.
Placeholder names must start with a letter or underscore and then use letters, digits, or underscores. Other text
stays literal, including malformed `{{ ... }}` sequences, and an unterminated `{{` keeps the rest of that string
literal. Referencing an undefined valid placeholder is a manifest read error, while defined placeholders may expand to
the empty string.

### Late-Binding Service References

In addition to static environment variable interpolation, `devhost` supports late-binding service references using `{{ services.<name>.<property> }}` placeholders. This allows services to dynamically discover configuration (like auto-allocated ports) right before they are launched:

```toml
[services.postgres]
bindHost = "127.0.0.1"
port = "auto"

[services.poc-backend]
env = { DATABASE_URL = "postgres://...@{{ services.postgres.bindHost }}:{{ services.postgres.port }}/..." }
```

For more details see the [Service References Guide](https://alexgorbatchev.github.io/devhost/guides/service-references/) page.

### Manifest Includes

Manifest includes let you split your `devhost` stack configuration across multiple files. This is particularly powerful in monorepo environments, allowing each sub-application or package to define and manage its own services locally:

```toml
# root devhost.toml
name = "my-monorepo-stack"
includes = ["packages/*/devhost.toml", "apps/*/devhost.toml"]
```

Included manifests are recursively parsed, and their services and annotation actions are merged into the root stack. Relative paths for `cwd` and `watch` folders are automatically resolved, and missing `cwd` keys default to the directory of the manifest they were defined in. See the [Manifest Includes Documentation](https://alexgorbatchev.github.io/devhost/guides/manifest-includes/) page for more details.

### Service Commands

Service commands are executed directly, not through an implicit shell. In practice that means
`command = ["storybook", "dev", "--port", "$PORT"]` passes the literal string `$PORT` as an argument, while
`command = ["sh", "-c", "exec storybook dev --port \"$PORT\""]` lets the shell expand `$PORT` from the child
process environment. Manifest interpolation still happens before launch, so `{{ env.NAME }}` inside command arguments
is also subject to the manifest interpolation rules above.

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
>
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

On Linux, run `devhost caddy privileged-ports` once before the first HTTPS start if you want Caddy to bind privileged ports without running the whole stack as root.

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
bun run compile:devhost
./apps/devhost/dist/devhost --version
```

That build refreshes the embedded injected devtools bundle with Bun and writes the CLI binary to `apps/devhost/dist/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

## Frontend UI development

If you are modifying the injected browser devtools UI (`packages/devhost-ui/`) and want to test your changes instantly without manually rebuilding the Go app or restarting the service stack, you can use the built-in on-demand asset dev loop:

1. Set the `DEVHOST_DEV_ASSETS_DIR` environment variable to your compiled asset directory (e.g. `apps/devhost/internal/devtools/dist` relative to the manifest directory).
2. On every browser page refresh, `devhost` checks if any source files in `packages/devhost-ui/src/devtools/` are newer than the compiled `devtools.js` on disk.
3. If changes are detected, `devhost` automatically serializes and triggers a background build via `bun run build:devtools-bundle:devhost`, and blocks to serve the freshly built assets.
4. If filesystem reads, walking checks, or background compilation fail, the server logs a warning and falls back seamlessly to serving the compile-time embedded assets.

## AI dev host - manifest update skill

To install the manifest-authoring and dev host update skill from this repository:

```bash
npx skills add https://github.com/alexgorbatchev/devhost --skill dev-host-manifest-update -y
```

Omit `-y` to choose target agents interactively.

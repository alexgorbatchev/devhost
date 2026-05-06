# `devhost`

`devhost` gives your local app a proper front door: real hostnames, local HTTPS, and one command to start and route your dev services.

Use it when `localhost:3000` stops being good enough: auth callbacks, cookie/domain behavior, multi-service stacks, or just wanting `app.localhost` and `api.app.localhost` to behave more like a real app.

What it does well:

- routes local services onto HTTPS hostnames through managed Caddy
- starts one service or a full stack from `devhost.toml`, including optional externally managed backends
- waits for health checks before exposing managed routes
- optionally injects browser devtools for logs, service status, annotations, browser-hosted Neovim sessions, and aggregated third-party launcher buttons

## Quick start

### Installation

Download the archive for your platform from [GitHub Releases](https://github.com/alexgorbatchev/devhost/releases), extract it, and place the `devhost` binary on your `PATH`.

Published GitHub Releases include versioned `.tar.gz` archives for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`.

To install the manifest-authoring bootstrap skill from this repository:

```bash
npx skills add https://github.com/alexgorbatchev/devhost --skill devhost-bootstrap -y
```

Omit `-y` to choose target agents interactively.

To print the CLI build version:

```bash
devhost --version
```

### Requirements

- either:
  - a global `caddy` on your `PATH`, or
  - a managed Caddy binary downloaded with `devhost caddy download`
- `nvim` when `[devtools.editor].ide = "neovim"`

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

> [!IMPORTANT]
> `devhost` manages HTTPS routing through Caddy, not DNS.
> Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.
>
> Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

On Linux, run `devhost caddy privileged-ports` once before the first HTTPS start if you want Caddy to bind privileged ports without running the whole stack as root.

## Documentation

The landing page stays intentionally short. The detailed behavior, caveats, and operational guidance live in the docs:

- [Manifest reference](./devhost.example.toml)
- [Managed Caddy and routing](./docs/guides/managed-caddy.md)
- [Service lifecycle and manifest patterns](./docs/guides/service-modes.md)
- [Devtools and annotations](./docs/guides/devtools.md)
- [Troubleshooting](./docs/guides/troubleshooting.md)
- [Architecture deep dives](./docs/architecture/external-devtools.md)

## What `devhost` does

`devhost`:

- routes local apps onto HTTPS hostnames through one shared managed Caddy instance
- starts managed foreground child processes, managed daemon-style services, or already-running external services from `devhost.toml`
- injects runtime context such as `PORT` and selected `DEVHOST_*` variables into managed service commands
- validates manifests, reserves public hosts, reserves fixed bind ports, and waits for managed-service health checks before routing traffic
- allocates `port = "auto"` best-effort and retries on clear bind-collision startup failures
- optionally injects a devtools UI for annotations, browser-hosted Neovim sessions, and aggregated third-party devtools launchers

## Build from source

If you are working from this repository and want a current-platform binary instead of a release download:

```bash
bun run compile:devhost
./apps/devhost/dist/devhost --version
```

That build refreshes the embedded injected devtools bundle with Bun and writes the CLI binary to `apps/devhost/dist/devhost` with the version from `apps/devhost/metadata.json` embedded into `devhost --version`.

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

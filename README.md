# localhost domains with Caddy internal TLS

This repo gives you a single local Caddy instance plus a `devhost` Bun wrapper.

`devhost` now supports two modes:
- **single-service mode** via `--host` / `--port`
- **manifest mode** via `devhost.toml`

## Requirements

- `bun`
- `caddy`

On macOS:

```bash
brew install caddy
```

## Files

- `caddy/Caddyfile` — shared local ingress config using `tls internal`
- `caddy/run.sh` — runs Caddy with the project config
- `devhost/package.json` — isolated devhost package dependencies and scripts
- `devhost/src/index.ts` — devhost CLI entrypoint
- `devhost/src/startStack.ts` — manifest-mode orchestration
- `devhost/src/startSingleService.ts` — existing single-service workflow
- `docs/toml-config.md` — manifest design and implementation contract
- `test/helloWorldServer.ts` — demo Bun server using Bun HTML imports
- `test/index.html` — HTML entrypoint for the test React app
- `test/App.tsx` — React entrypoint mounted from `index.html`
- `test/devhost.toml` — sample manifest for the test app
- `test/package.json` — isolated test app dependencies and scripts

## Initial setup

Start Caddy in one terminal:

```bash
bash caddy/run.sh
```

If your browser does not trust Caddy's local CA automatically, install it once:

```bash
caddy trust
```

## Demo app setup

This repository now uses Bun workspaces.
Install dependencies once from the repository root:

```bash
bun install
```

## Single-service mode

In another terminal, run the sample app through `devhost`:

```bash
bun run devhost --host hello.xcv.lol --port 3200 -- bun run test:hello
```

Then open:

```text
https://hello.xcv.lol
```

The demo page is HTML. `devhost` uses a split-routing model:

- `/__devhost__/*` goes to the local devhost control server
- document navigation requests go to a small HTML injector that appends one script tag
- all other requests go directly to the app server

This keeps assets, HMR, fetches, and WebSockets out of devhost's proxy path while still allowing page-level injection.

## Manifest mode

The test app now has a sample manifest at `test/devhost.toml`.

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
When `devtools = false`, routed services bypass the HTML injector and proxy straight to the app.

## How `devhost` works

### Single-service mode

`devhost`:
- starts your app
- sets `HOST` and `PORT`
- sets `DEVHOST_BIND_HOST=127.0.0.1` for safe local binding
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
- activates Caddy routes only after readiness passes
- removes routes and reservations on shutdown or startup failure

## Domain note

The devhost code no longer hardcodes a specific private domain suffix.
Host validation is syntactic only.
The domains that actually work in this repo are still determined by `caddy/Caddyfile`, which currently routes `xcv.lol` and its subdomains.

## Why this uses `tls internal`

Caddy already supports local HTTPS with its own internal CA. For this setup, adding `mkcert` would just duplicate certificate management for no benefit.

Because `xcv.lol` is a real domain and not `localhost`, the config explicitly uses:

```caddy
xcv.lol, *.xcv.lol {
    tls internal
}
```

That forces local-development certificates instead of public ACME automation.

## Important note about `HOST`

`devhost` sets `HOST=<public hostname>` only as a compatibility variable for child processes.
That is not universally safe across dev servers.
Many frameworks interpret `HOST` as the bind address, not the public URL.

That is why `devhost` also sets:

```text
DEVHOST_BIND_HOST=127.0.0.1
```

For manifest mode, `DEVHOST_BIND_HOST` is the configured service bind host.
If a framework breaks when `HOST=app.xcv.lol`, configure that framework to bind explicitly to `127.0.0.1`, `0.0.0.0`, `::1`, or `::`.

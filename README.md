# localhost domains with Caddy internal TLS

This repo gives you a single local Caddy instance plus a `devhost` Bun wrapper.

`devhost`:
- starts your app
- sets `HOST` and `PORT`
- sets `DEVHOST_BIND_HOST=127.0.0.1` for safe local binding
- waits for the app port to open
- registers `https://<host>` in Caddy
- removes the route when the app exits

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
- `devhost/index.ts` — Bun CLI wrapper for starting apps and registering routes
- `test/helloWorldServer.ts` — demo Bun server using Bun HTML imports
- `test/index.html` — HTML entrypoint for the test React app
- `test/App.tsx` — React entrypoint mounted from `index.html`
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

## Demo

Install the isolated test app dependencies once:

```bash
cd test && bun install
```

In another terminal, run the sample app through `devhost`:

```bash
bun run devhost --host hello.xcv.lol --port 3200 -- bun run test:hello
```

Then open:

```text
https://hello.xcv.lol
```

The demo page is HTML. `devhost` now uses a split-routing model:

- `/__devhost__/*` goes to the local devhost control server
- document navigation requests go to a small HTML injector that appends one script tag
- all other requests go directly to the app server

This keeps assets, HMR, fetches, and WebSockets out of devhost's proxy path while still allowing page-level injection.

## How `devhost` works

Example:

```bash
bun run devhost --host app.xcv.lol --port 3200 -- bun dev
bun run devhost --host db.xcv.lol --port 5100 -- bun run some-other-server.ts
```

Each running `devhost` process creates one route snippet in `caddy/routes/` and reloads Caddy.
When the child process exits, the snippet is removed and Caddy is reloaded again.

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

This wrapper sets `HOST=<public hostname>` because you explicitly asked for that contract.
That is not universally safe across dev servers.
Many frameworks interpret `HOST` as the bind address, not the public URL.

That is why `devhost` also sets:

```text
DEVHOST_BIND_HOST=127.0.0.1
```

The demo server uses `DEVHOST_BIND_HOST` for listening and `HOST` for display.
If a framework breaks when `HOST=app.xcv.lol`, you need to configure that framework to bind explicitly to `127.0.0.1` or `0.0.0.0`.

## Domain note

This repo uses `*.xcv.lol` exactly as requested.
If `xcv.lol` is used for anything real, the safer pattern is `*.dev.xcv.lol`, not the whole zone.

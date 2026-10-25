---
title: "Route apps over HTTPS"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.webp" aria-label="managed caddy demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

devhost routes every service with a `host` through one shared [Caddy](https://caddyserver.com/) server, which serves it over HTTPS on that hostname.

## Prepare Caddy

Do this once per machine:

```bash
devhost caddy download          # skip if `caddy` is already on your PATH
devhost caddy privileged-ports  # Linux only: lets Caddy use port 443 without root
devhost caddy start
```

- devhost uses the downloaded Caddy when it exists, and the `caddy` on your `PATH` otherwise. It never downloads Caddy on its own.
- `devhost caddy privileged-ports` downloads Caddy if needed and runs `sudo setcap cap_net_bind_service=+ep` on it. Run it again if the binary is replaced.
- Caddy keeps running until `devhost caddy stop`. Start it before your first stack; every stack on the machine then uses it.

### Trust the certificates

Caddy signs its certificates with its own local certificate authority. The first time devhost starts Caddy, it installs that authority into your system trust store, which can ask for your password (the prompt starts with `caddy | `). Starting a stack or changing routes never asks.

devhost cannot ask without a terminal or under `AGENT=1`, and the installation can be declined or fail. In each case devhost prints a warning instead, Caddy keeps running, and browsers reject its certificates until you run:

```bash
devhost caddy trust
```

To trust a dev machine's certificates from another Mac, run this on the Mac:

```bash
devhost caddy trust-remote devbox
```

It connects with `ssh`, runs `devhost caddy print-root-cert` on `devbox`, prints the certificate's SHA-256 fingerprint, and installs it into the macOS System keychain. `devbox` needs `devhost` on its `PATH` and must have started Caddy at least once.

## Route a service

Give a service a `host` and the `port` it listens on:

```toml
[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = "app.localhost"
```

`https://app.localhost` now reaches `127.0.0.1:3000`. Startup prints every URL, such as `web (primary): https://app.localhost`.

### Share a hostname between services

Services in one manifest can split a hostname by path. A request goes to the most specific matching `path`:

```toml
[services.web]
command = ["bun", "run", "web:dev"]
port = 3000
host = "app.localhost"

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "app.localhost"
path = "/api/*"
```

`path` defaults to `/`. Two different stacks cannot share a hostname.

## Multiple hostnames for one service

Set `host` to an array to route several hostnames to one service:

```toml
[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = ["app.localhost", "alias.localhost"]
```

- Every hostname uses the same port and `path`.
- The first hostname is the service's main one: it supplies `DEVHOST_HOST`, `{{ services.web.host }}`, and the link in devtools.
- If any hostname is already taken, the stack does not start.

## Development servers that require a local origin

Some dev servers, such as Bun's HTML/HMR server, reject requests addressed to a public hostname. Set `proxyLocalOrigin` on that service:

```toml
[services.web]
command = ["bun", "src/index.ts"]
port = "auto"
host = "app.localhost"
proxyLocalOrigin = true
```

The server then sees its own local address, such as `127.0.0.1:41234`, in the `Host` header, and in `Origin` when the browser's origin matches the public hostname. This applies to pages, assets, sub-paths, and WebSockets.

- Requests with a different `Origin`, an opaque one, or more than one are rejected with `403`.
- `X-Forwarded-Host` keeps the public hostname.
- The local address comes from the service's `bindHost` and `port`, so the server must listen exactly there. devhost does not discover a port the server picks for itself.
- Leave it off for services that accept cross-origin API requests.

## Hostnames and DNS

devhost routes hostnames; it does not create DNS records. A hostname must already resolve to the machine running devhost.

- **`.localhost` names**, such as `app.localhost` and `api.app.localhost`, resolve to the local machine everywhere and need no setup. Use them unless you need a real domain.
- **Other names** need `A`/`AAAA` records pointing at `127.0.0.1`/`::1`, a wildcard DNS record, or `/etc/hosts` entries (exact names only).
- **Other devices**, such as a phone, cannot use `.localhost`, which always means the device itself. Route a hostname that resolves to the dev machine's network address. Caddy listens on all interfaces by default, and the device has to trust Caddy's certificate authority.

The hostname selected by `[caddy].stackDirectoryHost` in the shared `config.toml` (default `devhost.localhost`) is reserved for the [running-stack directory](../stack-lifecycle/#running-stacks-in-the-browser), so no service can use it. That page accepts local clients by default; `[caddy].stackDirectoryAllowRemote = true` in `config.toml` enables reading it from other devices.

An unknown hostname gets a 404 page listing every hostname devhost routes.

## Several stacks, one Caddy

Every project can run its own stack at once. They share Caddy under these rules:

- A hostname belongs to one stack. A stack that claims a hostname another live stack holds fails to start, naming that stack.
- A fixed port belongs to one stack. When devhost can identify the process holding a port, the error shows its command line and manifest.
- `port = "auto"` picks a free port and retries a few times when another process takes it first. Nothing coordinates automatic ports between processes, so a collision is unlikely but possible.

Stopping a stack removes only its routes. Caddy keeps running with its settings, even with no routes left.

## Caddy settings

Caddy's ports, bind address, admin address, and plain-HTTP listener are machine settings in `config.toml`, not in a manifest. See [Proxy ports and listeners](../shared-managed-caddy-settings/).

Each [state directory](../../reference/cli/#files-and-directories) has its own Caddy, so setting `DEVHOST_STATE_DIR` gives you a separate proxy.

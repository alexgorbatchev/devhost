---
title: "Managed Caddy and routing"
sidebar:
  order: 1
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.webp" aria-label="managed caddy demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/managed-caddy.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

`devhost` routes local apps through one shared managed Caddy instance.

## Prepare Caddy

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
> When devhost starts Caddy and the system does not trust Caddy's local certificate authority yet, devhost installs it into the system trust store once. That may ask for your password; the prompt starts with `caddy | `. `devhost caddy trust` does the same at any time, or reports that the authority is already trusted.

Devhost starts Caddy with `devhost caddy start`, and `devhost serve` starts it when it is not running. Without a terminal, or under `AGENT=1`, devhost prints a warning naming `devhost caddy trust` instead of asking for a password. A declined or failed installation prints the same warning; Caddy keeps running, and browsers warn about its certificates until the authority is trusted. A stack that starts while the authority is untrusted prints that warning once.

Caddy itself never installs the authority: the generated Caddyfile sets `skip_install_trust`, so route reloads never ask for a password.

If you want to trust that same managed Caddy CA from another macOS machine without exposing the Caddy admin API, run this from the client machine:

```bash
devhost caddy trust-remote devbox
```

That command SSHes to `devbox`, runs `devhost caddy print-root-cert` remotely, prints the fetched root certificate SHA-256 fingerprint, and installs it into the local macOS System keychain. It requires `ssh` locally, `devhost` on the remote host's `PATH`, and a root certificate that has already been generated on the remote host by `devhost caddy start`.

## Start and stop the shared proxy

Start the shared managed Caddy instance before running one or more stacks:

```bash
devhost caddy start
```

Its admin address, bind host, plain HTTP, and listener ports come from the `[caddy]` table of the devhost config file, `config.toml`, which every stack on the machine shares. See [Shared managed Caddy settings](../shared-managed-caddy-settings/) for where the file lives and what it sets.

Stop it when you are done with all stacks:

```bash
devhost caddy stop
```

`devhost caddy stop` and `devhost caddy trust` reach Caddy through the admin address it runs, recorded when devhost last started or reloaded it, so they work after `adminAddress` changes. A stopped Caddy starts again from the config file's settings.

Managed Caddy lifecycle is shared and manual. `devhost` stack startup requires the managed Caddy admin API to already be available, and starting a stack applies the config file's settings to it.

Stack shutdown removes its host snippets and leaves Caddy running with the settings it runs, even when no route remains. Each devhost state directory has its own managed Caddy, and a stack's shutdown changes only the Caddy of its own state directory.

## Hostname and DNS expectations

`https://devhost.localhost/` is the local [running-stack directory](../stack-lifecycle/#running-stacks-in-the-browser). Its hostname is reserved and cannot be assigned to a service. It uses Caddy's configured HTTPS port and accepts loopback clients only, even when application routes listen on all interfaces.

`devhost` manages HTTPS routing through Caddy, not DNS.
Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.

For custom domains, that means loopback resolution, such as exact `A` / `AAAA` records to `127.0.0.1` / `::1`, wildcard DNS records on your domain, or local host entries for exact names. `/etc/hosts` can be used, but it only handles exact hostnames.

Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

These names address the device running the browser. Use `https://foo.localhost` on the dev machine. For another device, configure a routed hostname that resolves to the dev machine's network address. Managed Caddy listens on all network interfaces by default; the backend service can keep listening on loopback. HTTPS clients also need to trust Caddy's CA.

## Multiple hostnames for one service

Use an array in `host` to route several hostnames to one service process:

```toml
[services.web]
command = ["bun", "run", "dev"]
port = 3000
host = ["app.localhost", "alias.localhost"]
```

Every hostname uses the same backend port and `path`, and must resolve to the machine running `devhost`. The array must contain at least one valid, unique hostname. A single string, such as `host = "app.localhost"`, routes one hostname. Each hostname is claimed independently, so a conflict on any domain prevents startup and releases the claims already acquired.

The first hostname supplies `DEVHOST_HOST`, `{{ services.web.host }}`, and the devtools service link. Startup logs show every routed URL. New native chat sessions resolve the service checkout from their routed hostname and path.

All domains follow the service's port on restart, including after an automatic port retry. Route updates publish together; a failed refresh restores every domain's previous route and leaves the service available for recovery in devtools.

## Development servers that require a local origin

For a development server such as Bun's HTML/HMR server that rejects the public hostname, enable `proxyLocalOrigin` on that service:

```toml
[services.web]
command = ["bun", "src/index.ts"]
bindHost = "127.0.0.1"
port = "auto"
host = "app.localhost"
proxyLocalOrigin = true
```

The option defaults to `false` and requires `host`. When enabled, the backend receives its local socket address in `Host`. Requests with an `Origin` matching `http://` or `https://` plus the incoming public authority receive the local HTTP origin instead. Requests without `Origin` keep it absent; foreign, opaque, and duplicate origins receive `403` before reaching the service. This applies to documents, assets, subpath routes, and WebSocket upgrades, and follows automatic port changes. `X-Forwarded-Host` retains the public authority. Enable it only for services that require local-origin requests; services that use cross-origin API requests should leave it disabled.

The local address comes from the service's `bindHost` and resolved `port`. `bindHost` defaults to `127.0.0.1`; wildcard addresses use loopback for proxy connections (`0.0.0.0` becomes `127.0.0.1`, and `::` becomes `::1`). With `port = "auto"`, the proxy uses the port devhost assigns and exports as `PORT` by default. The app must listen on that address and port. If the app selects another port itself, set the service's `port` to match; devhost does not discover the app's listener from its startup output.

## Shared multi-stack behavior

Multiple projects can run against the same managed Caddy instance at the same time.

The routing contract is strict:

- hostname ownership is exclusive across projects
- one project cannot claim a hostname that is already owned by another live `devhost` process
- one manifest may mount multiple services under the same hostname on distinct paths
- fixed numeric bind ports are claimed globally across `devhost` processes before service spawn, and claim failures report a quoted normalized listening command line plus manifest path when `devhost` can discover the active socket listener
- `port = "auto"` is best-effort; `devhost` retries on clear bind collisions, but it does not provide a cross-process global auto-port allocator

## Managed Caddy defaults

The generated Caddy config uses these defaults:

- state dir: `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`
- admin API: `127.0.0.1:20197` by default via `adminAddress` in the `[caddy]` table of `config.toml`
- HTTPS listener port: `443` by default via `httpsPort`
- listener binding: all IPv4 and IPv6 interfaces by default via `bindHost = "0.0.0.0"`, rendered as Caddy `default_bind 0.0.0.0 [::]`; the admin API and default backend listeners remain on loopback
- plain HTTP: disabled by default; `http = true` serves the same routed hosts and shared fallback page on HTTP for every stack
- HTTP listener port: `80` by default via `httpPort`
- unmatched hostnames: a generated 404 page listing the active `devhost` hostnames as HTTPS links

## Platform caveats

On macOS, the managed Caddy instance starts rootlessly by avoiding loopback-specific listener binding.
The default wildcard binding supports access from other devices as well as the dev machine. On Linux, set `caddy.global.bindHost = "127.0.0.1"` for loopback-only access. On macOS, that value retains the wildcard-listener behavior for rootless HTTPS.
If you need strict loopback-only HTTPS on privileged ports, use a privileged launcher such as `launchd` socket activation; wildcard binding is not an equivalent substitute.

On non-macOS platforms, opening HTTPS on the configured `httpsPort` still requires privileged-port setup outside `devhost` when that port is privileged.
Enabling `http = true` adds the same requirement for `httpPort` when that port is privileged.
On Linux, `devhost caddy privileged-ports` configures the managed Caddy binary for this with `setcap`.
`devhost` does not configure `authbind` or firewall redirection for you.

`bindHost`, `httpPort`, and `httpsPort` only change the public HTTP/HTTPS listeners. `adminAddress` configures the separate managed Caddy admin API endpoint.

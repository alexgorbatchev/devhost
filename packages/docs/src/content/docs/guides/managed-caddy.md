---
title: "Managed Caddy and routing"
sidebar:
  order: 1
---

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
> `devhost caddy trust` prompts for your password and installs Caddy's CA into the system trust store.

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

If you want `devhost caddy start`, `stop`, or `trust` to honor a manifest-defined admin API address, pass the manifest explicitly on that subcommand:

```bash
devhost caddy start --manifest ./devhost.toml
```

You can also set `DEVHOST_MANIFEST=./devhost.toml` as the environment-backed equivalent of `--manifest` for `devhost` and for `devhost caddy start|stop|trust`. If both are set for the same command, the CLI flag wins.

Stop it when you are done with all stacks:

```bash
devhost caddy stop
```

Managed Caddy lifecycle is shared and manual. `devhost` stack startup requires the managed Caddy admin API to already be available.

## Hostname and DNS expectations

`devhost` manages HTTPS routing through Caddy, not DNS.
Your chosen hostnames must already resolve to this machine or the browser will never reach the local proxy.

For custom domains, that means loopback resolution, such as exact `A` / `AAAA` records to `127.0.0.1` / `::1`, wildcard DNS records on your domain, or local host entries for exact names. `/etc/hosts` can be used, but it only handles exact hostnames.

Good out-of-the-box choices are `localhost` and subdomains under `*.localhost`, such as `foo.localhost` and `api.foo.localhost`, because they work without additional DNS configuration.

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
- admin API: `127.0.0.1:20197` by default via `caddy.global.adminAddress`
- HTTPS listener port: `443` by default via `caddy.global.httpsPort = 443`
- listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on the default privileged HTTPS port
- listener binding on non-macOS: loopback only by default via `caddy.global.bindHost = "127.0.0.1"`, rendered as Caddy `default_bind 127.0.0.1 [::1]`
- plain HTTP: disabled by default; any active stack with `caddy.global.http = true` enables the same routed hosts and shared fallback page on HTTP for all active stacks
- HTTP listener port: `80` by default via `caddy.global.httpPort = 80`
- unmatched hostnames: a generated 404 page listing the active `devhost` hostnames as HTTPS links

## Platform caveats

On macOS, the managed Caddy instance starts rootlessly by avoiding loopback-specific listener binding.
That keeps startup unprivileged, but it also means the managed Caddy instance is not loopback-only on that platform.
If you need strict loopback-only HTTPS on privileged ports, use a privileged launcher such as `launchd` socket activation; wildcard binding is not an equivalent substitute.

On non-macOS platforms, opening HTTPS on the configured `caddy.global.httpsPort` still requires privileged-port setup outside `devhost` when that port is privileged.
Enabling `caddy.global.http = true` adds the same requirement for `caddy.global.httpPort` when that port is privileged.
On Linux, `devhost caddy privileged-ports` configures the managed Caddy binary for this with `setcap`.
`devhost` does not configure `authbind` or firewall redirection for you.

`caddy.global.bindHost`, `caddy.global.httpPort`, and `caddy.global.httpsPort` only change the public HTTP/HTTPS listeners. `caddy.global.adminAddress` configures the separate managed Caddy admin API endpoint.

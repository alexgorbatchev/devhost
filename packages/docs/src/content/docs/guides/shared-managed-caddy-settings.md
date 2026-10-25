---
title: "Shared managed Caddy settings"
sidebar:
  order: 4
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.webp" aria-label="shared managed caddy settings demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

Every stack on a machine routes through one managed Caddy, so its listeners belong to the machine, not to a project. Set them in the `[caddy]` table of the devhost config file, `config.toml`, or edit that file from the devtools [config editor](../devtools/#config-editor):

- `$DEVHOST_CONFIG_DIR/config.toml` when `DEVHOST_CONFIG_DIR` is set
- otherwise `$XDG_CONFIG_HOME/devhost/config.toml` when `XDG_CONFIG_HOME` is set
- otherwise `~/.config/devhost/config.toml`, on every platform

Without the file, every setting keeps its default. A project manifest with a `[caddy]` table is rejected, and the error names the config file.

Older checkouts may still contain `[caddy.global]`. Put the shared settings in `config.toml` and remove that block from each checkout's `devhost.toml`, including linked worktrees. A worktree with the obsolete block appears unavailable in the picker; refresh the worktree list after correcting it.

To also serve the routed hosts and the shared fallback page through plain HTTP:

```toml
[caddy]
http = true
```

If a tunnel or another proxy connects to devhost over HTTP, enable this setting even when the browser-facing URL uses HTTPS. The connection from that proxy to devhost determines which listener must serve the route. When the public page is blank but direct local HTTPS works, compare the local HTTP response and check this setting.

To move the listeners off the default privileged ports, set one or both listener ports:

```toml
[caddy]
httpPort = 8080
httpsPort = 4443
```

The listener bind host defaults to all IPv4 and IPv6 interfaces:

```toml
[caddy]
bindHost = "0.0.0.0"
```

That setting affects only the managed Caddy HTTP/HTTPS listeners. The admin API keeps its own address, and routed backends can keep their own `services.<name>.bindHost` on loopback behind Caddy. On Linux, set `bindHost = "127.0.0.1"` to keep the listeners on loopback. On macOS, that value keeps wildcard listeners for rootless HTTPS; strict loopback-only privileged HTTPS needs a privileged launcher.

To move the managed Caddy admin API off the default endpoint `127.0.0.1:20197`:

```toml
[caddy]
adminAddress = "127.0.0.1:22000"
```

Ports must be integers from `1` to `65535`, and `adminAddress` must be a non-empty address. Any other key in the file is rejected.

## Changing the settings while stacks run

`devhost caddy start` starts Caddy with the config file's settings, and every stack applies them when it starts. Every running stack watches the file. Saving it moves the shared Caddy to the new settings with one reload, sent to the admin address Caddy is listening on, so changing `adminAddress` works the same way as changing a port. Nothing restarts: services, routes, terminals, and agent sessions keep running, and every running stack prints its service URLs again with the new port and shows them in devtools.

An invalid file, or settings Caddy rejects, such as a port another program holds, leave Caddy on the settings it runs. Each stack prints `shared Caddy settings rejected` with the reason, once for each different error, and applies the file at its next save.

## When the last stack stops

Caddy keeps the settings it runs when the last route is removed, and runs until `devhost caddy stop`. The next `devhost caddy start` uses the config file's settings.

For same-host composition within one manifest, use distinct paths such as `/api/*` and `/admin/*`, or combine one root-mounted fallback service with more specific subpath services on the same hostname. See [Managed Caddy and routing](../managed-caddy/) for the manual lifecycle.

## Choose the stack directory hostname

Set `stackDirectoryHost` to a hostname that resolves to this machine, such as `stacks.localhost` or a hostname in your own development domain. Supply the hostname without a scheme, port, or path. The directory uses HTTPS and the shared `httpsPort`. With `http = true`, it also serves HTTP on `httpPort`, including requests from a TLS-terminating tunnel or reverse proxy.

Saving the file moves the directory to the new hostname without restarting stacks. That hostname is reserved for the directory; a setting that conflicts with a running project's hostname is rejected, retaining the previous settings. Clearing the key restores `devhost.localhost`; an empty string is invalid. Access defaults to clients on the devhost machine. Set `stackDirectoryAllowRemote = true` to read the directory from other devices. They can read stack URLs and raw configuration files; the page has no authentication. Read-only methods, same-origin checks, and the separation from stack controls remain enforced. The per-stack snapshot endpoint stays local-only. Setting the option back to `false` withdraws remote access on reload.

### Listen on loopback only

`bindHost` covers only the public HTTP and HTTPS listeners. The admin API listens on `adminAddress`, and each service on its own `bindHost`, which default to loopback.

- **Linux:** set `bindHost = "127.0.0.1"` to accept connections from this machine only.
- **macOS:** Caddy keeps listening on all interfaces even with `"127.0.0.1"`, because binding a loopback address on a privileged port needs root. For strict loopback-only HTTPS on port 443, start Caddy from a privileged launcher such as `launchd` socket activation.

### Privileged ports

Ports below 1024 need privileges on Linux. `devhost caddy privileged-ports` grants them to the managed Caddy with `setcap`; that covers `httpPort` too when `http = true`. devhost does not set up `authbind` or firewall redirects. To avoid the question, move the listeners to unprivileged ports, as in the example above.

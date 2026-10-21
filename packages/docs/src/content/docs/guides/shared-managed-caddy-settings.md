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

To also serve the routed hosts and the shared fallback page through plain HTTP:

```toml
[caddy]
http = true
```

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

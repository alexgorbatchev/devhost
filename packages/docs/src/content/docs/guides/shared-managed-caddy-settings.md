---
title: "Proxy ports and listeners"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.webp" aria-label="shared managed caddy settings demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

Every stack on a machine shares one Caddy, so its ports and listeners are machine settings. They live in the `[caddy]` table of the devhost config file, `config.toml`, not in any project's manifest.

## Where the file lives

The first location that applies:

1. `$DEVHOST_CONFIG_DIR/config.toml`
2. `$XDG_CONFIG_HOME/devhost/config.toml`
3. `~/.config/devhost/config.toml` (on every platform, including macOS)

The file is optional; without it every setting keeps its default. You can also edit it from the browser with the [config editor](../devtools/#config-editor), which creates it when it is missing.

## Settings

```toml
[caddy]
http = true          # also serve every route over plain HTTP
httpPort = 8080
httpsPort = 4443
stackDirectoryHost = "stacks.localhost"
stackDirectoryAllowRemote = false
bindHost = "0.0.0.0"
adminAddress = "127.0.0.1:22000"
```

| Key                         | Default               | Meaning                                                                             |
| --------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `stackDirectoryAllowRemote` | `false`               | Allow other devices to read the stack directory, including raw configuration files. |
| `stackDirectoryHost`        | `"devhost.localhost"` | Hostname of the read-only running-stack directory.                                  |
| `httpsPort`                 | `443`                 | Port of the HTTPS listener.                                                         |
| `http`                      | `false`               | Also serve every route, and the 404 page, over plain HTTP.                          |
| `httpPort`                  | `80`                  | Port of the HTTP listener, used when `http = true`.                                 |
| `bindHost`                  | `"0.0.0.0"`           | Address the HTTP and HTTPS listeners bind: all IPv4 and IPv6 interfaces by default. |
| `adminAddress`              | `"127.0.0.1:20197"`   | Address of Caddy's admin API, which devhost uses to change routes.                  |

Ports are integers from `1` to `65535`. Any other key is rejected, and so is a `[caddy]` table in a manifest; the error names the config file instead.

:::tip[Tunnels and other proxies]
Turn on `http = true` when a tunnel or another proxy connects to devhost over plain HTTP, even if visitors use HTTPS. If the public URL shows a blank page while `https://` works locally, this setting is the usual cause.
:::

### Choose the stack directory hostname

Set `stackDirectoryHost` to a hostname that resolves to this machine, such as `stacks.localhost` or a hostname in your own development domain. Supply the hostname without a scheme, port, or path. The directory uses HTTPS and the shared `httpsPort`. With `http = true`, it also serves HTTP on `httpPort`, including requests from a TLS-terminating tunnel or reverse proxy.

Saving the file moves the directory to the new hostname without restarting stacks. That hostname is reserved for the directory; a setting that conflicts with a running project's hostname is rejected, retaining the previous settings. Clearing the key restores `devhost.localhost`; an empty string is invalid. Access defaults to clients on the devhost machine. Set `stackDirectoryAllowRemote = true` to read the directory from other devices. They can read stack URLs and raw configuration files; the page has no authentication. Read-only methods, same-origin checks, and the separation from stack controls remain enforced. The per-stack snapshot endpoint stays local-only. Setting the option back to `false` withdraws remote access on reload.

### Listen on loopback only

`bindHost` covers only the public HTTP and HTTPS listeners. The admin API listens on `adminAddress`, and each service on its own `bindHost`, which default to loopback.

- **Linux:** set `bindHost = "127.0.0.1"` to accept connections from this machine only.
- **macOS:** Caddy keeps listening on all interfaces even with `"127.0.0.1"`, because binding a loopback address on a privileged port needs root. For strict loopback-only HTTPS on port 443, start Caddy from a privileged launcher such as `launchd` socket activation.

### Privileged ports

Ports below 1024 need privileges on Linux. `devhost caddy privileged-ports` grants them to the managed Caddy with `setcap`; that covers `httpPort` too when `http = true`. devhost does not set up `authbind` or firewall redirects. To avoid the question, move the listeners to unprivileged ports, as in the example above.

## Changing settings while stacks run

Every running stack watches the config file. When you save it:

- Caddy moves to the new settings in one reload, including a new `adminAddress`.
- Services, routes, terminals, and chat sessions keep running.
- Every stack prints its service URLs again with the new port and updates them in devtools.

If the file is invalid, or Caddy rejects the settings (for example, a port another program holds), Caddy keeps its current settings. Each stack prints `shared Caddy settings rejected` with the reason, and applies the file again on its next save.

`devhost caddy start` and every stack that starts apply the file's settings. `devhost caddy stop` and `devhost caddy trust` find Caddy at the admin address it is running with, so they keep working after you change `adminAddress`.

## When the last stack stops

Caddy keeps its settings and keeps running until `devhost caddy stop`. The next `devhost caddy start` reads the config file again.

## Older checkouts

Earlier versions of devhost read these settings from a `[caddy.global]` table in `devhost.toml`. Move them to `config.toml` and delete the table from every checkout, including linked worktrees: the worktree picker marks a checkout with the old table as unavailable until you do.

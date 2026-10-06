---
title: "Shared managed Caddy settings"
sidebar:
  order: 4
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.webp" aria-label="shared managed caddy settings demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/shared-managed-caddy-settings.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Shared listener settings serve the same routed service over HTTP and HTTPS.</p>
</details>
<!-- /guide-demo -->

To also serve the same routed hosts through plain HTTP, add this top-level setting:

```toml
[caddy.global]
http = true
```

This is a global managed-Caddy toggle, not an isolated per-stack listener. While stack registrations remain, HTTP is enabled if any active stack sets `caddy.global.http = true`. Removing the last true voter disables HTTP while false/default siblings remain; a supplied manifest's `http = true` does not override those active votes. With no active registrations, configuration uses the supplied manifest's HTTP setting.

To move the shared managed Caddy listeners off the default privileged ports, set one or both listener ports:

```toml
[caddy.global]
httpPort = 8080
httpsPort = 4443
```

Those are shared managed-Caddy settings too. Active stacks must agree on any non-default `caddy.global.httpPort` and `caddy.global.httpsPort` values because they all route through the same Caddy instance.

To expose the managed Caddy front door beyond loopback, set a shared listener bind host:

```toml
[caddy.global]
bindHost = "0.0.0.0"
```

That widens only the managed Caddy HTTP/HTTPS listeners. The admin API stays on `127.0.0.1`, and routed backends can keep their own `services.<name>.bindHost` on loopback behind Caddy.
Active stacks must agree on any non-default `caddy.global.bindHost` value because they share one managed Caddy instance.

To move the managed Caddy admin API off the default endpoint, set:

```toml
[caddy.global]
adminAddress = "127.0.0.1:22000"
```

Active stacks must agree on any non-default `caddy.global.adminAddress` value because they share one managed Caddy instance.

## Stack retirement and an empty runtime

Each stack captures the resolved shared admin address, bind host, listener ports, and HTTP setting after startup stale cleanup. Sparse/default route settings inherit that management binding; explicit non-default conflicts are still rejected. Route cleanup keeps the captured management endpoint and listener settings, removes the retiring host snippets, and preserves live siblings and their HTTP votes.

When the final registration is removed, cleanup retains that stack's captured settings, including HTTP, and leaves the shared Caddy process running. Stop Caddy manually with `devhost caddy stop --manifest ./devhost.toml`, using a manifest that matches its custom management settings.

A new stack or explicit Caddy lifecycle command does not discover an empty custom runtime from its existing configuration. Once all registrations are gone, supply matching custom settings in the manifest used for `devhost start` and `devhost caddy start|stop|trust`. See [Managed Caddy and routing](../managed-caddy/) for the manual lifecycle.

For same-host composition within one manifest, use distinct paths such as `/api/*` and `/admin/*`, or combine one root-mounted fallback service with more specific subpath services on the same hostname.

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

This is a global managed-Caddy toggle, not an isolated per-stack listener. If any active stack enables `caddy.global.http = true`, the shared Caddy instance serves HTTP for all active stacks until the last opting-in stack stops.

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

For same-host composition within one manifest, use distinct paths such as `/api/*` and `/admin/*`, or combine one root-mounted fallback service with more specific subpath services on the same hostname.

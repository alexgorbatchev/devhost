---
title: "Service References"
sidebar:
  order: 8
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/service-references.webp" aria-label="service references demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/service-references.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/service-references.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/service-references.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Resolve the API&#x27;s assigned port before starting its consumer.</p>
</details>
<!-- /guide-demo -->

`devhost` supports late-binding/runtime service references using `{{ services.<name>.<property> }}` placeholders. This allows services to dynamically discover configuration from other services in the stack (such as auto-allocated ports or bind hosts) right before they are launched.

This is particularly useful in multi-service monorepos where databases or backend services run on dynamically allocated ports (`port = "auto"`), and consuming services need to discover those ports to establish a network connection.

## Placeholders

This applies to:

- String fields in service `command` arrays
- Values in service `env` maps
- The service's `health.http` URL

### Supported properties

- `port`
  - The resolved port number of the target service (e.g., `{{ services.postgres.port }}`).
  - If the referenced service does not have a port configured, `devhost` will raise a resolution error at startup.
- `host`
  - The first configured public routing hostname of the target service, falling back to its bind host if no routing host is defined. This can address Caddy rather than the application's listener; it is not a direct connection address.
- `bindHost`
  - The configured bind host of the target service. Wildcards (`0.0.0.0` and `::`) describe listening addresses, and IPv6 literals need brackets when constructing a URL manually.
- `url`
  - The direct HTTP base URL built from the target service's bind host and assigned port, for example `{{ services.api.url }}`.
  - Uses loopback for wildcard listeners: `0.0.0.0` becomes `127.0.0.1`, and `::` becomes `::1`. IPv6 addresses are bracketed automatically.
  - Uses `http`, includes the assigned port, and has no trailing slash or public routing path. It bypasses Caddy and its public HTTPS hostname.
  - Requires the referenced service to define a port. Append a path, for example `{{ services.api.url }}/health`.

## Example

```toml
[services.api]
command = ["bun", "run", "api:dev"]
bindHost = "127.0.0.1"
port = "auto"

[services.web]
command = ["bun", "run", "web:dev"]
port = "auto"
dependsOn = ["api"]
env = { API_URL = "{{ services.api.url }}" }
```

In this example, the API's bind host and assigned port are resolved into the web service's `API_URL` at startup. The `api:dev` and `web:dev` scripts must launch servers that listen on their injected `PORT` values.

## Health checks with automatic ports

Services with a fixed or automatic `port` inherit a TCP readiness probe on that port. A health table can customize its timing without specifying a probe:

```toml
[services.garaje]
command = ["bun", "run", "dev"]
port = "auto"

[services.garaje.health]
timeout = 60000
```

`timeout` is the total startup readiness budget in milliseconds (default `30000`). `interval` is the delay between attempts (default `200` milliseconds). `retries` defaults to `0`, which leaves attempts bounded by the timeout; a positive value permits that many retries after the first failed attempt. A timeout-only table continues to check TCP connectivity, not HTTP application readiness. Without a service port, the health table must select a probe.

For HTTP readiness, a path beginning with a single `/` is shorthand for the current service's direct HTTP URL:

```toml
[services.garaje.health]
http = "/health?ready=1"
timeout = 60000
```

The shorthand requires a service port and targets the app's root path, independently of its public Caddy routing path. Escaped paths and query strings are retained. The equivalent full template is `http = "{{ services.garaje.url }}/health?ready=1"`. URLs can also be assembled explicitly, for example `http = "http://127.0.0.1:{{ services.garaje.port }}/health"`.

An explicit health table selects at most one of `tcp`, `http`, or `process`. Explicit TCP targets remain fixed numeric ports; HTTP URLs support service templates and absolute `http` or `https` URLs. Resolved HTTP targets must use `127.0.0.1`, `localhost`, or `::1`. The `host` template property commonly names the public proxy and is therefore unsuitable for these direct probes. Process probes retain their restrictions to managed, non-routed foreground services.

All service ports resolve before health URL templates are evaluated. Missing references, malformed URLs, and non-loopback HTTP targets fail before service launch. A health reference does not start the referenced service: use `dependsOn` when its readiness is required.

## References to stopped services

When `devhost start` names the services to run, a monorepo stack runs with some services stopped. A stopped service keeps its assigned address, so a reference to it resolves to the same value it has when the service runs, and stays the same when the service starts later. A reference does not start the service it names: add the service to `dependsOn`, as `web` does above, when the consumer needs it running. See [Starting part of a stack](../stack-lifecycle/#starting-part-of-a-stack).

## References after reload or restart

A configuration reload resolves command, environment, and health URL templates against the accepted service configuration and restarts affected consumers. Individual service restarts preserve their assigned automatic port. Automatic-port collision retries and **Restart stack with new ports** rebuild references, including health URLs that reference another service, using the new assigned ports while retaining configured health timing and probe kinds. Explicit numeric TCP targets and absolute URLs without templates keep their configured targets. See [Stack lifecycle](./stack-lifecycle/) for recovery and restoration behavior.

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

### Supported properties

- `port`
  - The resolved port number of the target service (e.g., `{{ services.postgres.port }}`).
  - If the referenced service does not have a port configured, `devhost` will raise a resolution error at startup.
- `host`
  - The configured routing host of the target service, falling back to its bind host if no custom host is defined.
- `bindHost`
  - The direct bind host of the target service.

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
env = { API_URL = "http://{{ services.api.bindHost }}:{{ services.api.port }}" }
```

In this example, the API's bind host and assigned port are resolved into the web service's `API_URL` at startup. The `api:dev` and `web:dev` scripts must launch servers that listen on their injected `PORT` values.

## References after reload or restart

A configuration reload resolves command and environment templates against the accepted service configuration and restarts affected consumers. Individual service restarts preserve their assigned automatic port. **Restart stack with new ports** reassigns automatic ports and rebuilds references before relaunching all managed services, so consumers receive the current port values. See [Stack lifecycle](./stack-lifecycle/) for recovery and restoration behavior.

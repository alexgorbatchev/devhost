---
title: "Connect services"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/service-references.webp" aria-label="service references demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/service-references.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/service-references.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/service-references.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

A service reference, `{{ services.<name>.<property> }}`, fills in another service's address when the stack starts. One service can point at another even when that one's port is assigned at startup with `port = "auto"`.

## Point one service at another

```toml
[services.api]
command = ["bun", "run", "api:dev"]
port = "auto"

[services.web]
command = ["bun", "run", "web:dev"]
port = "auto"
dependsOn = ["api"]
env = { API_URL = "{{ services.api.url }}" }
```

At startup, `API_URL` becomes something like `http://127.0.0.1:41234`, and `dependsOn` makes sure `api` is running first. Both scripts must listen on the `PORT` devhost gives them.

References work in `command` arguments, `env` values, and `health.http` URLs.

## Properties

| Property   | Value                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`      | Direct HTTP address of the service, such as `http://127.0.0.1:41234`. No trailing slash; append a path: `{{ services.api.url }}/health`. A listener on `0.0.0.0` or `::` becomes `127.0.0.1` or `[::1]`. |
| `port`     | The service's port, such as `41234`.                                                                                                                                                                     |
| `bindHost` | The address the service listens on, as configured. A wildcard (`0.0.0.0`, `::`) is not an address to connect to, and an IPv6 address needs brackets in a URL.                                            |
| `host`     | The service's first public hostname, or its `bindHost` when it has none. A public hostname goes through Caddy over HTTPS, so use `url` to reach the service directly.                                    |

A reference to a service without a port, through `url` or `port`, fails at startup.

## Health checks with automatic ports

A service with a `port`, fixed or automatic, gets a TCP health check on that port without any configuration. A health table can change only the timing:

```toml
[services.api.health]
timeout = 60000
```

| Key        | Default | Meaning                                                                                           |
| ---------- | ------- | ------------------------------------------------------------------------------------------------- |
| `timeout`  | `30000` | Milliseconds to wait for the service to become ready.                                             |
| `interval` | `200`   | Milliseconds between attempts.                                                                    |
| `retries`  | `0`     | With `N`, give up after `N + 1` failed attempts in a row. `0` leaves `timeout` as the only limit. |

To wait for an HTTP response instead, give `http` a path. It is a shorthand for the service's own `url`:

```toml
[services.api.health]
http = "/health?ready=1"   # same as "{{ services.api.url }}/health?ready=1"
timeout = 60000
```

- The path is relative to the service itself, not to its public `path` on Caddy.
- A health check is ready on any `2xx` response.
- A full URL can use references too: `http = "http://127.0.0.1:{{ services.api.port }}/health"`. It must point at `127.0.0.1`, `localhost`, or `::1`.
- A health table uses at most one of `tcp`, `http`, or `process`. A `tcp` target is a fixed port number. Without a service `port`, a health table must choose one.

Mistakes such as a missing service, a malformed URL, or a non-loopback address fail before any service starts.

## References to services that are not started

When you [start part of a stack](../stack-lifecycle/#start-part-of-a-stack), a service that is not started still has its address, so references to it resolve to the same value before and after it starts. A reference never starts a service: add it to `dependsOn` when the consumer needs it running, including for a health check that points at it.

## After a reload or restart

- A hot reload resolves references again and restarts the services whose values changed.
- A single-service restart keeps its automatic port, so references to it stay correct.
- **Restart Stack**, and startup's retry after a port collision, assign new automatic ports and rebuild every reference, including health URLs. Health timing and check types stay as configured.
- Fixed TCP ports and URLs without references never change.

See [Restarts and recovery](../../stacks/recovery/).

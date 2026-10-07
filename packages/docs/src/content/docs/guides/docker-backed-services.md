---
title: "Docker-backed services"
sidebar:
  order: 5
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.webp" aria-label="docker backed services demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Route a published Docker port. Its lifecycle stays with Docker.</p>
</details>
<!-- /guide-demo -->

`devhost` can front a Docker- or Compose-managed backend, but only when the container publishes a port onto the host and `devhost` routes to that host-visible port.
`devhost` does not proxy to Docker-internal service names or container-network-only addresses.

If another process or tool already owns the backend lifecycle, declare that service with `managed = false` so `devhost` claims the hostname and fixed port without trying to spawn or restart it.

For example, if your Compose service publishes `4000:4000`, you can route it like this:

```toml
name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "hello.localhost"
dependsOn = ["api"]

[services.api]
command = ["docker", "compose", "up", "--build", "api"]
port = 4000
host = "api.hello.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

That works because the API is reachable from the host on `127.0.0.1:4000`.
If the API only exists inside the Docker network, for example as `http://api:4000`, `devhost` cannot route to it directly.

For a backend that is started separately and only becomes reachable later, use an unmanaged service instead:

```toml
name = "hello-stack"

[services.dev]
command = ["bun", "run", "dev:infra"]
health = { process = true }

[services.preview]
managed = false
dependsOn = ["dev"]
port = 4100
host = "preview.hello.localhost"
```

Unmanaged services must omit `command`, `injectPort`, and `port = "auto"`.
They can still use fixed-port routing and explicit TCP or HTTP health checks, but `health.process` is invalid because `devhost` does not own a child process for them.

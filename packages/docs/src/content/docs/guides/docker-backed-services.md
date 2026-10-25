---
title: "Docker and external services"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.webp" aria-label="docker backed services demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/docker-backed-services.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

devhost can give a Docker container, or any server something else runs, an HTTPS hostname. It routes to a port published on this machine; it cannot reach container names or addresses inside a Docker network.

## Route a container that Docker runs

Publish the container's port on the host, for example `ports: ["4100:4100"]` in Compose, then declare the service as external with `managed = false`:

```toml
[services.preview]
managed = false
port = 4100
host = "preview.hello.localhost"
```

devhost claims the hostname and port, waits until the port accepts connections, and routes to it. It never starts, stops, or restarts the container.

- An external service cannot have a `command`, `injectPort`, or `port = "auto"`; routing it takes a fixed `port`.
- Its health check can be the default TCP check, an explicit `tcp` port, or an `http` URL, but not `process`, since devhost owns no process for it.
- The Services panel tags it `external` and offers no restart; recover it outside devhost.
- A repository that contains an external service cannot [switch worktrees](../../stacks/worktrees/).

To start the container from another service of the stack, add that service to `dependsOn`:

```toml
[services.infra]
command = ["bun", "run", "dev:infra"]   # starts the containers
health = { process = true }

[services.preview]
managed = false
dependsOn = ["infra"]
port = 4100
host = "preview.hello.localhost"
```

## Let devhost run Compose

When devhost should start and stop the container itself, make it an ordinary service whose command runs Compose in the foreground:

```toml
[services.api]
command = ["docker", "compose", "up", "--build", "api"]
port = 4000
host = "api.hello.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }
```

This works because Compose publishes `4000:4000` on the host. Health URLs must use `127.0.0.1`, `localhost`, or `::1`; a Docker-internal name such as `http://api:4000` is rejected.

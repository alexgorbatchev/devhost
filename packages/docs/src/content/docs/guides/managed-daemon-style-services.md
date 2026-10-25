---
title: "Background daemons"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/managed-daemon-style-services.webp" aria-label="managed daemon style services demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/managed-daemon-style-services.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/managed-daemon-style-services.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/managed-daemon-style-services.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

Some services run in the background: they fork into a daemon, re-exec into detached workers, or are controlled through `start` and `stop` commands rather than staying in the foreground. devhost cannot supervise those through a `command`. Give it the commands instead with daemon mode.

## Configure a daemon

```toml
[services.mailpit]
port = 8025
host = "mail.hello.localhost"
health = { http = "http://127.0.0.1:8025/api/v1/info" }

[services.mailpit.lifecycle]
mode = "daemon"
start = ["./scripts/mailpit-devctl", "start"]
status = ["./scripts/mailpit-devctl", "status"]
stop = ["./scripts/mailpit-devctl", "stop"]
```

When the stack starts, devhost runs `status` first. If it exits `0`, the daemon is already running and devhost skips `start`; otherwise it runs `start`. Either way, devhost then waits for the health check and adds the routes. On shutdown and on every restart it runs `stop`.

## Rules

- `start` and `stop` are required; `status` is optional.
- A daemon service has no top-level `command`, and stays managed (no `managed = false`).
- It needs a fixed `port` or an explicit health check: `port = "auto"` and `health.process` are not allowed, because devhost owns no long-lived process for it.
- Its recovery page reports the health check, not a process exit.

---
title: "Managed daemon-style services"
sidebar:
  order: 6
---

Use daemon lifecycle mode when `devhost` should own a service, but the service runs in the background or is managed through explicit `start` / `stop` commands rather than one long-lived foreground process.

This is the correct mode for services that intentionally daemonize, re-exec into detached workers, or otherwise cannot guarantee that their long-lived process tree will stay attached to the foreground `command` that `devhost` started.

Daemon lifecycle services use a nested `[services.<name>.lifecycle]` table:

- `mode = "daemon"` switches the service out of the default foreground `command` model
- `start` and `stop` are required command arrays
- `status` is optional and lets `devhost` treat an already-running daemon as healthy without re-running `start`
- top-level `command` is invalid in daemon mode
- `managed` must stay `true`
- `port = "auto"` and `health.process` are invalid in daemon mode

Example:

```toml
name = "hello-stack"

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

`devhost` runs `lifecycle.start`, waits for the service health check, and then installs routes. On shutdown or restart it runs `lifecycle.stop`. When `status` exits successfully, `devhost` treats the daemon as already running and skips `start`.

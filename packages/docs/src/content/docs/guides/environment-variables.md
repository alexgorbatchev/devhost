---
title: "Environment Variables"
sidebar:
  order: 7
---

`devhost` injects environment variables into each managed service command invocation.
Only `DEVHOST_BIND_HOST` and `PORT` are operational bind inputs.
The remaining variables are context metadata and must not be used as socket bind targets.
Undocumented `DEVHOST_*` variables are reserved for internal supervision and may change without notice.

## Operational bind inputs

- `DEVHOST_BIND_HOST`
  - the actual interface the child process is expected to listen on
  - use this for binding sockets
- `PORT`
  - the listening port selected by `devhost`
  - injected when the service defines `port`, including foreground services with `port = "auto"`, unless `injectPort = false`
  - for `port = "auto"`, the selected port is best-effort and may be retried if the child reports a clear bind collision during startup
  - not injected for services that do not define `port` or for unmanaged services
  - injection only adds `PORT` to the child process environment; it does not make `"$PORT"` expand inside a manifest `command`
  - `command = ["storybook", "dev", "--port", "$PORT"]` passes literal `$PORT`; use an explicit shell only when you intentionally need shell expansion
- `injectPort = false`
  - service-level opt-out for `PORT` injection
  - keeps routing and health checks on the configured service `port`, but does not export `PORT` into the child process environment
  - useful for wrapper commands that launch multiple dev processes under one top-level command

## Routed-service context

- `DEVHOST_HOST`
  - injected only for routed services with `host`
  - the public routed hostname from the service `host` field
  - use this when the app needs to know its public development URL or origin
- `DEVHOST_PATH`
  - injected only for routed services with `host` and an explicit `path`
  - the public routed subpath from the service `path` field
  - use this when the app needs to mount its router under a specific prefix

## Manifest metadata

- `DEVHOST_SERVICE_NAME`
  - the manifest service key for the current child process
- `DEVHOST_MANIFEST_PATH`
  - the absolute path to the resolved `devhost.toml`

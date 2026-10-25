---
title: "Environment variables"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/environment-variables.webp" aria-label="environment variables demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/environment-variables.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/environment-variables.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/environment-variables.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

devhost passes each service its port, its hostname, and the ports of the other services, alongside any variables you set yourself. You can also read your own environment inside the manifest.

## Set variables for a service

```toml
[services.web]
command = ["bun", "run", "dev"]
port = "auto"
env = { NODE_ENV = "development", API_URL = "{{ services.api.url }}" }
```

Each service inherits devhost's environment, plus its `env` table, plus the variables below. To pass a value that another service gets at startup, such as an automatic port, use a [service reference](../service-references/) like the one above.

## Variables devhost sets

| Variable                | Set when                               | Value                                                                                                                         |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | The service has a `port`               | The port to listen on, including one chosen by `port = "auto"`                                                                |
| `DEVHOST_BIND_HOST`     | Always                                 | The address to listen on (the service's `bindHost`, `127.0.0.1` by default)                                                   |
| `DEVHOST_HOST`          | The service has a `host`               | Its public hostname; the first one when `host` is a list                                                                      |
| `DEVHOST_PATH`          | The service has a `host` and a `path`  | Its public path prefix, for mounting a router under it                                                                        |
| `DEVHOST_PORT_<NAME>`   | Any service in the manifest has a port | That service's port. The name is upper-cased, with other characters as `_`: `postgres-db` becomes `DEVHOST_PORT_POSTGRES_DB`. |
| `DEVHOST_SERVICE_NAME`  | Always                                 | The service's name in the manifest                                                                                            |
| `DEVHOST_MANIFEST_PATH` | Always                                 | The absolute path of the root manifest                                                                                        |

Bind your server to `DEVHOST_BIND_HOST` and `PORT` only. The other variables describe the service and its neighbors; never use them as a listening address. Other `DEVHOST_*` variables are internal and can change without notice.

- External services (`managed = false`) get none of these, because devhost does not start them.
- `injectPort = false` keeps devhost from setting `PORT`, while routing and health checks still use the configured port. Use it when one command starts several servers; see [One command runs several dev servers](../troubleshooting/#one-command-runs-several-dev-servers).
- Setting `PORT` does not make `$PORT` work inside `command`, which runs without a shell; see [Service commands and working directories](../stack-lifecycle/#service-commands-and-working-directories).

Each process receives these values when it starts. When a reload or **Restart Stack** changes a port, devhost restarts the services whose variables change, so they never hold a stale port. A single-service restart keeps its port, so nothing else needs to restart. Chat sessions keep the environment they started with.

## Environment variables in the manifest

Any string in the manifest can read your environment with `{{ env.NAME }}`, including names, hostnames, paths, `cwd`, commands, and `env` values:

```toml
name = "{{ env.USER }}-stack"

[services.web]
command = ["bun", "run", "dev"]
port = "auto"
host = "web-{{ env.USER }}.localhost"
```

- A name starts with a letter or underscore, followed by letters, digits, or underscores.
- An unset variable is an error when the manifest is read. A variable set to an empty string expands to nothing.
- Text that is not a valid placeholder stays as written, including a `{{` that is never closed.

devhost reads the environment it was started with, and does not load `.env` files. Use a tool such as [direnv](https://direnv.net/) to export variables per project.

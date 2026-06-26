---
title: "Service References"
sidebar:
  order: 8
---

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
[services.postgres]
bindHost = "127.0.0.1"
port = "auto"

[services.poc-backend]
command = ["node", "server.js"]
health = { tcp = 8080 }
env = { DATABASE_URL = "postgres://postgres:postgres@{{ services.postgres.bindHost }}:{{ services.postgres.port }}/postgres?sslmode=disable" }
```

In this example, both the `bindHost` and the dynamic `port` of the `postgres` database service are automatically resolved and injected into the backend's `DATABASE_URL` environment variable at startup, with zero manual coordination or hardcoded ports.

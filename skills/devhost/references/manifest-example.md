# Full Manifest Example

Below is a complete, production-grade `devhost.toml` manifest illustrating every available feature, configuration table, environment placeholder, routing schema, health check type, and annotation action in detail.

```toml
# `name` identifies the stack in logs, state, and injected metadata.
name = "hello-stack"

# `killZombies` automatically terminates processes from the same manifest path
# that are still claiming needed hosts or ports (default: true).
killZombies = true

# `includes` lists file paths or glob patterns (relative to this manifest's directory)
# of sub-manifests to load and merge. Perfect for monorepos.
includes = ["packages/*/devhost.toml", "apps/*/devhost.toml"]

[caddy.global]
# `http` also serves the same routed hosts and the shared fallback page on plain HTTP.
# - `false` (default): serve through HTTPS only.
# - `true`: also serve the same routes through HTTP on `httpPort`.
http = false
# `httpPort` selects the managed Caddy HTTP listener port (default: 80).
httpPort = 80
# `httpsPort` selects the managed Caddy HTTPS listener port (default: 443).
httpsPort = 443
# `bindHost` controls which interfaces Caddy's HTTP/HTTPS listeners bind (default: "127.0.0.1").
bindHost = "127.0.0.1"
# `adminAddress` controls which loopback port the managed Caddy admin API listens on (default: "127.0.0.1:20197").
adminAddress = "127.0.0.1:20197"

[devtools.editor]
# `enabled` controls whether Alt + right-click component-source navigation is enabled (default: true).
enabled = true
# `ide` selects which editor target devhost opens ("vscode", "vscode-insiders", "cursor", "webstorm", "neovim").
ide = "vscode"

[devtools.externalToolbars]
# `enabled` controls whether devhost aggregates detected third-party devtools buttons (default: true).
enabled = true

[devtools.minimap]
# `enabled` controls whether the injected log minimap UI is shown (default: true).
enabled = true

[devtools.status]
# `enabled` controls whether the injected service-status panel is shown (default: true).
enabled = true
# `position` selects where the status panel is anchored ("top-right", "bottom-right").
position = "bottom-right"

[devtools.shortcuts]
# `restartServices` defines a global keyboard shortcut to trigger restarts in the browser (default: "alt+ctrl+r").
restartServices = "alt+ctrl+r"

# `idleTimeout` sets the automatic idle shutdown duration (disabled by default).
idleTimeout = "1h"

# Annotation actions configuration
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
label = "Ask Claude"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"

[[annotation.actions]]
id = "jira"
label = "Create Jira Ticket"
kind = "command"

[annotation.actions.command]
command = ["bun", "./scripts/mock-jira-ticket.ts"]
cwd = "."

[annotation.actions.command.env]
JIRA_BASE_URL = "https://example.atlassian.net"
JIRA_PROJECT_KEY = "WEB"

# -----------------------------------------------------------------------------
# services
# -----------------------------------------------------------------------------

[services.web]
# `primary` marks this as the default service for stack-level behavior (default: false).
primary = true
# `command` defines the child process command line. String arrays are recommended.
command = ["bun", "run", "web:dev"]
# `cwd` sets the working directory for the child process.
cwd = "./app"
# `port` sets the runtime listening port or requests automatic allocation.
port = 3000
# `injectPort` controls whether devhost exports `PORT` to the child process (default: true).
injectPort = true
# `bindHost` sets the socket interface the child process should bind to (default: "127.0.0.1").
bindHost = "127.0.0.1"
# `host` sets the public routed hostname.
host = "hello.local.test"
# `path` sets a subpath for mounting (e.g. "/api/*"). Defaults to "/".
path = "/"
# `dependsOn` declares services that must start before this service.
dependsOn = ["api"]
# `watch` lists relative paths to watch for file changes (restarts dirty states in UI).
watch = ["src/"]

[services.web.env]
NODE_ENV = "development"
PUBLIC_API_ORIGIN = "https://api.hello.local.test"

[services.api]
# A routed backend with explicit HTTP health and IPv6 loopback binding.
command = ["bun", "run", "api:dev"]
cwd = "./api"
port = 4000
bindHost = "::1"
host = "api.hello.local.test"
dependsOn = ["db"]

[services.api.env]
LOG_LEVEL = "debug"
# Use late-binding template references to get the dynamic bindHost and port of dependent services:
DATABASE_URL = "postgres://postgres:postgres@{{ services.db.bindHost }}:{{ services.db.port }}/mydb"

[services.api.health]
# `http` defines an absolute HTTP health-check URL.
http = "http://127.0.0.1:4000/healthz"
interval = 500
timeout = 5000
retries = 20

[services.preview]
# An externally managed routed service.
managed = false
dependsOn = ["api"]
port = 4100
host = "preview.hello.local.test"

[services.mailpit]
# A managed daemon lifecycle service.
port = 8025
host = "mail.hello.local.test"

[services.mailpit.lifecycle]
# `mode = "daemon"` switches from foreground command model to start/stop controls.
mode = "daemon"
start = ["./scripts/mailpit-devctl", "start"]
status = ["./scripts/mailpit-devctl", "status"]
stop = ["./scripts/mailpit-devctl", "stop"]

[services.mailpit.health]
http = "http://127.0.0.1:8025/api/v1/info"

[services.cache]
# A non-routed service using explicit TCP health instead of `port`.
command = ["bun", "run", "cache:dev"]
cwd = "./cache"
bindHost = "0.0.0.0"
dependsOn = ["db"]

[services.cache.health]
# `tcp` defines the port used by the TCP health check.
tcp = 6379
interval = 250
timeout = 3000
retries = 10

[services.db]
# `port = "auto"` automatically allocates a free port, but explicit `health` must be omitted in v1.
command = ["bun", "run", "db:dev"]
cwd = "./db"
port = "auto"
bindHost = "::"

[services.worker]
# A background process with process-based health (valid only for non-routed services).
command = ["bun", "run", "worker:dev"]
cwd = "./worker"
dependsOn = ["api"]

[services.worker.health]
# `process = true` treats the service as healthy while the child process remains alive.
process = true
interval = 1000
timeout = 1000
retries = 0
```

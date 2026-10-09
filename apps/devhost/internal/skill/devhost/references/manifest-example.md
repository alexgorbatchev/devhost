# Full Manifest Example

Below is a complete, production-grade `devhost.toml` manifest illustrating every available feature, configuration table, environment placeholder, routing schema, health check type, and annotation action in detail.

```toml
# Service changes and include-file additions/removals reload while devhost runs.
# Invalid edits leave the stack running. Changes to name, killZombies, Caddy,
# devtools, annotation, or worktree enablement require restarting devhost.
# `name` identifies the stack in logs, state, and injected metadata.
name = "hello-stack"

# `killZombies` automatically terminates processes from the same manifest path
# that are still claiming needed hosts or ports (default: true).
killZombies = true

# `includes` lists file paths or glob patterns (relative to this manifest's directory)
# of sub-manifests to load and merge. Perfect for monorepos.
includes = ["packages/*/devhost.toml", "apps/*/devhost.toml"]

# Repository checkout picker: enabled by default, requires Git on PATH.
# Set enabled = false to disable discovery and saved-selection restore.
# [worktrees]
# enabled = false
# All repository services share one saved choice across devhost restarts.
# Repositories containing managed = false services cannot switch.
# Missing checkouts and failed group launches remain stopped for explicit recovery.

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
# Supported tools: host-mounted TanStack Query, TanStack Router, the unified TanStack shell, React Hook Form, Jotai, and Vue inspectors.
# For the unified shell, mount @tanstack/react-devtools 0.10.13 with native Form/Table/Pacer plugins.
# One TanStack entry controls attached shells sharing upstream state; detached windows use native controls.
# This integration targets development runtimes; see the setup guide for plugin/version boundaries.
# For React Hook Form, mount @hookform/devtools DevTool with each form's control in your app.
# For Jotai, mount jotai-devtools DevTools with each store; tested: 0.14.0 with jotai 2.20.3.
# Import jotai-devtools before creating custom stores; its panel owns atoms and history.
# devhost supplies separate Form N and Jotai N launchers; the host owns forms, stores, and native panels.
# For Vue, use vite-plugin-vue-devtools 9.0.0-beta.1 with Vite 8.3.3, @vitejs/devtools 0.7.6,
# and devtools.apply = "serve" in the host app; authorize and reveal the native dock.
# The Vue entry requires a mounted Vue app. The inspector and other native docks remain host-owned.
# For Redux Toolkit and native-middleware Zustand, opt into /__devhost__/redux.js on the routed development page.
# Toolkit requires one public instrument EnhancedStore; Zustand requires actual StoreApi plus snapshot/restore.
# The Redux entry opens the upstream browser inspector; disabling closes its owned monitor/subscriptions only.
# Inspector modules/styles are content-versioned in compiled builds; its stylesheet stays in the popup document.
# Tested versions, setup, and panel identification: https://alexgorbatchev.github.io/devhost/architecture/external-devtools/
enabled = true

# Optional native React access; no browser resources are allocated while endpoint is empty.
# Start your dedicated browser/profile yourself and install the original extension before the host loads.
# Tested version boundary: CfT 154.0.8037.92, React extension 8.0.0, React/React DOM 19.2.5.
# Browser connects/disconnects devhost control; native window and profile stay browser-owned.
[devtools.browser]
endpoint = ""
reactExtensionId = "fmkadmapgofadopljbjfkapdkoienihi"

[devtools.minimap]
# `enabled` controls whether the injected log minimap UI is shown (default: true).
enabled = true

[devtools.resources]
# `enabled` controls whether host CPU, memory, and disk usage is shown in the toolbar (default: true).
enabled = true
# `pollInterval` sets how often every readout is read (minimum "250ms").
# Omit it for the defaults: CPU and memory every "2s", disk every "1m".
pollInterval = "5s"

# Each readout has its own `enabled` (default: true) and a `pollInterval` that overrides the shared one.
[devtools.resources.cpu]
pollInterval = "1s"

[devtools.resources.memory]
enabled = false

[devtools.resources.disk]
pollInterval = "10m"

[devtools.status]
# `enabled` controls whether the injected service-status panel is shown (default: true).
# It also shows exited foreground services in a full-screen log view with a restart button.
# devhost and sibling services keep running after service exits, including exit code 0.
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
# Optional; omit to use the system temp directory ($TMPDIR on Unix, otherwise /tmp).
# Relative to devhost's startup cwd, independent of the manifest and action cwd.
# Missing parents are created; each session uses a private subdirectory cleaned up separately.
# tempDir = ".tmp/annotations"

[[annotation.actions]]
id = "fix"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"
# Built-in adapters ("pi", "claude-code", "opencode", "codex") support an optional `args` string array:
args = ["--thinking", "high"]

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
# Absolute paths are used directly and may point outside the manifest directory.
# Relative paths resolve against the manifest directory and must stay within it.
cwd = "./app"
# `port` sets the runtime listening port or requests automatic allocation.
port = 3000
# `injectPort` controls whether devhost exports `PORT` to the child process (default: true).
injectPort = true
# `bindHost` sets the socket interface the child process should bind to (default: "127.0.0.1").
bindHost = "127.0.0.1"
# `host` accepts one hostname or a non-empty array of unique hostnames.
# All domains share the service process, port, path, and annotation queues.
# The first supplies DEVHOST_HOST, services.<name>.host references, and the devtools link.
host = "hello.local.test"
# host = ["hello.local.test", "alias.local.test"]
# Enable only for dev servers requiring local Host/Origin, such as Bun HTML/HMR.
# Requires host; defaults to false. Foreign/opaque/duplicate origins receive 403.
# X-Forwarded-Host stays public; documents, assets, and WebSockets follow auto ports.
# proxyLocalOrigin = true
# `path` sets a subpath for mounting (e.g. "/api/*"). Defaults to "/".
path = "/"
# `dependsOn` declares services that must start before this service.
# `devhost start web` starts this service and everything it reaches through `dependsOn`.
dependsOn = ["api"]
# `alwaysStart = true` starts a service on every `devhost start`, including one that names
# other services (default: false). Set it on shared infrastructure such as a database.
# alwaysStart = true
# Relative watch paths use the service cwd and follow its selected worktree.
# Absolute watch paths stay absolute. Changes mark the service dirty in the UI.
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
# Individual restarts keep the assigned port; use "Restart stack with new ports" for automatic-port conflicts.
# Stack restart rebuilds port references and refreshes routes before reporting recovery.
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

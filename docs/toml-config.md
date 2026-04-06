# `devhost.toml` v1 design

## 1. Objective and non-goals

### Objective

Add a manifest-driven stack mode to `devhost` so a project can define its local development stack in one file and start it with no routing flags.

The v1 command contract is:

```bash
bun run devhost
```

When run from inside a project containing `devhost.toml`, `devhost` must:

1. discover the manifest
2. parse it with Bun's built-in TOML parser
3. validate it with Zod v4 plus semantic checks
4. reserve every public hostname before starting any child process
5. start all services in dependency order
6. wait for each service health check
7. register Caddy routes for every service with `host`
8. stream prefixed logs for all services
9. shut everything down and clean up routes on exit or failure

### Non-goals

The following items are out of scope for `devhost.toml` v1:

- per-service `devtools` overrides
- a global control-plane daemon
- automatic manifest merging
- Docker or Compose orchestration
- shell-string command execution as the primary command format
- profiles, matrices, or environment overlays
- lifecycle hooks
- log-pattern health checks
- remote hosts or remote routing
- wildcard host generation

## 2. Current codebase baseline

These baseline facts are verified from the repository at the time of writing:

- `devhost/src/index.ts` is the CLI entrypoint.
- `devhost/src/startStack.ts` is the stack-mode orchestrator.
- `devhost` code now lives under `devhost/src/`.
- `devhost` has its own `package.json`, `bun.lock`, and `tsconfig.json`.
- `devhost` now generates and manages its own Caddyfile under `DEVHOST_STATE_DIR` or `~/.local/state/devhost/caddy`.
- routable domains are no longer constrained by a checked-in Caddyfile, but they still must resolve to the local machine outside `devhost`.
- browser devtools injection already exists and is implemented as split routing.

## 3. Non-negotiable constraints

- The manifest filename must be exactly `devhost.toml`.
- The primary runtime must remain Bun.
- Manifest parsing must use Bun's built-in TOML support. No external TOML library is allowed.
- Manifest schema validation must use Zod v4.
- The manifest command format must be an array of argv tokens, not a shell string.
- `devhost` must never leave child processes running after startup failure.
- `devhost` must never activate a Caddy route for a service that has not passed its health check.
- `devhost` must reserve all public hosts before starting any service process.
- `devhost` must reject ambiguous bind and routing configuration instead of guessing.
- Runtime binding and public hostname routing must remain separate concepts.

## 4. Exact architecture choice

`devhost.toml` v1 uses a single manifest file with an explicit service graph.

The root manifest defines:

- stack metadata
- the primary service name
- an optional root-level `agent` launcher table for annotation sessions
- an optional `devtools` boolean
- an optional `devtoolsComponentEditor` selector
- an optional `devtoolsMinimapPosition` side selector
- an optional `devtoolsPosition` corner selector
- the full service map

`agent` is optional.
When `agent` is omitted, annotation sessions launch Pi by default.
When `agent` is present, `devhost` executes the configured `command` array directly and passes annotation context through temp-file environment variables.
`devtools` is optional and defaults to `true`.
`devtoolsComponentEditor` is optional and defaults to `"vscode"`.
Supported editor values are `"vscode"`, `"vscode-insiders"`, `"cursor"`, `"webstorm"`, and `"neovim"`.
When `devtoolsComponentEditor = "neovim"`, Alt + right-click component-source navigation launches an embedded xterm-backed Neovim session and requires `nvim` on `PATH`.
`devtoolsMinimapPosition` is optional and defaults to `"right"`.
`devtoolsPosition` is optional and defaults to `"bottom-right"`.
When `devtools = true`, routed HTML documents go through the injector path and
`/__devhost__/*` goes to the devtools control server.
When `devtools = false`, routed services proxy directly to the app.
The injected devtools UI supports exactly these status-panel positions:
`top-left`, `top-right`, `bottom-left`, `bottom-right`.
The injected log minimap supports exactly these side positions:
`left`, `right`.

`devhost` must run the whole graph in one parent process.
`devhost` must not create a daemon in v1.

## 5. Data model / manifest schema

The top-level manifest shape is:

```ts
interface DevhostManifest {
  agent?: DevhostAgentConfig;
  name: string;
  primaryService: string;
  devtools?: boolean;
  devtoolsComponentEditor?: "vscode" | "vscode-insiders" | "cursor" | "webstorm" | "neovim";
  devtoolsMinimapPosition?: "left" | "right";
  devtoolsPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  services: Record<string, DevhostServiceConfig>;
}

type DevhostAgentConfig =
  | { adapter: "pi" | "claude-code" | "opencode" }
  | {
      command: string[];
      cwd?: string;
      displayName: string;
      env?: Record<string, string>;
    };

interface DevhostServiceConfig {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: number | "auto";
  bindHost?: string;
  host?: string;
  dependsOn?: string[];
  health?: DevhostHealthConfig;
}

type DevhostHealthConfig = { tcp: number } | { http: string } | { process: true };
```

Example TOML:

```toml
name = "hello-stack"
primaryService = "web"
devtools = true
devtoolsComponentEditor = "neovim"
devtoolsMinimapPosition = "right"
devtoolsPosition = "top-right"

[agent]
displayName = "Claude Code"
command = ["bun", "./scripts/devhost-agent.ts"]
cwd = "."

[services.web]
command = ["bun", "run", "web:dev"]
cwd = "./app"
port = 3000
host = "hello.local.test"
dependsOn = ["api"]

[services.web.env]
NODE_ENV = "development"

[services.api]
command = ["bun", "run", "api:dev"]
cwd = "./api"
port = 4000
host = "api.hello.local.test"
dependsOn = ["db"]

[services.api.health]
http = "http://127.0.0.1:4000/healthz"

[services.db]
command = ["bun", "run", "db:dev"]
cwd = "./db"
port = "auto"
```

## 6. Types and contracts

### Effective runtime types

After defaults are applied, runtime code must use these exact shapes:

```ts
interface ResolvedDevhostManifest {
  agent: ResolvedDevhostAgent;
  name: string;
  primaryService: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  devtools: boolean;
  devtoolsComponentEditor: "vscode" | "vscode-insiders" | "cursor" | "webstorm" | "neovim";
  devtoolsMinimapPosition: "left" | "right";
  devtoolsPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  services: Record<string, ResolvedDevhostService>;
}

type ResolvedDevhostAgent =
  | { kind: "pi" | "claude-code" | "opencode"; displayName: string }
  | {
      kind: "configured";
      command: string[];
      cwd: string;
      displayName: string;
      env: Record<string, string>;
    };

interface ResolvedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: number | null;
  bindHost: string;
  host: string | null;
  dependsOn: string[];
  health: ResolvedHealthConfig;
  portSource: "fixed" | "auto" | "none";
}

type ResolvedHealthConfig =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "http"; url: string }
  | { kind: "process" };
```

### Defaulting rules

`devhost` must apply these defaults exactly:

- `agent` defaults to `{ kind: "pi", displayName: "Pi" }`.
- configured `agent.cwd` defaults to the manifest directory.
- configured `agent.env` defaults to `{}`.
- `devtools` defaults to `true`.
- `devtoolsComponentEditor` defaults to `"vscode"`.
- `devtoolsMinimapPosition` defaults to `"right"`.
- `devtoolsPosition` defaults to `"bottom-right"`.
- `cwd` defaults to the manifest directory.
- `env` defaults to an empty object before parent-process environment merging.
- `bindHost` defaults to `127.0.0.1`.
- `dependsOn` defaults to `[]`.
- If `port` is set to an integer and `health` is omitted, the effective health
  check becomes `{ kind: "tcp", host: bindHost, port }`.
- If `port` is set to `"auto"`, `devhost` must allocate an available TCP port
  before spawning the service and the effective health check becomes
  `{ kind: "tcp", host: bindHost, port: <resolved port> }`.
- If `port` is not set and `health` is omitted, validation must fail.
- `host` has no default.

### Injected environment variables

For every started service, `devhost` must merge environment in this exact order:

1. parent process environment
2. service `env`
3. `devhost` injected variables

`devhost` must inject these exact variables:

```ts
interface InjectedServiceEnvironment {
  DEVHOST_STACK: string;
  DEVHOST_SERVICE_NAME: string;
  DEVHOST_BIND_HOST: string;
  DEVHOST_MANIFEST_PATH: string;
  PORT?: string;
  DEVHOST_HOST?: string;
}
```

Injection rules:

- `DEVHOST_STACK` must equal manifest `name`.
- `DEVHOST_SERVICE_NAME` must equal the service key. Example: `[services.api]` maps to `DEVHOST_SERVICE_NAME=api`.
- `DEVHOST_BIND_HOST` must equal the resolved `bindHost`. This is the socket bind host and must be treated as the authoritative bind target.
- `DEVHOST_MANIFEST_PATH` must equal the absolute manifest path.
- `PORT` must be injected only when the resolved runtime port is known. In manifest mode this includes auto-resolved ports.
- `DEVHOST_HOST` must be injected only when `host` is set. This is the routed public hostname from the manifest.

### Configured annotation-agent environment variables

When the root-level `[agent]` table is present, `devhost` must write annotation payload files and inject these exact variables into the configured agent command:

```ts
interface InjectedAnnotationAgentEnvironment {
  DEVHOST_AGENT_ANNOTATION_FILE: string;
  DEVHOST_AGENT_PROMPT_FILE: string;
  DEVHOST_AGENT_DISPLAY_NAME: string;
  DEVHOST_AGENT_TRANSPORT: "files";
  DEVHOST_PROJECT_ROOT: string;
  DEVHOST_STACK_NAME: string;
}
```

Rules:

- `DEVHOST_AGENT_ANNOTATION_FILE` must point to a temp JSON file containing the raw annotation payload.
- `DEVHOST_AGENT_PROMPT_FILE` must point to a temp UTF-8 text file containing the rendered annotation prompt.
- `DEVHOST_AGENT_DISPLAY_NAME` must equal the resolved agent display name.
- `DEVHOST_AGENT_TRANSPORT` must equal `files`.
- `DEVHOST_PROJECT_ROOT` must equal the manifest directory path.
- `DEVHOST_STACK_NAME` must equal the manifest `name`.

## 7. Exact file plan

### Add

- `devhost/src/stackTypes.ts`
  - manifest and runtime types
- `devhost/src/resolveManifestPath.ts`
  - upward manifest discovery
- `devhost/src/readManifest.ts`
  - TOML loading via Bun
- `devhost/src/validateManifest.ts`
  - Zod v4 schema validation plus semantic checks
- `devhost/src/resolveServiceOrder.ts`
  - dependency graph validation and topological ordering
- `devhost/src/resolveServicePorts.ts`
  - resolves `port = "auto"` using `get-port`
- `devhost/src/waitForServiceHealth.ts`
  - health checks for tcp, http, and process
- `devhost/src/startStack.ts`
  - multi-service orchestration, cleanup, and route activation
- `test/devhost.toml`
  - sample manifest for the demo app

### Modify

- `devhost/package.json`
  - add `get-port` and `zod`
- `devhost/tsconfig.json`
  - compile only `src/`
- `package.json`
  - run the devhost package from the repository root
- `README.md`
  - document manifest mode and the test app manifest

## 8. Runtime behavior

### Manifest discovery

When `bun run devhost` is executed with no `--host` flag, `devhost` must search for `devhost.toml` in this exact order:

1. current working directory
2. each parent directory moving upward
3. stop at the first matching file
4. stop searching at the git repository root or filesystem root, whichever is reached first

If no manifest is found, `devhost` must exit with code `1` and print:

```text
devhost failed: Could not find devhost.toml from <cwd> upward.
```

### Startup order

Manifest mode must execute this exact sequence:

1. discover manifest
2. parse TOML
3. validate the schema with Zod v4
4. validate semantic rules
5. resolve every `port = "auto"` using `get-port` with `reserve: true`
6. reserve every `host`
7. compute dependency order
8. start services in topological order
9. wait for the current service health check to pass
10. activate that service's Caddy route if `host` is set
11. continue until all services are healthy
12. wait for a child exit or process signal
13. stop services in reverse startup order
14. remove all routes and reservations

Services must start sequentially in v1.

### Routing behavior

For a routed service with `devtools = true`, Caddy must route:

1. `/__devhost__/*` to the devtools control server
2. requests with `Sec-Fetch-Dest: document` to the document injector server
3. everything else directly to the app

For a routed service with `devtools = false`, Caddy must route directly to the app.

### Auto-port resolution

`devhost` must use `get-port` for `port = "auto"`.

The exact resolution algorithm is:

1. collect every fixed numeric port grouped by `bindHost`
2. iterate services in stable manifest key order
3. for each `port = "auto"` service, call `getPort({ host: bindHost, exclude: excludedPorts, reserve: true })`
4. add the returned port to the exclusion set for that `bindHost`
5. store the resolved port in the runtime service config before any child process is spawned

The reservation is an in-process safeguard only.
It must not be treated as protection against external-process races.

### Shutdown behavior

On parent exit, signal, or startup failure:

1. stop services in reverse startup order with `SIGTERM`
2. wait up to `10_000ms` per service
3. send `SIGKILL` to any remaining live service
4. remove Caddy route files for all services
5. remove reservation files for all services

### Logging

Manifest mode must prefix every service output line with the service name in square brackets.

Example:

```text
[web] listening on http://127.0.0.1:3000
[api] GET /healthz 200
```

## 9. Validation rules

Manifest validation must enforce all of the following:

- `name` must be a non-empty string.
- `primaryService` must be the name of an existing service.
- `services` must contain at least one service.
- Every service name must match `^[a-z][a-z0-9-]*$`.
- Every service `command` must contain at least one non-empty string.
- Every service `cwd`, if present, must resolve inside the manifest directory or one of its descendants.
- Every service `env` value must be a string.
- Every service `port`, if present, must be either an integer in the range `1..65535` or the exact string `"auto"`.
- Every service `dependsOn` target must exist.
- The dependency graph must be acyclic.
- Every service must have exactly one effective health check after defaults are applied.
- `health.tcp` must be an integer in the range `1..65535`.
- `health.http` must be an absolute URL whose host is `127.0.0.1`, `localhost`, or `::1`.
- `health.process` must be exactly `true`.
- `host` must be a syntactically valid hostname.
- No two services may define the same `host`.
- A service with `host` must also define `port`.
- A service with `host` must not use `health.process`.
- A service with `port = "auto"` must omit `health` in v1.
- No two services may share the same fixed `{ bindHost, port }` pair in the manifest.
- No two services may share the same resolved `{ bindHost, port }` pair at runtime.
- `bindHost` must be one of `127.0.0.1`, `0.0.0.0`, `::1`, or `::`.

## 10. Exact CLI surface

### Manifest mode

```bash
bun run devhost
```

This command must start manifest mode when both conditions are true:

- `--host` is absent
- `devhost.toml` is found by discovery

### Explicit manifest path

`devhost` v1 must also support:

```bash
bun run devhost --manifest ./devhost.toml
```

Rules:

- `--manifest` and `--host` must be mutually exclusive.
- `--manifest` must accept exactly one path argument.
- The path must resolve to a file named `devhost.toml`.

## 11. Implementation order

1. move devhost code under `devhost/src/`
2. add manifest and runtime types in `devhost/src/stackTypes.ts`
3. add manifest discovery in `devhost/src/resolveManifestPath.ts`
4. add TOML parsing in `devhost/src/readManifest.ts`
5. add Zod v4 schema validation and semantic validation in `devhost/src/validateManifest.ts`
6. add dependency ordering in `devhost/src/resolveServiceOrder.ts`
7. add auto-port resolution in `devhost/src/resolveServicePorts.ts`
8. add health-check logic in `devhost/src/waitForServiceHealth.ts`
9. add stack startup and shutdown orchestration in `devhost/src/startStack.ts`
10. wire manifest mode into `devhost/src/index.ts`
11. add a sample manifest for the test app
12. update `README.md`

## 12. Testing plan

The implementation must include tests in `devhost/src/__tests__/` with at least 90% line coverage for the manifest-related modules.

The test suite must cover:

- manifest discovery from nested directories
- explicit `--manifest` path parsing
- invalid TOML parse failure
- missing `primaryService`
- cyclic dependencies
- duplicate `host`
- invalid `host` syntax
- `host` without `port`
- `health.process` on a routed service rejection
- duplicate fixed `{ bindHost, port }` rejection
- `port = "auto"` resolving to unique runtime ports
- startup-order dependency resolution
- health-check behavior for tcp, http, and process modes
- compatibility of CLI argument parsing

## 13. Out-of-scope / rejection list

Reject implementations that:

- treat `command` as a shell string in v1
- hardcode a private domain suffix into devhost source code
- activate routes before health checks pass
- keep running services after startup failure
- search for multiple manifests and merge them
- implement per-service devtools flags in v1
- add an external TOML parsing dependency
- skip Zod v4 for schema validation

## 14. Definition of done

This work is done only when all of the following are true:

- `bun run devhost` starts a valid `devhost.toml` stack from the current project with no `--host` or `--port` flags.
- `bun run devhost --manifest ./devhost.toml` starts the same stack.
- services with `port = "auto"` receive a unique injected `PORT` value before spawn.
- root-level `devtools` defaults to `true` and can be set to `false`.
- root-level `devtoolsComponentEditor` defaults to `"vscode"` and controls Alt + right-click component-source navigation.
- `devtoolsComponentEditor = "neovim"` launches that navigation target inside an embedded xterm-backed Neovim session and requires `nvim` on `PATH`.
- root-level `devtoolsMinimapPosition` defaults to `"right"` and controls the injected log minimap side.
- root-level `devtoolsPosition` defaults to `"bottom-right"` and controls the injected status-panel corner.
- every routed service is reachable through Caddy only after its health check passes.
- startup failure tears down all started services and removes all routes and reservations.
- shutdown on `SIGINT` and `SIGTERM` removes all routes and reservations.
- manifest validation errors are deterministic and name the exact offending service and field.
- `test/devhost.toml` provides a working sample manifest for the demo app.
- the root-level `[agent]` table launches a configured annotation agent command when present, and Pi when omitted.

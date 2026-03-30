# `devhost.toml` v1 design

## 1. Objective and non-goals

### Objective

Add a manifest-driven stack mode to `devhost` so a project can define its full local development stack in one file and start it with no routing arguments.

The v1 command contract is:

```bash
bun run devhost
```

When run from inside a project containing `devhost.toml`, `devhost` must:

1. discover the manifest
2. validate it
3. reserve every public hostname before starting any child process
4. start all services in dependency order
5. wait for each service readiness check
6. register Caddy routes for every service with `publicHost`
7. stream prefixed logs for all services
8. shut everything down and clean up routes on exit or failure

### Non-goals

The following items are out of scope for `devhost.toml` v1:

- browser UI injection
- global control-plane daemon
- per-service restart buttons in a browser
- Docker or Compose orchestration
- shell-string command execution as the primary command format
- profiles, matrices, or environment overlays
- lifecycle hooks
- log-pattern readiness checks
- remote hosts or non-local routing
- arbitrary wildcard host generation

## 2. Current codebase baseline

These baseline facts are verified from the repository at the time of writing:

- `devhost/index.ts` currently supports a single-service CLI mode with required `--host` and `--port` flags followed by `-- <command...>`.
- `devhost/index.ts` claims a host reservation before spawning the child process.
- `devhost/index.ts` waits for a TCP port to open before activating the Caddy route.
- `devhost/index.ts` writes one Caddy route file per host into `caddy/routes/`.
- `devhost/index.ts` writes one registration file per host into `caddy/routes/.registrations/`.
- `caddy/Caddyfile` uses `tls internal` and imports `./routes/*.caddy` at the top level.
- `README.md` documents only the single-service `--host` / `--port` workflow.
- No manifest parser, service graph, or multi-service supervisor exists today.

## 3. Non-negotiable constraints

- The manifest filename must be exactly `devhost.toml`.
- The manifest mode must be additive. Existing `--host` / `--port` single-service mode must continue to work.
- The primary process runtime must remain Bun.
- The manifest command format must be an array of argv tokens, not a shell string.
- Public routing must remain limited to `xcv.lol` or subdomains of `xcv.lol` in v1.
- `devhost` must never leave a child process running after manifest startup fails.
- `devhost` must never activate a Caddy route for a service that has not passed readiness.
- `devhost` must reserve all public hosts before starting any service process.
- `devhost` must reject ambiguous bind/routing configuration instead of guessing.
- The manifest model must separate runtime binding from public hostname routing.

## 4. Exact architecture choice

`devhost.toml` v1 uses a single manifest file with an explicit service graph.

Each service defines:

- an argv command array
- an optional working directory
- optional environment variables
- an optional local port
- an optional public hostname
- zero or more service dependencies
- exactly one effective readiness rule

`devhost` must run the entire graph in a single parent process.

`devhost` must not create a daemon in v1.

`devhost` must not inject UI code into proxied responses in v1.

`devhost` must not treat a database or internal dependency as a public host unless the manifest explicitly sets `publicHost`.

## 5. Data model / manifest schema

The top-level manifest shape is:

```ts
interface DevhostManifest {
  name: string;
  primaryService: string;
  services: Record<string, DevhostServiceConfig>;
}

interface DevhostServiceConfig {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  port?: number;
  bindHost?: string;
  publicHost?: string;
  dependsOn?: string[];
  ready?: DevhostReadyConfig;
}

type DevhostReadyConfig =
  | { tcp: number }
  | { http: string }
  | { process: true };
```

The exact TOML representation is:

```toml
name = "hello-stack"
primaryService = "web"

[services.web]
command = ["bun", "run", "web:dev"]
cwd = "."
port = 3000
publicHost = "hello.xcv.lol"
dependsOn = ["api"]

[services.web.env]
NODE_ENV = "development"

[services.web.ready]
tcp = 3000

[services.api]
command = ["bun", "run", "api:dev"]
cwd = "."
port = 4000
publicHost = "api.hello.xcv.lol"
dependsOn = ["db"]

[services.api.ready]
http = "http://127.0.0.1:4000/healthz"

[services.db]
command = ["bun", "run", "db:dev"]
port = 5432

[services.db.ready]
tcp = 5432
```

## 6. Types and contracts

### Effective runtime types

After defaults are applied, runtime code must use these exact shapes:

```ts
interface ResolvedDevhostManifest {
  name: string;
  manifestPath: string;
  manifestDirectoryPath: string;
  primaryService: string;
  services: Record<string, ResolvedDevhostService>;
}

interface ResolvedDevhostService {
  name: string;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  port: number | null;
  bindHost: string;
  publicHost: string | null;
  dependsOn: string[];
  ready: ResolvedReadyConfig;
}

type ResolvedReadyConfig =
  | { kind: "tcp"; host: string; port: number }
  | { kind: "http"; url: string }
  | { kind: "process" };
```

### Defaulting rules

`devhost` must apply these defaults exactly:

- `cwd` defaults to the manifest directory.
- `env` defaults to an empty object before parent-process environment merging.
- `bindHost` defaults to `127.0.0.1`.
- `dependsOn` defaults to `[]`.
- If `port` is set and `ready` is omitted, the effective readiness becomes `{ kind: "tcp", host: bindHost, port }`.
- If `port` is not set and `ready` is omitted, manifest validation must fail.
- `publicHost` has no default.

### Injected environment variables

For every started service, `devhost` must merge environment in this exact order:

1. parent process environment
2. service `env`
3. `devhost` injected variables

`devhost` must inject these exact variables:

```ts
interface InjectedServiceEnvironment {
  DEVHOST_STACK: string;
  DEVHOST_SERVICE: string;
  DEVHOST_BIND_HOST: string;
  DEVHOST_MANIFEST_PATH: string;
  PORT?: string;
  DEVHOST_PUBLIC_HOST?: string;
  HOST?: string;
}
```

Injection rules:

- `DEVHOST_STACK` must equal manifest `name`.
- `DEVHOST_SERVICE` must equal the service key.
- `DEVHOST_BIND_HOST` must equal the resolved `bindHost`.
- `DEVHOST_MANIFEST_PATH` must equal the absolute manifest path.
- `PORT` must be injected only when `port` is set.
- `DEVHOST_PUBLIC_HOST` must be injected only when `publicHost` is set.
- `HOST` must be injected only when `publicHost` is set. This exists only for compatibility with existing development servers. `devhost` runtime logic must not depend on `HOST`.

## 7. Exact file plan

### Add

- `docs/toml-config.md`
  - exact v1 manifest spec and implementation plan
- `devhost/stackTypes.ts`
  - manifest, resolved manifest, and service runtime types
- `devhost/resolveManifestPath.ts`
  - manifest discovery from current working directory
- `devhost/readManifest.ts`
  - TOML loading and parsing
- `devhost/validateManifest.ts`
  - schema and semantic validation
- `devhost/resolveServiceOrder.ts`
  - dependency graph validation and topological ordering
- `devhost/waitForServiceReady.ts`
  - readiness checks for tcp, http, and process
- `devhost/startStack.ts`
  - multi-service orchestration, cleanup, and route activation
- `test/fixtures/devhost/basic-stack/devhost.toml`
  - valid multi-service fixture
- `test/fixtures/devhost/invalid-cycle/devhost.toml`
  - invalid cyclic dependency fixture
- `test/fixtures/devhost/invalid-public-host/devhost.toml`
  - invalid host fixture outside `xcv.lol`

### Modify

- `devhost/index.ts`
  - add no-arg manifest mode while keeping existing single-service mode
- `README.md`
  - document manifest mode and example `devhost.toml`

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
3. validate manifest
4. reserve every `publicHost`
5. compute dependency order
6. start services in topological order
7. wait for the current service readiness to pass
8. activate that service's Caddy route if `publicHost` is set
9. continue until all services are ready
10. wait for child exits or process signals
11. stop services in reverse startup order
12. remove all routes and reservations

A service becomes startable only when all services in `dependsOn` are ready.

Services must start sequentially in v1.

### Shutdown behavior

On parent exit, signal, or startup failure:

1. stop services in reverse startup order with `SIGTERM`
2. wait up to `10_000ms` per service
3. send `SIGKILL` to any remaining live service process
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
- Every service `port`, if present, must be an integer in the range `1..65535`.
- Every service `dependsOn` target must exist.
- The dependency graph must be acyclic.
- Every service must have exactly one effective readiness rule after defaults are applied.
- `ready.tcp` must be an integer in the range `1..65535`.
- `ready.http` must be an absolute URL whose host is `127.0.0.1`, `localhost`, or `::1`.
- `ready.process` must be exactly `true`.
- `publicHost` must be `xcv.lol` or a subdomain of `xcv.lol`.
- No two services may define the same `publicHost`.
- A service with `publicHost` must also define `port`.
- A service with `publicHost` must not use `ready.process`.
- No two services may share the same `{ bindHost, port }` pair.
- `bindHost` must be one of `127.0.0.1`, `0.0.0.0`, `::1`, or `::`.

## 10. Exact CLI surface

### Existing single-service mode

This mode remains valid and unchanged:

```bash
bun run devhost --host hello.xcv.lol --port 3200 -- bun run test:hello
```

### New manifest mode

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

1. add `docs/toml-config.md`
2. add manifest and resolved-manifest types in `devhost/stackTypes.ts`
3. add manifest discovery in `devhost/resolveManifestPath.ts`
4. add TOML parsing in `devhost/readManifest.ts`
5. add semantic validation in `devhost/validateManifest.ts`
6. add dependency ordering in `devhost/resolveServiceOrder.ts`
7. add readiness logic in `devhost/waitForServiceReady.ts`
8. add stack startup and shutdown orchestration in `devhost/startStack.ts`
9. wire manifest mode into `devhost/index.ts`
10. update `README.md`

## 12. Testing plan

The implementation must include tests for:

- manifest discovery from nested directories
- explicit `--manifest` path loading
- invalid TOML parse failure
- missing `primaryService`
- cyclic dependencies
- duplicate `publicHost`
- invalid `publicHost` outside `xcv.lol`
- `publicHost` without `port`
- `ready.process` on a routed service rejection
- duplicate `{ bindHost, port }` rejection
- startup order respecting `dependsOn`
- route activation only after readiness passes
- startup failure cleaning all already-started child processes
- signal handling stopping all services and removing routes
- compatibility of existing `--host` / `--port` mode

## 13. Out-of-scope / rejection list

Reject implementations that:

- treat `command` as a shell string in v1
- infer public hosts from service names
- route every service automatically
- use `HOST` as the internal routing source of truth
- start services concurrently in v1
- activate routes before readiness passes
- keep running services after any startup failure
- search for multiple manifests and merge them
- add browser UI injection to satisfy this config spec
- replace the existing single-service CLI mode

## 14. Definition of done

This work is done only when all of the following are true:

- `bun run devhost` starts a valid `devhost.toml` stack from the current project with no `--host` or `--port` flags.
- `bun run devhost --manifest ./devhost.toml` starts the same stack.
- existing single-service mode still works unchanged.
- every routed service is reachable through Caddy only after readiness passes.
- startup failure tears down all started services and removes all routes and reservations.
- shutdown on `SIGINT` and `SIGTERM` removes all routes and reservations.
- validation errors are deterministic and name the exact offending service and field.
- `README.md` includes one valid multi-service `devhost.toml` example.

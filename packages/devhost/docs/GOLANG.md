# Go Rewrite Guard Checklist

## Purpose

This file is the rewrite completion gate for the `devhost` Go port.

It is intentionally a guard checklist, not an implementation plan. Another agent may use this file to track parity and readiness. A box is complete only when the rewritten Go runtime proves the behavior in tests, validation output, or manual evidence.

## Scope Lock

- [x] The shipped runtime is a single native `devhost` binary per target platform.
- [x] Caddy remains an external dependency and is not embedded into the binary.
- [ ] Full feature parity with the current `packages/devhost` product behavior is preserved.
- [ ] No user-facing feature has been removed, degraded, or silently redefined.
- [ ] No public manifest contract changes were introduced.
- [ ] No on-disk state migration is required for existing users.
- [x] No Bun runtime dependency remains for executing the shipped binary.

## Source-Of-Truth Audit

- [x] The rewrite was checked against `packages/devhost/README.md` for user-facing behavior parity.
- [x] The rewrite was checked against `packages/devhost/devhost.example.toml` for manifest examples and defaults.
- [x] The rewrite was checked against `packages/devhost/src/runDevhost.ts` for top-level CLI behavior parity.
- [x] The rewrite was checked against `packages/devhost/src/manifest/` for manifest discovery, parsing, validation, and defaults.
- [x] The rewrite was checked against `packages/devhost/src/caddy/` for managed Caddy lifecycle and state behavior.
- [x] The rewrite was checked against `packages/devhost/src/services/` for orchestration, health, ports, shutdown, and cleanup behavior.
- [x] The rewrite was checked against `packages/devhost/src/utils/routeUtils.ts` for route-registration, host-claim, and route-ordering behavior.
- [x] The rewrite was checked against `packages/devhost/src/devtools-server/` for control-server, injection, terminal-session, and annotation-queue behavior.
- [x] The rewrite was checked against `packages/devhost/src/agents/` for built-in adapter behavior and OSC integration.
- [ ] The rewrite was checked against the current test suite to confirm that every behavior presently covered still has equivalent coverage.

## CLI Surface

- [x] `devhost` with no subcommand still starts manifest mode.
- [x] `devhost --manifest ./devhost.toml` still starts manifest mode with an explicit manifest path.
- [x] `devhost --help` still prints help and exits successfully.
- [x] `devhost -h` still prints help and exits successfully.
- [x] `devhost caddy start` still behaves as a managed Caddy lifecycle command.
- [x] `devhost caddy stop` still behaves as a managed Caddy lifecycle command.
- [x] `devhost caddy trust` still behaves as a managed Caddy lifecycle command.
- [x] `devhost caddy download` still behaves as a managed Caddy lifecycle command.
- [x] `devhost caddy privileged-ports` still behaves as a managed Caddy lifecycle command.
- [x] `devhost caddy print-root-cert` still prints the managed root certificate.
- [x] `devhost caddy trust-remote <ssh-target>` still performs remote certificate trust behavior.
- [x] No public `--version` flag was added during parity rewrite.
- [x] Manifest mode still rejects positional child commands.
- [x] `--manifest` still rejects paths that do not end in `devhost.toml`.
- [x] `print-root-cert` still rejects `--manifest`.
- [x] `print-root-cert` still rejects extra arguments.
- [x] `trust-remote` still rejects `--manifest`.
- [x] `trust-remote` still requires exactly one SSH target.
- [x] `trust-remote` still rejects extra arguments.
- [x] Top-level success paths still return exit code `0`.
- [x] Top-level uncaught operational failures still return exit code `1`.
- [ ] Signal exits still preserve the current `SIGINT`, `SIGTERM`, and `SIGHUP` exit codes.

## Manifest Discovery, Parsing, And Validation

- [x] Manifest discovery still walks upward from the current working directory until `.git` or filesystem root.
- [x] Explicit `--manifest` still bypasses upward discovery.
- [x] Duplicate TOML table failures still surface as `table declared more than once`.
- [x] The manifest still requires at least one service.
- [x] Service names still match `^[a-z][a-z0-9-]*$`.
- [x] No more than one service can set `primary = true`.
- [x] When no service sets `primary = true`, the same service becomes primary as in the current runtime.
- [x] Service `cwd` still must remain within the manifest directory.
- [x] Custom-agent `cwd` still must remain within the manifest directory.
- [x] Every `dependsOn` entry still must reference an existing service.
- [x] Routed services still require `port`.
- [x] Routed services still reject `health.process`.
- [x] `port = "auto"` still rejects explicit `health`.
- [x] Each service still must define either `port` or `health`.
- [x] `health.http` still requires an absolute URL.
- [x] `health.http` still only permits hostnames `127.0.0.1`, `localhost`, or `::1`.
- [x] Route paths still must start with `/`.
- [x] Route paths still only allow `/`, exact paths, or trailing `/*` wildcard paths.
- [x] Same-host overlapping routed paths are still rejected except for `/` acting as fallback.
- [x] Fixed numeric port conflicts still collapse IPv4 loopback and wildcard scope together.
- [x] Fixed numeric port conflicts still collapse IPv6 loopback and wildcard scope together.
- [x] String `command` values still use whitespace splitting semantics rather than shell parsing semantics.

## Defaults

- [x] Default Caddy admin address remains `127.0.0.1:20197`.
- [x] Default Caddy bind host remains `127.0.0.1`.
- [x] Default Caddy `http` remains `false`.
- [x] Default Caddy `httpPort` remains `80`.
- [x] Default Caddy `httpsPort` remains `443`.
- [x] Devtools editor remains enabled by default.
- [x] Default editor remains `vscode`.
- [x] External toolbars remain enabled by default.
- [x] Minimap remains enabled by default.
- [x] Default minimap position remains `right`.
- [x] Status remains enabled by default.
- [x] Default status position remains `bottom-right`.
- [x] Default agent remains Pi.

## Managed Caddy State And Lifecycle

- [x] State directory resolution still uses `DEVHOST_STATE_DIR`, else `XDG_STATE_HOME/devhost`, else `~/.local/state/devhost`.
- [x] Managed Caddy state still lives under `<state>/caddy/`.
- [x] `Caddyfile`, storage, route registration, host-claim, port-claim, pidfile, and root-cert paths remain compatible with the current runtime.
- [x] Managed Caddy configuration is still ensured before lifecycle operations that require it.
- [x] `caddy start` still returns success when the managed admin API is already reachable and the managed pidfile proves ownership.
- [x] `caddy start` still fails when the managed admin API is reachable but the pidfile does not prove devhost ownership.
- [x] `caddy stop` still stops only a devhost-owned managed Caddy instance.
- [x] `caddy stop` still cleans stale pidfiles when the server is gone.
- [x] `caddy trust` still requires a reachable admin API and managed pidfile.
- [x] `caddy print-root-cert` still prints only the PEM certificate content needed by callers.
- [x] `caddy trust-remote` still shells through SSH to `devhost caddy print-root-cert` on the remote side.
- [x] `caddy trust-remote` still prints the certificate fingerprint before trust installation.
- [x] `caddy trust-remote` remains macOS-only.
- [x] `caddy privileged-ports` remains a no-op on macOS.
- [x] `caddy privileged-ports` still uses Linux capability elevation semantics on Linux.
- [x] `caddy privileged-ports` still rejects unsupported non-Linux, non-macOS platforms.
- [x] Managed Caddy download still supports the current OS and architecture matrix.
- [x] The current admin-unavailable error message remains unchanged where relied upon by tests or UX.
- [x] The current Caddy reload failure message remains unchanged where relied upon by tests or UX.

## Shared State Compatibility

- [x] Route registration filenames remain compatible with the current `<host>_<serviceName>_<hexEncodedNormalizedPath>.json` convention.
- [x] Host claim filenames remain compatible with the current `<host-with-colons-replaced>.json` convention.
- [x] Fixed port claim filenames remain compatible with the current `<scope>_<port>.json` convention.
- [x] Route registration JSON written by the Go runtime matches the current shape.
- [x] Legacy route registration JSON remains readable and cleanable.
- [x] Host claim JSON written by the Go runtime matches the current shape.
- [x] Fixed port claim JSON written by the Go runtime matches the current shape.
- [x] Ownership checks still key off live PID plus manifest path semantics where the current runtime does.
- [x] Stale claim cleanup still removes dead-owner files and allows recovery.
- [x] Idempotent same-PID same-manifest behavior remains compatible with the current runtime.

## Managed Caddy Global Merge Rules

- [x] Managed global settings are still recomputed from live registrations rather than one manifest in isolation.
- [x] `httpEnabled` is still effectively OR'd across live registrations.
- [x] Opted-in non-default `adminAddress` values still must agree across live stacks.
- [x] Opted-in non-default `bindHost` values still must agree across live stacks.
- [x] Opted-in non-default `httpPort` values still must agree across live stacks.
- [x] Opted-in non-default `httpsPort` values still must agree across live stacks.

## Service Ordering, Ports, And Startup

- [x] Dependency ordering remains topological and cycle-detecting.
- [x] Fixed numeric ports are still claimed before any managed service starts.
- [x] Routed hosts are still claimed before any managed service starts.
- [x] Managed Caddy admin reachability is still verified before service startup begins.
- [x] Services still start in dependency order.
- [x] Routes still activate only after the target service is healthy.
- [x] The same primary-service URL is logged as today for routed and non-routed primaries.
- [x] Any managed child exit still ends the stack unless the current runtime explicitly suppresses that path for restart flow.
- [x] Reverse-order shutdown remains intact.
- [x] Shutdown still escalates from graceful termination to force kill after the same timeout.
- [x] Startup failure cleanup still runs even when startup only partially succeeded.

## Health Checks And Auto-Port Behavior

- [x] `process` health still succeeds immediately when the child has not already exited.
- [x] `tcp` health still polls TCP readiness.
- [x] `http` health still polls the configured URL.
- [x] Default health for a service with a resolved port and no explicit health remains TCP against the resolved bind host and port.
- [x] `retries = 0` still means keep polling until timeout.
- [x] Positive `retries` values still trigger early failure after consecutive failures.
- [x] Auto-port retries still apply only to services that started with `port = "auto"`.
- [x] Auto-port retries still happen only on recognized bind-collision failures.
- [x] Auto-port retry count remains `3`.
- [x] Derived TCP health targets still update when an auto-assigned port changes after retry.
- [x] The current loopback bind-host ambiguity warning still appears in the same situations.

## Routing Behavior

- [x] Host route rendering remains compatible with current HTTP and HTTPS site-block behavior.
- [x] HTTPS routing still uses internal TLS in the same cases as today.
- [x] Optional HTTP routing still appears only in the same cases as today.
- [x] Route priority ordering remains compatible with the current base-path length, exact-vs-wildcard, and service-name tie-break semantics.
- [x] `/` and `/*` normalization remains compatible with current registration behavior.
- [x] One manifest can still mount multiple services under the same host on non-overlapping paths.
- [x] Exclusive hostname ownership across projects remains enforced.
- [x] Missing root registrations still produce the same root fallback behavior.
- [x] Fallback not-found site synchronization remains compatible with the current runtime.

## Logging And Injected Environment

- [x] Devhost-owned logs still use the same logger prefix behavior.
- [x] Manifest-scoped logs still use the manifest `name` as label.
- [x] Pre-manifest logs still fall back to the `devhost` label.
- [x] Child process log lines still remain prefixed with `[service-name]`.
- [x] Caddy success chatter still remains suppressed.
- [x] Caddy output still surfaces on failure paths.
- [x] `DEVHOST_BIND_HOST` is still injected for managed services.
- [x] `DEVHOST_MANIFEST_PATH` is still injected for managed services.
- [x] `DEVHOST_SERVICE_NAME` is still injected for managed services.
- [x] `PORT` is still injected only when the service has a resolved port and `injectPort !== false`.
- [x] `DEVHOST_HOST` is still injected for routed services.
- [x] `DEVHOST_PATH` is still injected only when the service path is present.
- [x] `injectPort = false` still suppresses only `PORT` and not the other devhost metadata variables.

## Devtools Control Surface

- [x] The control path prefix remains `/__devhost__`.
- [x] `GET /__devhost__/inject.js` still returns the injected script with no-store caching semantics.
- [x] `GET /__devhost__/xterm.css` still returns the xterm stylesheet with no-store caching semantics.
- [x] `POST /__devhost__/restart-service` still exists and preserves current auth and response semantics.
- [x] `GET /__devhost__/terminal-sessions` still exists and preserves current auth and response semantics.
- [x] `POST /__devhost__/terminal-sessions` still exists and preserves current auth and response semantics.
- [x] `GET /__devhost__/annotation-queues` still exists and preserves current auth and response semantics.
- [x] `PATCH /__devhost__/annotation-queues/:entryId` still exists and preserves current auth and response semantics.
- [x] `DELETE /__devhost__/annotation-queues/:entryId` still exists and preserves current auth and response semantics.
- [x] `POST /__devhost__/annotation-queues/:queueId/resume` still exists and preserves current auth and response semantics.
- [x] `GET /__devhost__/ws/health` still exists.
- [x] `GET /__devhost__/ws/logs` still exists.
- [x] `GET /__devhost__/ws/annotation-queues` still exists.
- [x] `GET /__devhost__/ws/terminal` still exists.
- [x] Header-based and query-parameter auth rules remain compatible with the current asymmetry across endpoints.
- [x] Restart-service remains unsupported in the same cases where the current runtime returns `501`.

## Document Injection

- [x] Document injection still runs only for routed services mounted at root-compatible paths.
- [x] Non-root routed services still proxy directly without document injection.
- [x] The document injection server still binds locally on an ephemeral port.
- [x] The upstream request still targets the backend bind host and backend port.
- [x] The outgoing `Host` header is still removed before proxying upstream.
- [x] `x-devhost-injected: true` is still added.
- [x] `x-forwarded-host` still preserves the original request host.
- [x] `x-forwarded-proto: https` is still added.
- [x] Only `text/html` responses are still rewritten.
- [x] HTML rewriting still appends `<script type="module" src="/__devhost__/inject.js"></script>` to the document body.
- [x] Transformed responses still strip `content-security-policy`.
- [x] Transformed responses still strip `content-security-policy-report-only`.
- [x] Transformed responses still strip `content-length`.

## Devtools Browser Experience

- [x] The injected UI still mounts in a Shadow DOM host.
- [x] Service status remains available in the browser devtools UI.
- [x] Log replay remains available in the browser devtools UI.
- [x] Annotation composition remains available in the browser devtools UI.
- [x] Annotation queue visibility and controls remain available in the browser devtools UI.
- [x] Terminal session visibility and controls remain available in the browser devtools UI.
- [ ] Component-source navigation remains available in the browser devtools UI.
- [x] External devtools launcher aggregation remains available in the browser devtools UI.
- [x] When all devtools features are disabled, devtools control routes still stay unmounted.

## Health And Log WebSockets

- [x] Health WebSocket auth behavior remains unchanged.
- [x] Logs WebSocket auth behavior remains unchanged.
- [x] Annotation-queue WebSocket auth behavior remains unchanged.
- [x] Terminal WebSocket auth behavior remains unchanged.
- [x] Health WebSocket still sends the latest snapshot immediately when available.
- [x] Health WebSocket still suppresses duplicate payloads.
- [x] Logs WebSocket still sends a snapshot first.
- [x] Logs WebSocket still sends incremental entry events after the snapshot.
- [x] Annotation-queue WebSocket still sends snapshot payloads compatible with the current UI contract.
- [x] Terminal WebSocket still sends a snapshot first.
- [x] Terminal WebSocket still sends output, exit, and error messages compatible with the current UI contract.

## Terminal Sessions

- [x] Terminal sessions remain PTY-backed.
- [x] Terminal-session start request shapes remain compatible for both `agent` and `editor` kinds.
- [x] The editor launcher set remains compatible with the current runtime.
- [x] Terminal-session list response shape remains compatible.
- [x] Terminal WebSocket client message shapes remain compatible.
- [x] Terminal WebSocket server message shapes remain compatible.
- [x] Terminal output replay to late subscribers remains available.
- [x] Terminal output retention remains capped compatibly with the current runtime.
- [x] Idle session cleanup still occurs after the current no-socket timeout.
- [x] Invalid client frames still surface an error message instead of silently corrupting the session.
- [x] UI-driven session close still terminates the session immediately.
- [x] PTY environment still includes `TERM=xterm-256color`.
- [x] PTY environment still includes `COLORTERM=truecolor`.
- [x] PTY environment still includes `TERM_PROGRAM=devhost`.

## Annotation Queues

- [x] Queue identity remains based on routed service rather than stack-global identity.
- [x] Different routed paths on the same host still use different queues.
- [x] A new annotation still joins a live target session only when the target session is live and matches the routed-service key.
- [x] Queue status values remain `launching`, `working`, and `paused`.
- [x] Queue entry states remain `active`, `paused-active`, and `queued`.
- [x] UI pause reasons remain `session-exited-before-finished` and `user-terminated`.
- [x] Persisted pause reasons remain compatible with the current runtime.
- [x] Persisted queue file naming remains compatible with sanitized stack name plus manifest-path hash behavior.
- [x] Persisted queue file contents remain compatible with the current versioned JSON format.
- [x] Queue persistence still uses durable write semantics compatible with the current runtime.
- [x] Empty runtime queue state still removes the persisted queue file.
- [x] Corrupt queue files are still renamed aside and reset to empty state.
- [x] Blank comment edits still fail.
- [x] Active queue entries still cannot be edited.
- [x] Active queue entries still cannot be deleted.
- [x] Queue resume still works only from paused state.
- [x] `shutdown` pause state still auto-resumes on next startup.
- [x] `user-terminated` pause state still does not auto-resume on next startup.
- [x] Queue draining on `finished` OSC status remains FIFO-compatible with the current runtime.
- [x] Queue status transitions on `working` OSC status remain compatible with the current runtime.

## Agents And OSC Status

- [x] Built-in Pi adapter behavior remains compatible with the current user-visible workflow.
- [x] Built-in Claude Code adapter behavior remains compatible with the current user-visible workflow.
- [x] Built-in OpenCode adapter behavior remains compatible with the current user-visible workflow.
- [x] Custom agent command behavior remains compatible with the current file-based prompt transport contract.
- [x] Per-session agent temp files remain sufficient to support the current adapter set.
- [x] `DEVHOST_AGENT_ANNOTATION_FILE` remains available where expected.
- [x] `DEVHOST_AGENT_DISPLAY_NAME` remains available where expected.
- [x] `DEVHOST_AGENT_PROMPT_FILE` remains available where expected.
- [x] `DEVHOST_AGENT_TRANSPORT=files` remains available where expected.
- [x] `DEVHOST_PROJECT_ROOT` remains available where expected.
- [x] `DEVHOST_STACK_NAME` remains available where expected.
- [x] `DEVHOST_AGENT_CLAUDE_SETTINGS_FILE` remains available where expected.
- [x] `DEVHOST_AGENT_OPENCODE_CONFIG_FILE` remains available where expected.
- [x] OSC parsing still recognizes `working` status.
- [x] OSC parsing still recognizes `finished` status.
- [x] OSC parsing still supports BEL terminators.
- [x] OSC parsing still supports ST terminators.
- [x] OSC parsing still handles split chunks without losing status transitions.

## Cross-Platform Behavior

- [x] macOS behavior remains compatible for managed Caddy trust flows.
- [x] macOS behavior remains compatible for privileged port setup behavior.
- [x] macOS behavior remains compatible for managed Caddy bind-directive behavior.
- [x] Linux behavior remains compatible for privileged port setup behavior.
- [x] Windows behavior remains compatible for managed Caddy binary naming and download behavior.
- [ ] Platform-specific path handling and temp-file behavior remain compatible with the current user-visible workflows.

## Cleanup And Recovery

- [x] Signal handlers still unregister cleanly during shutdown.
- [x] Started services still stop in reverse order.
- [x] Document injection servers still stop during cleanup.
- [x] Devtools control server still stops during cleanup.
- [x] Active routes still unregister during cleanup.
- [x] Host claims still release during cleanup.
- [x] Fixed port claims still release during cleanup.
- [x] Recovery from stale route registrations still works.
- [x] Recovery from stale host claims still works.
- [x] Recovery from stale fixed port claims still works.

## Test And Validation Coverage

- [x] CLI parsing parity is covered by automated tests.
- [x] Manifest discovery and duplicate-table handling parity is covered by automated tests.
- [x] Manifest validation parity is covered by automated tests.
- [x] Caddy lifecycle parity is covered by automated tests.
- [x] Caddyfile and route rendering parity is covered by automated tests.
- [x] Service ordering, port resolution, health, and cleanup parity is covered by automated tests.
- [x] Shared-state compatibility and stale-file cleanup parity is covered by automated tests.
- [x] Devtools control-server API parity is covered by automated tests.
- [x] Document injection parity is covered by automated tests.
- [x] Terminal-session parity is covered by automated tests.
- [x] Annotation-queue parity is covered by automated tests.
- [x] OSC parsing parity is covered by automated tests.
- [x] Browser-facing devtools behavior parity is covered by browser-based tests where the current repo relies on browser behavior.
- [ ] Manual validation was performed for at least one real stack that exercises routing, health gating, devtools injection, terminal sessions, and annotation queues.

## Documentation, CI, And Release Readiness

- [x] `packages/devhost/README.md` matches the shipped Go runtime behavior.
- [x] `packages/www/src/app/App.tsx` matches any README changes that affect the mirrored website content.
- [x] `packages/devhost/RELEASE.md` matches the actual release process after the rewrite.
- [x] `packages/devhost/AGENTS.md` matches the actual contributor workflow after the rewrite.
- [x] Root `AGENTS.md` matches any shared workflow or validation changes introduced by the rewrite.
- [x] CI configuration matches the real validation and release flow after the rewrite.
- [x] Publish workflow configuration matches the real release artifact flow after the rewrite.
- [x] No stale Bun-runtime instructions remain in user-facing or contributor-facing docs if they no longer apply.

## Explicit Non-Completion Conditions

- [x] This rewrite is not marked complete while any parity gap is still known but undocumented.
- [x] This rewrite is not marked complete while any user-facing contract change still lacks explicit approval.
- [x] This rewrite is not marked complete while docs describe behavior the shipped Go runtime does not implement.
- [ ] This rewrite is not marked complete while the shipped Go runtime implements behavior that docs do not describe.
- [x] This rewrite is not marked complete while release or CI instructions are known to be stale.
- [ ] This rewrite is not marked complete while required tests are missing, skipped, or failing.
- [ ] This rewrite is not marked complete while manual parity validation for a real stack has not been performed.

## Final Completion Gate

- [ ] Every applicable checkbox in this file is complete.
- [ ] Remaining unchecked boxes, if any, are explicitly out of scope by user approval.
- [x] The Go runtime is the authoritative shipped runtime for `packages/devhost`.
- [x] The remaining Bun/TypeScript runtime is either removed or explicitly retained only as approved non-authoritative migration scaffolding.

# GOLAND Notes

## Working Decisions

- The shipped runtime is still Bun/TypeScript today. The Go work is landing incrementally under `packages/devhost/` without claiming full rewrite completion early.
- External libraries are preferred where practical. The Phase 1 foundation uses `github.com/BurntSushi/toml` for TOML parsing instead of a custom parser.
- CLI parsing stays small and explicit because the current `devhost` behavior has parity traps that are awkward to express with a framework:
  - any `-h` or `--help` anywhere short-circuits to global help
  - implicit manifest mode ignores stray positionals unless the first positional is `caddy`
  - `--manifest` validation is just a filename suffix check at parse time

## Phase 1 Scope

- Create a Go module rooted at `packages/devhost`.
- Port CLI help and argument parsing parity.
- Port manifest discovery, TOML loading, duplicate-table diagnostics, defaults, and semantic validation parity.
- Add automated Go tests for the above.
- Update `docs/GOLANG.md` only for items proven by the new Go code and tests.

## Validated Evidence

- `go test ./...` passes for the current Go module.
- `go vet ./...` passes for the current Go module.
- `docs/GOLANG.md` now checks only the rewrite parity items proven by code plus tests.
- Managed Caddy state-path compatibility, `caddy download`, raw `caddy print-root-cert`, `caddy trust-remote`, and `caddy privileged-ports` behavior are now implemented and covered by Go tests.
- The Go Caddy command logs now include the `[devhost]` prefix, matching the current TypeScript foreground logging style for this slice.
- Managed Caddy bind resolution, listener-port helpers, not-found page sync, Caddyfile rendering, config ensure, admin availability probing, and `caddy start|stop|trust` lifecycle behavior are now implemented and covered by Go tests.
- The Go CLI now wires `devhost caddy start|stop|trust` through the managed Caddy lifecycle path, including manifest-derived admin-address fallback when `--manifest` is provided.
- Fixed-port claims, host claims, route registration filenames and JSON shape, host-route snippet rendering and ordering, proxy-host normalization, stale cleanup, activate/unregister flows, and the exact Caddy reload failure message are now implemented inside `internal/caddy` and covered by Go tests.
- The route mutation tests also lock the current rollback order, including deleting the failed registration and resyncing disk state without doing an extra reload on activate failure.
- Service dependency ordering, cycle detection, and runtime port/default-health resolution are now implemented inside `internal/services` and covered by Go tests.
- Manifest mode now resolves service order and runtime ports before hitting the current Go rewrite boundary, so ordering and effective-health failures surface before the remaining manifest-mode stub.
- Non-2xx managed Caddy admin availability errors now render TS-compatible HTTP detail text.
- Service health waiting now covers `process`, `tcp`, and `http` modes with TS-compatible timeout and retry behavior, and is covered by Go tests.
- Auto-port retry utilities and the loopback bind-host ambiguity warning helper are now implemented inside `internal/services` and covered by Go tests.
- A devtools-free `internal/services` stack runner now ports the smallest honest `startStack.ts` path: injected service env, child stdout/stderr prefixing, startup retries, fixed-port and host claims, plain route activation, primary URL logging, first-child-exit waiting, and cleanup.
- The new stack-runner tests prove startup-failure cleanup, routed-service cleanup on exit, fixed-port and host claims being present before child spawn, manifest-scoped log labels, routed and non-routed primary URL logging, child log prefixing, graceful SIGTERM shutdown, and SIGKILL escalation after the configured grace period.
- The stack-runner tests now also explicitly prove managed Caddy admin reachability preflight, dependency-ordered startup, route activation after health passes, first-child-exit termination, and reverse-order shutdown delivery.
- The Go tests now also explicitly prove logger prefix fallback behavior, successful reload chatter suppression, failure-path Caddy output surfacing, and that the current Caddy/service/shared-state slices are covered by automated tests rather than checklist assertion alone.
- `internal/caddy` now exports the managed-config entrypoint and a managed host-route resync helper so the service runner can reuse the existing route/config helpers without reimplementing Caddy state logic.
- `internal/app/run.go` now routes manifest mode into the Go stack runner for both devtools-disabled manifests and the new honest routed-devtools slice instead of rejecting every devtools-enabled manifest outright.
- The Go runtime now honestly supports the smallest routed devtools slice: root-compatible document injection plus the control-server subset for `/__devhost__/inject.js`, `/__devhost__/xterm.css`, `/__devhost__/restart-service`, `/__devhost__/ws/health`, and `/__devhost__/ws/logs`.
- The Go tests now explicitly prove root-only document injection wiring, non-root direct proxy behavior, restart-service `403`/`400`/`200`/`501` responses, unauthenticated health and logs WebSocket availability, health snapshot delivery, logs snapshot-first delivery, and log update streaming.
- The Go runtime now ports the agent-terminal plus durable-annotation-queue slice end-to-end: `POST /__devhost__/terminal-sessions` accepts `kind: "agent"`, the control server owns the durable queue state machine, `/__devhost__/annotation-queues` and `/__devhost__/ws/annotation-queues` now expose queue state, and agent PTY output/exit/user-close/restart flows drive the same `launching`/`working`/`paused` transitions as the TypeScript runtime.
- The package TS check also now uses a deterministic unused-port allocation in `collectManagedServicesHealth` tests instead of assuming port `3200` is closed on the local machine.
- The Go runtime now ports the editor-only terminal-session slice end-to-end: `GET/POST /__devhost__/terminal-sessions`, `GET /__devhost__/ws/terminal`, Neovim-only editor launch validation, PTY-backed session launch, input/resize/close handling, snapshot and exit replay for late subscribers, retained-output capping, idle cleanup, and the `TERM` / `COLORTERM` / `TERM_PROGRAM` env contract.
- The Go agent-session helpers now mirror the current Pi, Claude Code, OpenCode, and configured-agent file transport contract, including per-session prompt/annotation temp files, Claude/OpenCode OSC hook files, and OSC parsing for `working` / `finished` with BEL or ST terminators across split chunks.
- The Go stack runner now enables annotation, queue, and terminal affordances whenever routed devtools are actually mounted, while keeping editor affordances gated to the supported Neovim path.
- The Go tests now explicitly prove document-injection loopback ephemeral binding, health websocket duplicate suppression, reverse-order service stop delivery, cleanup-time route and claim release, stale route/host/fixed-port recovery, and that document injection remains covered by automated tests.
- The Go tests now also explicitly prove durable queue-write helper ordering (`file sync -> rename -> directory sync` and `remove -> directory sync`) plus cleanup-time shutdown of the document-injection and devtools control servers.
- Browser proof now explicitly covers the injected Shadow DOM mount, visible service-status and log-minimap surfaces, annotation UI visibility, terminal-session affordances, and the runtime gate that leaves devtools route ports unmounted when every devtools feature is disabled.
- Passing browser-based Storybook coverage now also proves annotation queue controls and external devtools launcher aggregation, while the Go Caddy unit tests explicitly cover macOS trust and bind behavior, macOS/Linux privileged-port behavior, and Windows managed-binary download naming.
- The Go stack-runner tests now also prove signal-handler registration/unregistration around stack lifetime and preserved signal-exit code mapping inside the runner, while existing app tests continue to prove top-level `0` and `1` exit-code behavior.

## Known Remaining Gaps

- Component-source navigation through the Go runtime is now limited to the Neovim terminal path; other editor integrations still rely on the Bun/TypeScript runtime behavior.
- The Go devtools asset loading is still repo-local today: it reads the checked-in generated browser bundle plus the installed `@xterm/xterm` stylesheet from the workspace instead of shipping self-contained Go-embedded assets.
- Runtime parity is still incomplete for browser-exercised component-source navigation, top-level signal-exit behavior, restart-flow semantics, and some manifest-orchestration edge cases that have not been proven end-to-end yet.
- Release, packaging, and CI still point at the Bun/TypeScript runtime.

## Due Diligence

- `.github/workflows/ci.yml` still appears stale: it calls `bun run --cwd packages/devhost storybook:install-browser`, but `packages/devhost/package.json` has no such script.

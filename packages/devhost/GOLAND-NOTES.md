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

## Known Remaining Gaps

- Manifest mode orchestration is not yet ported.
- Managed route registration writing, host claims, fixed port claims, reload flows, and route-file rendering are not yet ported.
- Service startup/shutdown orchestration, health checks, terminal sessions, WebSockets, annotation queues, and injected devtools contracts are not yet ported.
- Release, packaging, and CI still point at the Bun/TypeScript runtime.

## Due Diligence

- `.github/workflows/ci.yml` still appears stale: it calls `bun run --cwd packages/devhost storybook:install-browser`, but `packages/devhost/package.json` has no such script.

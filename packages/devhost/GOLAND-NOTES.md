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
- `docs/GOLANG.md` now checks only the Phase 1 CLI and manifest parity items proven by code plus tests.

## Known Remaining Gaps

- Manifest mode orchestration is not yet ported.
- Managed Caddy lifecycle is not yet ported.
- Route registration, services, health checks, terminal sessions, WebSockets, annotation queues, and injected devtools contracts are not yet ported.
- Release, packaging, and CI still point at the Bun/TypeScript runtime.

## Due Diligence

- `.github/workflows/ci.yml` still appears stale: it calls `bun run --cwd packages/devhost storybook:install-browser`, but `packages/devhost/package.json` has no such script.

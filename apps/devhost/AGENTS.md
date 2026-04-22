# devhost app contributor notes

Local rules for the `devhost` Go app in `apps/devhost/`.

## Documentation policy

- `README.md` must be kept up to date after behavior changes.
- `AGENTS.md` files must be kept up to date after workflow, policy, or contributor-expectation changes.
- `RELEASE.md` must be kept up to date after tag, packaging, or GitHub release workflow changes.
- Update `README.md` whenever you change:
  - CLI usage
  - manifest behavior
  - injected environment variables
  - routing behavior
  - logging behavior
  - devtools behavior
  - limitations, caveats, or failure modes
- If the manifest contract changes, also update `devhost.example.toml`.
- If devtools-specific contributor rules change, also update `packages/devhost-ui/AGENTS.md` and the nested files under `packages/devhost-ui/src/devtools/`.
- If the tag-driven binary release flow changes, also update `RELEASE.md` and the relevant shared guidance in the repo-root `AGENTS.md`.
- **CRITICAL:** The `devhost` README is heavily mirrored in the demo application's frontend. After editing the `devhost` README, you **must** update the `packages/www/src/app/App.tsx` file in the demo app workspace to keep the marketing website content in sync.
- Do not leave README or AGENTS examples/rules stale after changing implementation details.
- Repo-root `README.md` is a symlink to this workspace README; update `README.md` here, not the root symlink.
- The `docs/` directory is used for conceptual architecture, complex feature flows (e.g., Mermaid diagrams), and internal technical design docs. See `docs/AGENTS.md` for specifics on what belongs in `docs/` vs `README.md`.

## Development workflow

Run the app directly:

```bash
go run ./cmd/devhost --help
```

Build a standalone executable for the current platform:

```bash
bun run compile:devhost
```

Build the versioned cross-platform release tarballs:

```bash
bun run build:release-artifacts:devhost
```

Human-only repo format step when manual cleanup is explicitly needed:

```bash
bun run fix
```

Run the app check suite:

```bash
bun run check:devhost
```

The human-only `fmt` script runs `oxfmt --write` for the repo using the shared root config. Agents should not run it directly; formatting is handled automatically by the repo's git hooks. `bun run check:devhost` runs `go vet ./...` and `go test ./...` from this app. The injected UI checks and Storybook coverage now live in `packages/devhost-ui/`. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

`scripts/buildDevtoolsBundle.ts` refreshes the prebuilt injected devtools bundle used by standalone executables.

`bun run build:release-artifacts:devhost` refreshes that bundle, cross-compiles the supported Go release targets, and writes versioned `.tar.gz` archives to `apps/devhost/dist/release/`.

`bun run compile:devhost` refreshes that bundle, then runs `go build -trimpath -o ./dist/devhost ./cmd/devhost` and writes the current-platform executable to `apps/devhost/dist/devhost`.

## Release workflow

- Follow `RELEASE.md`; it is the authoritative runbook for the tag-driven GitHub Release binary flow.
- Release trigger: push a `v*` tag whose version matches `metadata.json`.
- The publish workflow attaches versioned `.tar.gz` binaries for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl` to the matching GitHub Release.

## Done policy

- Done means the required app docs are updated (`README.md`, relevant `AGENTS.md`, `RELEASE.md`, and `devhost.example.toml` when applicable), required validation for the affected scope has passed, and any temporary local processes started for validation are stopped.
- When changes affect the shipped `devhost` executable or its user-visible behavior, run `bun run compile:devhost` successfully before yielding to the user.
- If `bun run check:devhost`, packaging checks, or required documentation updates were skipped, failed, or are blocked, report the app work as incomplete and call out the exact blocker.
- Release work is not done until the tag exists remotely, the publish workflow has reached its expected result, and the matching GitHub Release state is confirmed.

## Internal app layout

- `cmd/devhost/main.go` — shipped CLI entrypoint
- `bin/devhost` — local shell shim that launches the Go runtime for workspace scripts and source-checkout use
- `internal/app/` — top-level Go CLI dispatch
- `internal/cli/` — command parsing and help text
- `internal/manifest/` — manifest discovery, parsing, validation, and defaults
- `internal/services/` — child process orchestration, health checks, port resolution, and cleanup
- `internal/caddy/` — managed Caddy lifecycle, paths, config, and routing
- `internal/devtools/` — Go devtools control servers plus embedded browser assets
- `scripts/buildDevtoolsBundle.ts` — bundles `@alexgorbatchev/devhost-ui/main` into `internal/devtools/assets_generated.go`

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Do not print successful Caddy reload chatter.
- Surface Caddy output only on failure.

## Devtools UI boundary

- The injected UI source now lives in `packages/devhost-ui/`.
- For injected UI work, follow `packages/devhost-ui/AGENTS.md` plus the nested files under `packages/devhost-ui/src/devtools/`.
- Keep Go-side bundle generation and browser-side UI changes in sync when the embedding contract changes.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.

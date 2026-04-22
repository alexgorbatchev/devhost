# devhost package contributor notes

Local rules for the `devhost` workspace in `packages/devhost/`.

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
- If devtools-specific contributor rules change, also update `src/devtools/AGENTS.md`.
- If the tag-driven binary release flow changes, also update `RELEASE.md` and the relevant shared guidance in the repo-root `AGENTS.md`.
- **CRITICAL:** The `devhost` README is heavily mirrored in the demo application's frontend. After editing the `devhost` README, you **must** update the `packages/www/src/app/App.tsx` file in the demo app workspace to keep the marketing website content in sync.
- Do not leave README or AGENTS examples/rules stale after changing implementation details.
- Repo-root `README.md` is a symlink to this workspace README; update `README.md` here, not the root symlink.
- The `docs/` directory is used for conceptual architecture, complex feature flows (e.g., Mermaid diagrams), and internal technical design docs. See `docs/AGENTS.md` for specifics on what belongs in `docs/` vs `README.md`.

## Development workflow

Run the package directly:

```bash
go run ./cmd/devhost --help
```

Build a standalone executable for the current platform:

```bash
bun run compile
```

Build the versioned cross-platform release tarballs:

```bash
bun run build:release-artifacts
```

Run the package-local Bun test suite:

```bash
bun test
```

Human-only package format step when manual cleanup is explicitly needed:

```bash
bun run fmt
```

Run the package check suite:

```bash
bun run check
```

The human-only `fmt` script runs `oxfmt --write` for this workspace using the shared repo-root config. Agents should not run it directly; formatting is handled automatically by the repo's git hooks. `bun test` covers only the package's Bun-owned tests. The package `check` script is the full package validation entrypoint and runs `go vet ./...`, `go test ./...`, `tsgo --noEmit -p tsconfig.json`, `bun test --coverage`, and `bun vitest run -c vitest.storybook.config.ts`. Use `bun run storybook` only when you need the interactive Storybook dev server for manual inspection. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

The `build:devtools-bundle` script refreshes the prebuilt injected devtools bundle used by standalone executables.

The `build:release-artifacts` script refreshes that bundle, cross-compiles the supported Go release targets, and writes versioned `.tar.gz` archives to `packages/devhost/dist/release/`.

The `compile` script refreshes that bundle, then runs `go build -trimpath -o ./dist/devhost ./cmd/devhost` and writes the current-platform executable to `packages/devhost/dist/devhost`.

## Release workflow

- Follow `RELEASE.md`; it is the authoritative runbook for the tag-driven GitHub Release binary flow.
- Release trigger: push a `v*` tag whose version matches `package.json`.
- The publish workflow attaches versioned `.tar.gz` binaries for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl` to the matching GitHub Release.

## Done policy

- Done means the required package docs are updated (`README.md`, relevant `AGENTS.md`, `RELEASE.md`, and `devhost.example.toml` when applicable), required validation for the affected scope has passed, and any temporary local processes started for validation are stopped.
- When changes affect the shipped `devhost` executable or its user-visible behavior, run `bun run compile` successfully before yielding to the user.
- If `bun test`, `bun run check`, packaging checks, or required documentation updates were skipped, failed, or are blocked, report the package work as incomplete and call out the exact blocker.
- Release work is not done until the tag exists remotely, the publish workflow has reached its expected result, and the matching GitHub Release state is confirmed.

## Testing

- The Storybook `play` functions run in a **real headless browser** (via Playwright / Vitest browser mode). **DO NOT** use JSDOM hacks, DOM event mocking (e.g., overriding `getBoundingClientRect` or `elementsFromPoint`), or artificial `dispatchEvent` setups to simulate interactions. Use standard `@storybook/test` utilities like `userEvent` and `within`—they work correctly against the real DOM.

## Internal package layout

- `cmd/devhost/main.go` — shipped CLI entrypoint
- `bin/devhost` — local shell shim that launches the Go runtime for workspace scripts and source-checkout use
- `internal/app/` — top-level Go CLI dispatch
- `internal/cli/` — command parsing and help text
- `internal/manifest/` — manifest discovery, parsing, validation, and defaults
- `internal/services/` — child process orchestration, health checks, port resolution, and cleanup
- `internal/caddy/` — managed Caddy lifecycle, paths, config, and routing
- `internal/devtools/` — Go devtools control servers plus embedded browser assets
- `src/devtools/` — injected browser UI code
  - `src/devtools/features/` — feature-owned UI modules such as `minimap/` and `serviceStatusPanel/`
  - `src/devtools/shared/` — cross-feature theme, config, transport, and shared types

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Do not print successful Caddy reload chatter.
- Surface Caddy output only on failure.

## Devtools UI rules

For all injected UI work under `src/devtools/`, follow:

- `src/devtools/AGENTS.md`
- `docs/AGENTS.md`

Do not duplicate those rules here. Keep the devtools-specific styling and theming policy in the devtools-local AGENTS file.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.

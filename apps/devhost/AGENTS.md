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
- **CRITICAL:** `packages/docs/sync.ts` regenerates the public docs landing page from `README.md` and the manifest reference from `devhost.example.toml`. After editing either source, you **must** validate `packages/docs` so the GitHub Pages content stays in sync.
- Do not leave README or AGENTS examples/rules stale after changing implementation details.
- Repo-root `README.md` is a symlink to this workspace README; update `README.md` here, not the root symlink.

## Development workflow

Run the app directly:

```bash
go run ./cmd/devhost --help
```

Build a standalone executable for the current platform:

```bash
bun run compile:devhost
```

Refresh the generated embedded devtools bundle without building the binary:

```bash
bun run build:devtools-bundle:devhost
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

The human-only `fmt` script runs `oxfmt --write` for the repo using the shared root config. Agents should not run it directly; formatting is handled automatically by the repo's git hooks. `bun run check:devhost` refreshes the generated embedded devtools bundle, then runs `go vet ./...` and `go test ./...` from this app. The injected UI checks and Storybook coverage now live in `packages/devhost-ui/`. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

`scripts/buildDevtoolsBundle.ts` refreshes the generated injected devtools assets under `internal/devtools/dist/` used by Go `//go:embed`. That `dist/` directory is intentionally ignored; do not commit its generated `devtools.js` or `xterm.css` files.

To speed up frontend UI development, you can configure the on-demand asset dev loop by setting the `DEVHOST_DEV_ASSETS_DIR` environment variable to point to your compiled asset directory (e.g. `apps/devhost/internal/devtools/dist`). When configured, requesting `/__devhost__/inject.js` will automatically check if any source files under `packages/devhost-ui/src/devtools/` are newer than the compiled asset, serialize and trigger a background build via `bun run build:devtools-bundle:devhost`, and serve the fresh asset on demand. This allows you to simply reload your browser page to compile and view your UI changes on the fly. If file reads or compilation fail, the server gracefully falls back to serving the embedded assets.

`bun run build:release-artifacts:devhost` refreshes that bundle, cross-compiles the supported Go release targets, embeds the current `metadata.json` version into `devhost --version`, and writes versioned `.tar.gz` archives to `apps/devhost/dist/release/`.

`bun run compile:devhost` refreshes that bundle, embeds the current `metadata.json` version into `devhost --version`, then writes the current-platform executable to `apps/devhost/dist/devhost`.

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
- `internal/devtools/nvim/devhost-react-highlight.nvim/` — bundled Neovim plugin; follow its nested `AGENTS.md`
- `scripts/buildDevtoolsBundle.ts` — bundles `@alexgorbatchev/devhost-ui/main` into ignored `internal/devtools/dist/devtools.js` and copies `@xterm/xterm/css/xterm.css` to ignored `internal/devtools/dist/xterm.css` for `go:embed`

## Service supervision boundary

- Treat service cleanup as a generic containment contract with platform-specific backends; do not hardcode Linux-only assumptions into shared orchestration code.
- Linux may use stronger containment primitives (currently child-subreaper setup, descendant tracking, and short post-signal managed-port monitoring). macOS and other platforms are best-effort and may have weaker guarantees.
- Keep user-facing docs honest about those guarantee differences. Do not describe foreground-service shutdown as perfect or identical across platforms.
- Services that intentionally daemonize, detach, or escape the tracked foreground process tree are unsupported in foreground `command` mode unless there is an explicit cooperative lifecycle contract. Use daemon lifecycle mode for those services instead.
- Treat undocumented `DEVHOST_*` environment variables as internal implementation details. Do not document or rely on them as part of the public service contract unless they are intentionally promoted in `README.md` and covered by tests.

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Generated managed Caddyfiles must discard the default Caddy runtime logger so background Caddy stderr never leaks into default stack output.
- Do not print successful Caddy reload chatter during default `devhost` stack runs; only print it for `devhost --verbose` or explicit `devhost caddy ...` commands.
- Surface Caddy output on failure, and surface successful reload output only for `devhost --verbose` or explicit `devhost caddy ...` commands.

## Devtools UI boundary

- The injected UI source now lives in `packages/devhost-ui/`.
- For injected UI work, follow `packages/devhost-ui/AGENTS.md` plus the nested files under `packages/devhost-ui/src/devtools/`.
- Keep Go-side bundle generation and browser-side UI changes in sync when the embedding contract changes.

## Annotation action boundary

- Top-level `[agent]` manifest configuration is removed. Annotation submission must be configured through `[annotation]` and `[[annotation.actions]]` only.
- The annotation manifest supports exactly two action kinds: `agent` and `command`.
- Use `kind = "command"` for non-agent side effects such as creating Jira tickets, invoking a project-local CLI, or kicking off other local automation from an annotation.
- `devhost` does not ship built-in Jira or generic webhook adapters for annotation submission; integrations like ticket creation must be implemented by the configured command reading `DEVHOST_ANNOTATION_FILE` or `DEVHOST_ANNOTATION_PROMPT_FILE`.
- Durable annotation queues are supported for `agent` actions only. `command` actions always start standalone terminal sessions and do not participate in the queue.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.

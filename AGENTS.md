# localhost-domains

Monorepo root for the `devhost` Go app, the injected devtools UI package, and the public Astro docs site.

## Shared commands

- Install all workspaces when `node_modules/` is missing: `bun install`
- Ensure Playwright Chromium is available for Storybook workflows: `just ui install-browser`
- Check the full repo: `just check`
- Repo-wide formatting command: `just fix` (`oxfmt` for the repo, `gofmt -w` for `apps/devhost`)
- Refresh the generated embedded devtools bundle: `just devhost build-devtools-bundle`
- Check `devhost` app-only validations: `just devhost check`
- Run `devhost` from source in the current directory with agent-facing output: `just devhost run-ai <args>` (`just devhost run <args>` is the human-mode equivalent)
- Run `devhost` Go tests only: `just devhost test`
- Build `devhost` release tarballs: `just devhost build-release-artifacts`
- Build the current-platform `devhost` binary: `just devhost compile`
- Build and replace the `devhost` binary used by the `~/.dotfiles` shim, stamped `999.0.0-dev.<short git SHA>`: `just dev-bootstrap` (or `just dev-bootstrap /path/to/dotfiles`)
- Check the shared design tokens package: `just design check`
- Regenerate `packages/design/tokens.css` after editing `packages/design/src/constants.ts`: `just design write-tokens`
- Check the injected devtools UI package: `just ui check`
- Check the docs package-only validations: `just docs check`
- Run standalone React Highlight Neovim plugin tests: `just devhost test-nvim`
- Record the utility demo on Linux: `just demo record` (or `just demo record annotations` for one scene); follow `docs/internal/references/demo-recording.md` for prerequisites and refresh instructions.
- Run recording workflow unit tests: `just demo test` (also included in `just ui check`).
- Refresh all public guide demos: `just demo guides` (or `just demo guides annotations` for one guide). This updates tracked docs media and the guide's first video block; review before committing.
- Start the root devhost stack locally: `just dev`
- Start the docs site locally: `just docs` (or `just docs dev`)
- Open the injected devtools UI design reference (`packages/design/references/devtools.html`) in the default browser: `just design devtools`
- Open the docs site design reference (`packages/design/references/docs.html`) in the default browser: `just design docs`
- Open the general design reference document (`packages/design/references/design-system.html`) in the default browser: `just design system`

## Documentation policy

- `AGENTS.md`, deploy/release runbooks, and other contributor-facing docs must be kept up to date after workflow, policy, validation, or behavior changes.
- When shared validation commands, release or publish procedures, or contributor expectations change, update the affected docs in the same change, including `packages/docs/AGENTS.md` and `apps/devhost/RELEASE.md` when applicable.
- Root `README.md` is a symlink to `apps/devhost/README.md`. Update the app README, not the symlink.
- Public docs source content lives in `apps/devhost/README.md`, `apps/devhost/devhost.example.toml`, and `packages/docs/src/content/docs/**`; edit those sources instead of hand-editing generated docs outputs.
- Repository-local skills live under `.agents/skills/`. Put new local skills at `.agents/skills/<skill-name>/SKILL.md`.

## Workspace map

- `apps/devhost/` — Go CLI app; follow `apps/devhost/AGENTS.md`
- `packages/design/` — shared `--dh-*` design tokens and design references; follow `packages/design/AGENTS.md`
- `packages/devhost-ui/` — injected browser UI package; follow `packages/devhost-ui/AGENTS.md`
- `packages/docs/` — public Astro docs site; follow `packages/docs/AGENTS.md`

## Shared gotchas

- Root `package.json` owns the shared TypeScript AI policy tooling and the shared `oxfmt` / `oxlint` configs. Keep workspace-local copies out unless the workspaces genuinely diverge.
- Root `just check` runs `typescript-ai-policy check` first (wrapping the shared `oxfmt` / `oxlint` enforcement and excluding `packages/playground/**`), then delegates to package-specific checks.
- `packages/playground/**` is a local dev harness and is intentionally excluded from shared root lint/format enforcement.
- `packages/devhost-ui/scripts/demo/` owns the recording workflow and uses the real playground services through the managed Caddy on HTTPS port 443. Preserve portless public URLs, manifest-scoped route cleanup, and per-run artifacts under ignored `.tmp/demos/`. Stop owned processes on failure as well as success; leave the shared Caddy running. Concurrent recordings must use distinct `.localhost` hostnames.
- Recording annotations runs real Pi against a per-run playground copy. Restrict edits to its layout component, retain actual edits in `pi-changes.json`, and restore copied source during cleanup. Never reset checkout files to undo recording edits.
- Guide demo MP4/WebP/VTT files under `packages/docs/public/demos/` are published site assets and stay tracked. Runtime files stay in `.tmp/demos/`. Agent readers use guide prose/transcripts and HTTPS links instead of reading binary media as text. CI installs FFmpeg for native publication tests.
- Workspace `justfile` recipes are package-local validation only; do not duplicate shared lint/format enforcement there unless a workspace intentionally diverges.
- Invoke workspace recipes directly with `just <workspace> <recipe>`; keep root recipes for repository-wide work and do not add forwarding recipes.
- `just devhost check` refreshes the generated embedded devtools bundle, then runs `just devhost lint` (fails on any `gofmt -l` output, then `go vet ./...`, `go tool predeclared ./...`, and `go mod tidy -diff`) and the Bun script tests and `go test ./...` in `apps/devhost/`. Fix formatting failures with root `just fix`.
- `just ui check` runs the package TypeScript/unused-export checks, `bun test --coverage`, and `NODE_ENV=development bun vitest run -c vitest.storybook.config.ts` in `packages/devhost-ui/`. The command-scoped development runtime exercises native devtools event clients; Vitest otherwise defaults `NODE_ENV` to `test`. Vite `--mode` does not select `NODE_ENV`.
- `packages/design` is the single source of the devhost colors, radii, and host markers for the devtools UI, the docs site, and design references. Change values only in `packages/design/src/constants.ts` and regenerate `tokens.css`; its `just design check` fails while the committed file is stale.
- `just docs check` runs `bun test`, the content sync, `astro check`, and `astro build`.
- `just docs dev` (or `just docs`) binds Astro to `0.0.0.0` so the docs site can be reached from outside the current environment.
- `packages/docs` allows all dev/preview hosts in `astro.config.mjs`, so the docs server should be treated as broadly reachable while it is running.
- `just ui storybook` starts the interactive Storybook dev server for manual inspection; it does not replace the automated coverage already included in the workspace `check` recipe.
- `just devhost test-nvim` is intentionally standalone and not part of root `just check` or CI; use it when changing the Neovim React Highlight plugin under `apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/`.
- `apps/devhost/internal/devtools/dist/` contains the generated static entry, lazy chunks, fonts, terminal stylesheet, and gzip assets for Go `//go:embed` and is intentionally ignored; run `just devhost build-devtools-bundle`, `just devhost check`, or `just devhost compile` instead of committing those files. Instance configuration is served separately with `no-store`; production JavaScript and content-versioned assets use immutable caching.
- Root `postinstall` runs `just ui install-browser`, which uses `playwright install chromium` without `--force` so existing Chromium binaries are reused instead of being re-downloaded on every `bun install`.
- Keep a single root `bun.lock`. Do not add workspace-local lockfiles.
- Versioned dependency patches live in `patches/` and are registered by root `package.json` and `bun.lock`; `bun install` applies them. See `packages/devhost-ui/AGENTS.md` for the Jotai Storybook patch and its regression coverage.
- Browser contrast regressions share `test-support/readContrastRatio.ts`, which measures computed CSS colors and opacity using native canvas compositing. UI stories and docs style tests check minimum contrast ratios instead of fixed token values.

## Shipping

- Docs deploy entrypoint: push docs changes to `main` so `.github/workflows/docs.yml` publishes `packages/docs` to GitHub Pages.
- CLI release entrypoint: push a tag like `v0.0.2`. `apps/devhost/RELEASE.md` and `.github/workflows/publish.yml` are the authoritative GitHub Release binary procedure.

## File Conventions

- `docs/` — repository and internal-only documentation; follow `docs/AGENTS.md` and `docs/internal/AGENTS.md`

## Shared boundaries

- Always: run `just check` after changing workspace manifests, scripts, CI, or directory layout.
- Always: address all lint issues before the end of the turn.
- Always: when changing shared commands, validation flow, deploy flow, release flow, or contributor policy, update the affected `AGENTS.md` files and user/contributor docs in the same change.
- Always: design runtime state, ports, temporary files, browser control channels, editor/plugin integrations, and cleanup logic to support multiple `devhost` instances running concurrently for different projects.
- Done: only claim completion after required docs are updated, required checks for the affected scope pass, and any temporary servers or processes started for validation are stopped.
- Done: if a required step was skipped, a check failed, or a blocker remains, report the work as incomplete and name the exact gap.
- Always: when formatting is required, use the root `just fix` recipe instead of ad-hoc formatter invocations so shared ignore/config behavior stays consistent.
- Ask first: adding a new workspace, changing cross-workspace dependency topology, or changing the publish/release flow.
- Never: disable lint rules unless the user explicitly authorizes it.
- Never: add tests that only lock static CSS, class names, theme token values, or full stylesheet text (generated artifact freshness checks such as `packages/design/tokens.css` are permitted). Prefer behavior and integration contracts such as config registration, accessible state, or browser-visible interactions.
- Never: build or release `devhost` from the repo root using ad-hoc Go commands; use the documented `apps/devhost/justfile` recipes, root justfile recipes, and runbook.
- Never: start local docs or Storybook dev servers proactively; the user will start them when needed.
- Testing exception: agents may start temporary local servers for validation or recording workflows, but must shut them down before the end of the turn.

## References

- `docs/AGENTS.md`
- `docs/internal/AGENTS.md`
- `apps/devhost/AGENTS.md`
- `apps/devhost/RELEASE.md`
- `packages/devhost-ui/AGENTS.md`
- `packages/docs/AGENTS.md`
- `.github/workflows/docs.yml`
- `.agents/skills/`
- `oxfmt.config.ts`
- `oxlint.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

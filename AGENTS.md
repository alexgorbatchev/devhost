# localhost-domains

Monorepo root for the `devhost` Go app, the injected devtools UI package, and the public Astro docs site.

## Shared commands

- Install all workspaces when `node_modules/` is missing: `bun install`
- Ensure Playwright Chromium is available for Storybook workflows: `bun run install-browser`
- Check the full repo: `bun run check`
- Human-only repo-wide formatting command for explicit manual cleanup: `bun run fix`
- Refresh the generated embedded devtools bundle: `bun run build:devtools-bundle:devhost`
- Check `devhost` app-only validations: `bun run check:devhost`
- Build `devhost` release tarballs: `bun run build:release-artifacts:devhost`
- Build the current-platform `devhost` binary: `bun run compile:devhost`
- Check the injected devtools UI package: `bun run --cwd packages/devhost-ui check`
- Check the docs package-only validations: `bun run --cwd packages/docs check`
- Run standalone React Highlight Neovim plugin tests: `bun run test:nvim`
- Start the playground dev stack locally: `bun run dev`
- Start the docs site locally: `bun run docs`

## Documentation policy

- `AGENTS.md`, deploy/release runbooks, and other contributor-facing docs must be kept up to date after workflow, policy, validation, or behavior changes.
- When shared validation commands, release or publish procedures, or contributor expectations change, update the affected docs in the same change, including `packages/docs/AGENTS.md` and `apps/devhost/RELEASE.md` when applicable.
- Root `README.md` is a symlink to `apps/devhost/README.md`. Update the app README, not the symlink.
- Public docs source content lives in `apps/devhost/README.md`, `apps/devhost/devhost.example.toml`, and `packages/docs/src/content/docs/**`; edit those sources instead of hand-editing generated docs outputs.
- Repository-local skills live under `.agents/skills/`. Put new local skills at `.agents/skills/<skill-name>/SKILL.md`.

## Workspace map

- `apps/devhost/` — Go CLI app; follow `apps/devhost/AGENTS.md`
- `packages/devhost-ui/` — injected browser UI package; follow `packages/devhost-ui/AGENTS.md`
- `packages/docs/` — public Astro docs site; follow `packages/docs/AGENTS.md`

## Shared gotchas

- Root `package.json` owns the shared TypeScript AI policy tooling and the shared `oxfmt` / `oxlint` configs. Keep workspace-local copies out unless the workspaces genuinely diverge.
- Root `bun run check` runs `typescript-ai-policy check` first (wrapping the shared `oxfmt` / `oxlint` enforcement and excluding `packages/playground/**`), then delegates to package-specific checks.
- `packages/playground/**` is a local dev harness and is intentionally excluded from shared root lint/format enforcement.
- Workspace `check` scripts are package-local validation only; do not duplicate shared lint/format enforcement there unless a workspace intentionally diverges.
- `bun run check:devhost` refreshes the generated embedded devtools bundle, then runs `go vet ./...` and `go test ./...` in `apps/devhost/`.
- `packages/devhost-ui` `bun run check` runs the package TypeScript check, `bun test --coverage`, and `bun vitest run -c vitest.storybook.config.ts`.
- `packages/docs` `bun run check` runs `bun test`, the content sync, `astro check`, and `astro build`.
- `packages/docs` `bun run dev`, `bun run start`, and `bun run preview` bind Astro to `0.0.0.0` so the docs site can be reached from outside the current environment.
- `packages/docs` allows all dev/preview hosts in `astro.config.mjs`, so the docs server should be treated as broadly reachable while it is running.
- `bun run --cwd packages/devhost-ui storybook` starts the interactive Storybook dev server for manual inspection; it does not replace the automated coverage already included in the workspace `check` script.
- `bun run test:nvim` is intentionally standalone and not part of root `bun run check` or CI; use it when changing the Neovim React Highlight plugin under `apps/devhost/internal/devtools/nvim/devhost-react-highlight.nvim/`.
- `apps/devhost/internal/devtools/dist/` is generated for Go `//go:embed` and intentionally ignored; run `bun run build:devtools-bundle:devhost`, `bun run check:devhost`, or `bun run compile:devhost` instead of committing those files.
- Root `postinstall` runs `bun run install-browser`, which uses `playwright install chromium` without `--force` so existing Chromium binaries are reused instead of being re-downloaded on every `bun install`.
- Keep a single root `bun.lock`. Do not add workspace-local lockfiles.

## Shipping

- Docs deploy entrypoint: push docs changes to `main` so `.github/workflows/docs.yml` publishes `packages/docs` to GitHub Pages.
- CLI release entrypoint: push a tag like `v0.0.2`. `apps/devhost/RELEASE.md` and `.github/workflows/publish.yml` are the authoritative GitHub Release binary procedure.

## Shared boundaries

- Always: run `bun run check` after changing workspace manifests, scripts, CI, or directory layout.
- Always: address all lint issues before the end of the turn.
- Always: when changing shared commands, validation flow, deploy flow, release flow, or contributor policy, update the affected `AGENTS.md` files and user/contributor docs in the same change.
- Always: design runtime state, ports, temporary files, browser control channels, editor/plugin integrations, and cleanup logic to support multiple `devhost` instances running concurrently for different projects.
- Done: only claim completion after required docs are updated, required checks for the affected scope pass, and any temporary servers or processes started for validation are stopped.
- Done: if a required step was skipped, a check failed, or a blocker remains, report the work as incomplete and name the exact gap.
- Always: when formatting is required, use the root `bun run fix` script instead of ad-hoc formatter invocations so shared ignore/config behavior stays consistent.
- Ask first: adding a new workspace, changing cross-workspace dependency topology, or changing the publish/release flow.
- Never: disable lint rules unless the user explicitly authorizes it.
- Never: add tests that only lock static CSS, class names, theme token values, or full stylesheet text. Prefer behavior and integration contracts such as config registration, accessible state, or browser-visible interactions.
- Never: build or release `devhost` from the repo root using ad-hoc Go commands; use the documented `apps/devhost` scripts, root package scripts, and runbook.
- Never: start local docs or Storybook dev servers proactively; the user will start them when needed.
- Testing exception: agents may start temporary local servers for validation or recording workflows, but must shut them down before the end of the turn.

## References

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

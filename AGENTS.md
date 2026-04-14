# localhost-domains

Monorepo root for the published `devhost` package and the local demo app.

## Shared commands

- Install all workspaces when `node_modules/` is missing: `bun install`
- Check the full repo: `bun run check`
- Apply repo-wide formatting fixes: `bun run fix`
- Check `devhost` package-only validations: `bun run --cwd packages/devhost check`
- Check demo app package-only validations: `bun run --cwd packages/www check`
- Run `devhost` help: `bun run --cwd packages/devhost dev --help`
- Run demo app: `bun run dev`

## Workspace map

- `packages/devhost/` — published CLI package; follow `packages/devhost/AGENTS.md`
- `packages/www/` — local demo app; follow `packages/www/AGENTS.md`

## Shared gotchas

- Root `package.json` owns the shared TypeScript AI policy tooling and the shared `oxfmt` / `oxlint` configs. Keep workspace-local copies out unless the workspaces genuinely diverge.
- Root `bun run check` runs shared `oxfmt` / `oxlint` enforcement first, then delegates to package-specific checks.
- Workspace `check` scripts are package-local validation only; do not duplicate shared lint/format enforcement there unless a workspace intentionally diverges.
- Storybook is currently out-of-band from `bun run check`; run `bun run --cwd packages/devhost storybook` or `bun run --cwd packages/www storybook` manually when Storybook coverage is in scope.
- Keep a single root `bun.lock`. Do not add workspace-local lockfiles.
- Root `README.md` is a symlink to `packages/devhost/README.md`. Update the package README, not the symlink.

## Shared boundaries

- Always: run `bun run check` after changing workspace manifests, scripts, CI, or directory layout.
- Always: address all lint issues before the end of the turn.
- Never: Agents should NEVER run `bun run fix` or formatting tools directly. Formatting is handled automatically in the background via a pre-commit hook using nano-staged.
- Ask first: adding a new workspace, changing cross-workspace dependency topology, or changing the publish/release flow.
- Never: disable lint rules unless the user explicitly authorizes it.
- Never: publish or pack from the repo root; publish only from `packages/devhost/`.
- Never: start the demo dev server proactively; the user will start it when needed.
- Testing exception: agents may start the demo dev server temporarily for validation, but must shut it down before the end of the turn.

## References

- `packages/devhost/AGENTS.md`
- `packages/www/AGENTS.md`
- `oxfmt.config.ts`
- `oxlint.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

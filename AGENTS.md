# localhost-domains

Monorepo root for the published `devhost` package and the local demo app.

## Shared commands

- Install all workspaces when `node_modules/` is missing: `bun install`
- Check the full repo: `bun run check`
- Apply repo-wide formatting fixes: `bun run fix`
- Check `devhost` package-only validations: `bun run --cwd packages/devhost check`
- Check demo app package-only validations: `bun run --cwd packages/www check`
- Deploy demo app to Railway: `bun run deploy:www`
- Run `devhost` help: `bun run --cwd packages/devhost dev --help`
- Run demo app: `bun run dev`

## Documentation policy

- `AGENTS.md`, deploy/release runbooks, and other contributor-facing docs must be kept up to date after workflow, policy, validation, or behavior changes.
- When shared validation commands, deploy steps, release steps, or contributor expectations change, update the affected docs in the same change, including `packages/www/DEPLOY.md` and `packages/devhost/RELEASE.md` when applicable.
- Root `README.md` is a symlink to `packages/devhost/README.md`. Update the package README, not the symlink.
- Repository-local skills live under `.agents/skills/`. Put new local skills at `.agents/skills/<skill-name>/SKILL.md`.

## Workspace map

- `packages/devhost/` — published CLI package; follow `packages/devhost/AGENTS.md`
- `packages/www/` — local demo app; follow `packages/www/AGENTS.md`

## Shared gotchas

- Root `package.json` owns the shared TypeScript AI policy tooling and the shared `oxfmt` / `oxlint` configs. Keep workspace-local copies out unless the workspaces genuinely diverge.
- Root `bun run check` runs shared `oxfmt` / `oxlint` enforcement first, then delegates to package-specific checks.
- Workspace `check` scripts are package-local validation only; do not duplicate shared lint/format enforcement there unless a workspace intentionally diverges.
- `packages/devhost` `bun run check` runs the package TypeScript check, `bun test --coverage`, and `bun vitest run -c vitest.storybook.config.ts`.
- `packages/www` `bun run check` runs the package TypeScript check and `bun vitest run -c vitest.storybook.config.ts`.
- `bun run --cwd packages/devhost storybook` and `bun run --cwd packages/www storybook` start interactive Storybook dev servers for manual inspection; they do not replace the automated coverage already included in each workspace `check` script.
- Keep a single root `bun.lock`. Do not add workspace-local lockfiles.

## Shipping

- Demo app deploy entrypoint: `bun run deploy:www`. `packages/www/DEPLOY.md` is the authoritative Railway procedure.
- CLI release entrypoint: push a tag like `v0.0.2`. `packages/devhost/RELEASE.md` and `.github/workflows/publish.yml` are the authoritative npm release procedure.

## Shared boundaries

- Always: run `bun run check` after changing workspace manifests, scripts, CI, or directory layout.
- Always: address all lint issues before the end of the turn.
- Always: when changing shared commands, validation flow, deploy flow, release flow, or contributor policy, update the affected `AGENTS.md` files and user/contributor docs in the same change.
- Done: only claim completion after required docs are updated, required checks for the affected scope pass, and any temporary servers or processes started for validation are stopped.
- Done: if a required step was skipped, a check failed, or a blocker remains, report the work as incomplete and name the exact gap.
- Never: Agents should NEVER run `bun run fix` or formatting tools directly. Formatting is handled automatically in the background via a pre-commit hook using nano-staged.
- Ask first: adding a new workspace, changing cross-workspace dependency topology, or changing the publish/release flow.
- Never: disable lint rules unless the user explicitly authorizes it.
- Never: publish or pack from the repo root; publish only from `packages/devhost/`.
- Never: start the demo dev server proactively; the user will start it when needed.
- Testing exception: agents may start the demo dev server temporarily for validation, but must shut it down before the end of the turn.

## References

- `packages/devhost/AGENTS.md`
- `packages/devhost/RELEASE.md`
- `packages/www/AGENTS.md`
- `packages/www/DEPLOY.md`
- `.agents/skills/`
- `oxfmt.config.ts`
- `oxlint.config.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

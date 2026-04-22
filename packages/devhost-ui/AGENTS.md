# devhost UI package

Local React workspace for the injected `devhost` browser UI that gets embedded into routed pages and exercised through Storybook.

## Commands

- Check package-local validations: `bun run --cwd packages/devhost-ui check`
- Storybook: `bun run --cwd packages/devhost-ui storybook`

## Local conventions

- Keep the injected UI source under `src/devtools/` so the Go app and the public website can both consume the same entrypoint.
- Re-export public entrypoints through `package.json` exports. Consumers should use `@alexgorbatchev/devhost-ui` or `@alexgorbatchev/devhost-ui/main` instead of reaching into source paths.
- Keep package-owned Storybook and browser tests inside this workspace.

## Local gotchas

- This package is the source of truth for the injected browser UI, but the shipped bundle is still embedded by the Go app in `apps/devhost/`; update both sides together when the bundling contract changes.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` script.
- For styling, theme, and feature-layout rules under `src/devtools/`, follow `src/devtools/AGENTS.md` and `src/devtools/features/AGENTS.md`.

## Boundaries

- Always: update the Go-side bundle build in `apps/devhost/` when the devtools entrypoint, generated asset contract, or package export shape changes.
- Ask first: publishing this package outside the monorepo or changing its package name.
- Never: make consumers import `src/devtools/*` directly when a package export can express the boundary.

## References

- `package.json`
- `src/devtools/AGENTS.md`
- `src/devtools/features/AGENTS.md`
- `apps/devhost/scripts/buildDevtoolsBundle.ts`

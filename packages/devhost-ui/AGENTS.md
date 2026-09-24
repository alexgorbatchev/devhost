# devhost UI package

Local React workspace for the injected `devhost` browser UI that gets embedded into routed pages and exercised through Storybook.

## Commands

- Check package-local validations: `just ui check`
- Storybook: `just ui storybook` (or `just storybook`)
- Open the design reference in the default browser (from the repo root): `just design`

## Local conventions

- Keep the injected UI source under `src/devtools/` so the Go app and the public website can both consume the same entrypoint.
- Re-export public entrypoints through `package.json` exports. Consumers should use `@alexgorbatchev/devhost-ui` or `@alexgorbatchev/devhost-ui/main` instead of reaching into source paths.
- Keep package-owned Storybook and browser tests inside this workspace.
- `../design/references/devtools.html` (`just design`) is the visual design reference for the injected UI: a standalone page that mounts every devtools surface in a Shadow DOM over switchable host backgrounds. Match its tokens, layout, and state treatments when changing devtools components, and update it in the same change when the design intentionally diverges.

## Local gotchas

- This package is the source of truth for the injected browser UI, but the Go app embeds a generated bundle from `apps/devhost/internal/devtools/dist/`. That directory is ignored; run `just build-devtools-bundle`, `just devhost check`, or `just compile` instead of committing generated bundle files.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` recipe.
- For styling, theme, and feature-layout rules under `src/devtools/`, follow `src/devtools/AGENTS.md` and `src/devtools/features/AGENTS.md`.

## Boundaries

- Always: update the Go-side bundle build in `apps/devhost/` when the devtools entrypoint, generated asset contract, or package export shape changes.
- Ask first: publishing this package outside the monorepo or changing its package name.
- Never: make consumers import `src/devtools/*` directly when a package export can express the boundary.

## References

- `package.json`
- `../design/references/devtools.html`
- `src/devtools/AGENTS.md`
- `src/devtools/features/AGENTS.md`
- `apps/devhost/scripts/buildDevtoolsBundle.ts`

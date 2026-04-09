# devhost demo app

Local React demo app for exercising `@alexgorbatchev/devhost` behavior and Storybook coverage.

## Commands

- Dev server: `bun run dev`
- Check package-local validations: `bun run check`
- Storybook: `bun run storybook`

## Local conventions

- Keep the `@alexgorbatchev/devhost` dependency on `workspace:*`; both packages now live under the same Bun workspace.
- Keep package-owned tests, stories, and demo scripts inside this workspace; do not reach back into `packages/devhost/` for local config files.

## Local gotchas

- This workspace uses the repo-root `bun.lock`. Do not add a package-local lockfile.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` script.
- `bun run check` currently runs the package TypeScript validation only. Run `bun run storybook` separately when Storybook coverage is in scope.
- The demo app is React-based, while `packages/devhost/` devtools UI is Preact-based. Do not copy JSX/runtime assumptions across workspaces without checking the local package config.

## Boundaries

- Always: after updating the main `devhost` README, sync the core prose, API documentation, and layout to `packages/www/src/app/App.tsx`. The marketing website is essentially an interactive clone of the README.
- Ask first: changing the demo app package name or turning it into a published package.
- Never: replace the workspace dependency with `file:` or registry versions while both packages live in this repo.

## References

- `package.json`
- `scripts/check.sh`
- `.storybook/`
- `src/server.ts`
- `DEPLOY.md`

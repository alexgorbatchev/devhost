# devhost demo app

Local React demo app for exercising `@alexgorbatchev/devhost` behavior and Storybook coverage.

## Commands
- Dev server: `bun run dev`
- Check package: `bun run check`
- Storybook: `bun run storybook`

## Local conventions
- Keep the `@alexgorbatchev/devhost` dependency on `workspace:*`; both packages now live under the same Bun workspace.
- Keep package-owned tests, stories, and demo scripts inside this workspace; do not reach back into `packages/devhost/` for local config files.

## Local gotchas
- This workspace uses the repo-root `bun.lock`. Do not add a package-local lockfile.
- The demo app is React-based, while `packages/devhost/` devtools UI is Preact-based. Do not copy JSX/runtime assumptions across workspaces without checking the local package config.

## Boundaries
- Ask first: changing the demo app package name or turning it into a published package.
- Never: replace the workspace dependency with `file:` or registry versions while both packages live in this repo.

## References
- `package.json`
- `scripts/check.sh`
- `.storybook/`
- `railway.toml`
- `src/server.ts`
- `DEPLOY.md`

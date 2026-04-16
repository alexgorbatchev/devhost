# devhost demo app

Local React demo app for exercising `@alexgorbatchev/devhost` behavior and Storybook coverage.

## Documentation policy

- `AGENTS.md` and `DEPLOY.md` must be kept up to date after workflow, deploy, build/start, or contributor-expectation changes.
- If Railway target IDs, required environment variables, build/start commands, verification steps, or the `bun run deploy:www` flow change, update `DEPLOY.md` in the same change.
- If repo-wide validation or shared contributor workflow changes from this workspace, also update the repo-root `AGENTS.md`.

## Commands

- Dev server: `bun run dev`
- Check package-local validations: `bun run check`
- Record marketing replays: `bun run record:marketing`
- Install Playwright Chromium for the recorder: `bun run record:marketing:install-browser`
- Storybook: `bun run storybook`
- Preferred Railway deploy entrypoint from the repo root: `bun run deploy:www`

## Local conventions

- Keep the `@alexgorbatchev/devhost` dependency on `workspace:*`; both packages now live under the same Bun workspace.
- Keep package-owned tests, stories, and demo scripts inside this workspace; do not reach back into `packages/devhost/` for local config files.

## Local gotchas

- This workspace uses the repo-root `bun.lock`. Do not add a package-local lockfile.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` script.
- `bun run check` runs the package TypeScript validation and Storybook/Vitest browser coverage for this workspace.
- The demo app and `packages/devhost/` devtools UI both use React, but their runtime and build constraints still differ. Check the local package config before copying assumptions across workspaces.
- `bun run record:marketing` starts a temporary local dev server, opens the dev-only `marketing-capture.html` route, and rewrites `public/recordings/marketing/*.json` from deterministic rrweb captures.

## Boundaries

- Always: after updating the main `devhost` README, sync the core prose, API documentation, and layout to `packages/www/src/app/App.tsx`. The marketing website is essentially an interactive clone of the README.
- Always: follow `DEPLOY.md` for Railway deploys. `bun run deploy:www` is the preferred entrypoint, and `DEPLOY.md` is the authoritative preflight and verification runbook.
- Done: only claim demo app work complete after required docs are updated, required checks for the affected scope pass, and any requested deploy verifies successfully per `DEPLOY.md`.
- Done: if validation, deploy verification, or required documentation updates were skipped, failed, or remain blocked, report the work as incomplete and state why.
- Ask first: changing the demo app package name or turning it into a published package.
- Never: replace the workspace dependency with `file:` or registry versions while both packages live in this repo.

## References

- `package.json`
- `marketing-capture.html`
- `scripts/check.sh`
- `scripts/recordMarketingDemos.ts`
- `.storybook/`
- `src/server.ts`
- `DEPLOY.md`

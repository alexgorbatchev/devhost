# devhost UI package

Local React workspace for the injected `devhost` browser UI that gets embedded into routed pages and exercised through Storybook.

## Commands

- Check package-local validations: `just ui check`
- Storybook: `just ui storybook`
- Open the design reference in the default browser (from the repo root): `just design devtools`

## Local conventions

- Keep the injected UI source under `src/devtools/` so the Go app and the public website can both consume the same entrypoint.
- Re-export public entrypoints through `package.json` exports. Consumers should use `@alexgorbatchev/devhost-ui` or `@alexgorbatchev/devhost-ui/main` instead of reaching into source paths.
- Keep package-owned Storybook and browser tests inside this workspace.
- `../design/references/devtools.html` (`just design devtools`) is the visual design reference for the injected UI: a standalone page that mounts every devtools surface in a Shadow DOM over switchable host backgrounds. Match its tokens, layout, and state treatments when changing devtools components, and update it in the same change when the design intentionally diverges.

## Local gotchas

- This package is the source of truth for the injected browser UI, but the Go app embeds a generated bundle from `apps/devhost/internal/devtools/dist/`. That directory is ignored; run `just devhost build-devtools-bundle`, `just devhost check`, or `just devhost compile` instead of committing generated bundle files.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` recipe.
- `just ui check` runs its browser suite with `NODE_ENV=development bun vitest run -c vitest.storybook.config.ts`. Native TanStack event clients and panels intentionally become no-ops under Vitest's default `NODE_ENV=test`; Vite's mode is separate. Preserve the command-scoped environment for targeted browser runs from this package, while Bun unit tests keep their usual runtime.
- For styling, theme, and feature-layout rules under `src/devtools/`, follow `src/devtools/AGENTS.md` and `src/devtools/features/AGENTS.md`.
- Storybook's `preview.beforeAll` configures a shared five-second failure budget for Testing Library async queries and assertions. Native panels lazy-load while stories run in parallel; wait for observable readiness and popover visibility without sleeps, retries, or per-story timeout overrides.
- Bun unit tests have no DOM. A hook test renders through React Testing Library on happy-dom: its sibling `__tests__/helpers.ts` registers the DOM globals when it loads, so the test file imports `./helpers` before `@testing-library/react` and unregisters them in `afterAll`.
- Devtools control requests use no authentication token. Preserve session IDs and instance routing when changing HTTP/WebSocket clients.
- The browser entry awaits uncached `/__devhost__/config.json` before rendering. Keep instance data out of the static bundle. Terminal constructors load through dynamic imports only when a session panel mounts; cancellation must prevent late initialization after unmount. Production JavaScript, hashed chunks/fonts, and versioned terminal styles use one-year immutable caching; source-mode entry scripts use `no-store`.
- Native Vue regressions start genuine Vue DevTools 9.0.0-beta.1/Vite 8.3.3 hosts and owned Chromium profiles. Their exact dependencies, lockfile, ports, and runtime artifacts stay under ignored `.tmp/vue-native-host/`; repository Vite remains 7.3.1. Each run owns its Vite dependency cache under `runs/<uuid>/.vite`: the default cache beside the shared dependency installation lets independent hosts replace each other's optimized modules and stall authorization. Run them through normal `just ui check` and stop all owned resources. Preserve the real authorization flow and host APIs; a simulated context cannot verify this integration.

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

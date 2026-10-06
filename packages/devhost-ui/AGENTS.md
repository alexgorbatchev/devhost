# devhost UI package

Local React workspace for the injected `devhost` browser UI that gets embedded into routed pages and exercised through Storybook.

## Commands

- Check package-local validations: `just ui check`
- Storybook: `just ui storybook`
- Record the real utility demo: `just demo record`; recording tests: `just demo test`. See `../../docs/internal/references/demo-recording.md` for prerequisites, scene refreshes, and artifact locations.
- Refresh every public guide video: `just demo guides` (or `just demo guides <guide-slug>`). Publication tests require FFmpeg/ffprobe; full rendering also needs VHS/ttyd. Docker and React Highlight guides need real Docker and Neovim/TSX Tree-sitter.
- Open the design reference in the default browser (from the repo root): `just design devtools`

## Local conventions

- Keep the injected UI source under `src/devtools/` so the Go app and the public website can both consume the same entrypoint.
- Re-export public entrypoints through `package.json` exports. Consumers should use `@alexgorbatchev/devhost-ui` or `@alexgorbatchev/devhost-ui/main` instead of reaching into source paths.
- Keep package-owned Storybook and browser tests inside this workspace.
- Keep repeatable recording scenes under `scripts/demo/`. Capture real playground interactions through the compiled devhost, with accessible locators and observable readiness checks. Fixed pauses are allowed only for viewer pacing in recordings. The package TypeScript and Bun checks include these scripts and their unit tests.
- Record portless HTTPS URLs through the existing managed Caddy on port 443. Inherit the devhost state directory, remove only the recording manifest's routes, and leave Caddy running. Use distinct hostnames for concurrent recordings.
- Annotation recordings use real Pi and HMR against a copied playground under the recording directory. Keep its edit guard and restoration; never edit or reset the checkout's playground for recordings. Request reduced motion to freeze the playground background and logo. Use recording click rings without action text labels.
- Keep the browser sequence minimap → toolbar/worktrees → annotation/Pi/live fix → TanStack Query → minimize Query and end. Worktrees belong to the copied Git fixture. Change captions on observed Pi working and heading-update events, using native video segments and measured durations rather than guessed timestamps.
- Load the playground and wait for UI/fonts before starting capture. Reuse that page across browser scenes, preserve its live state, and reject full-page navigations during capture. Keep real HMR and client-side Query navigation visible.
- Guide recordings exercise real CLI routing, dependency injection, manifest includes/reload, Docker, daemon lifecycle, and the bundled Neovim plugin. Keep the shared-listener guide on its own Caddy state/admin/ports and stop that instance after recording; leave the user's shared Caddy running. Publish only MP4/poster/captions and human-readable transcript blocks, with complete HTTPS docs asset URLs.
- `../design/references/devtools.html` (`just design devtools`) is the visual design reference for the injected UI: a standalone page that mounts every devtools surface in a Shadow DOM over switchable host backgrounds. Match its tokens, layout, and state treatments when changing devtools components, and update it in the same change when the design intentionally diverges.

## Local gotchas

- This package is the source of truth for the injected browser UI, but the Go app embeds a generated bundle from `apps/devhost/internal/devtools/dist/`. That directory is ignored; run `just devhost build-devtools-bundle`, `just devhost check`, or `just devhost compile` instead of committing generated bundle files.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` recipe.
- `just ui check` runs its browser suite with `NODE_ENV=development bun vitest run -c vitest.storybook.config.ts`. Native TanStack event clients and panels intentionally become no-ops under Vitest's default `NODE_ENV=test`; Vite's mode is separate. Preserve the command-scoped environment for targeted browser runs from this package, while Bun unit tests keep their usual runtime.
- Root `patches/jotai-devtools@0.14.0.patch` removes only the dependency's unconditional tree-shaking deprecation notice from both published module builds; native rendering and production guards remain intact. The [upstream discussion](https://github.com/jotaijs/jotai-devtools/discussions/188) confirms that the notice also fires with the recommended integration. Jotai is a Storybook-only host fixture. `.storybook/vitest.setup.ts` forwards warnings and fails on this notice; the real Jotai stories cover store updates, history, multiple stores, and inspector lifecycle. Recheck the patch when changing this dependency and remove it when upstream stops emitting the notice.
- Vitest's browser server uses its own Vite 8/Rolldown dependency, while the workspace declares Vite 7.3.1. `vitest.storybook.config.ts` groups the complete native `@tanstack/query-devtools`, `@tanstack/router-devtools-core`, `@tanstack/table-devtools`, and `@tanstack/devtools-utils` packages separately in its optimizer output so rendering and mounting code arrive with their public entries before interaction or mount. The shared utility matcher includes the reachable 0.4.0 and 0.7.0 versions used by Form, Table and Pacer; preserve their native lazy mounting, abort and disposal behavior. Preserve `strictExecutionOrder` for native module initialization and the original browser assertions and lookup budgets; do not replace this with warmed stories, private imports or longer waits. This optimizer setting applies to automated browser checks, not the standalone Storybook server or shipped Go bundle.
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

# localhost-domains

Monorepo root for the `devhost` Go app, the injected devtools UI package, and the public Astro docs site.

## Shared commands

- Install all workspaces when `node_modules/` is missing: `bun install`
- Ensure Playwright Chromium is available for Storybook workflows: `just ui install-browser`
- Check the full repo: `just check`
- Prepare the workspace dependencies and embedded bundle: `just setup`
- Repo-wide formatting command: `just fix` (`oxfmt` for the repo, `gofmt -w` for `apps/devhost`)
- Refresh the generated embedded devtools bundle and standalone page scripts and stylesheets: `just devhost build-devtools-bundle`
- Check `devhost` app-only validations: `just devhost check`
- Run `devhost` from source in the current directory with agent-facing output: `just run-ai <args>` (`just cli <args>` is the human-mode equivalent); they forward to `devhost run-ai` and `devhost run`, respectively
- Run every workspace test suite: `just test`
- Run `devhost` Go tests only: `just devhost test`
- Build `devhost` release tarballs: `just devhost build-release-artifacts`
- Build the current-platform `devhost` binary: `just devhost compile`
- Build and replace the `devhost` binary used by the `~/.dotfiles` shim, stamped `999.0.0-dev.<short git SHA>` and with this checkout as its source, so it serves the devtools UI from the checkout and chat can target it: `just dev-bootstrap` (or `just dev-bootstrap /path/to/dotfiles`)
- Check the shared design tokens package: `just design check`
- Regenerate `packages/design/tokens.css` after editing `packages/design/src/constants.ts`: `just design write-tokens`
- Check the injected devtools UI package: `just ui check`
- Check the docs package-only validations: `just docs check`
- Run native React acceptance from the repository root on macOS or Linux x64: `just ui test-native-react` (it downloads the current Chrome for Testing and React Developer Tools; see `packages/devhost-ui/AGENTS.md` for its coverage)
- Record the real scenes and render the promo on Linux or macOS (publish media recorded on Linux): `DEVHOST_DEMO_INTERACTIVE=1 just demo record` (or append `annotations` for one captioned scene). Annotation recording needs a graphical browser and an operator for native tab sharing and agent approvals; follow `docs/internal/references/demo-recording.md` for narration refresh and other prerequisites.
- Render the promo again from an earlier recording's footage: `just demo promo` (or `just demo promo .tmp/demos/recording-AbC123`). Every promo render also writes the docs landing page's copy: `packages/docs/public/demos/promo.{mp4,webp,vtt}` and `packages/docs/src/promoDemo.html`; review before publishing and committing.
- Regenerate the promo's ElevenLabs narration, its only sound: `just demo audio`. This needs `ELEVENLABS_API_KEY` and bills that account.
- Run recording workflow unit tests: `just demo test` (also included in `just ui check`).
- Refresh all public guide demos: `just demo guides` (or `just demo guides annotations` for one guide). This records each guide, renders its narrated film, and updates the docs media and the guide's first video block; review before publishing and committing.
- Render one guide's film again from its latest recording: `just demo guide-film <guide-slug>`.
- Generate the guide films' ElevenLabs narration: `just demo audio-guides` (or `just demo audio-guides <guide-slug>`). A line whose request is unchanged keeps its take; append `retake` after the guide to speak the selected lines again. This needs `ELEVENLABS_API_KEY` and bills that account.
- Download the pinned guide videos a checkout lacks: `just docs media` (`just docs run`, `test`, and `build` run it first).
- Upload reviewed guide videos to the `media` release and pin them: `just docs publish-media`. This needs the GitHub CLI signed in with write access; commit the rewritten `packages/docs/demo-media.json`.
- Start the root devhost stack locally: `just run`
- View contributor architecture diagrams at `https://devhost-archify.localhost/` while the stack runs (`DEVHOST_DEV_EXT` supplies the shared suffix override). Regenerate them with `ARCHIFY_CLI=/path/to/archify/bin/archify.mjs just archify build`; see `docs/internal/architecture/index.md` for browser prerequisites and maintenance.
- Preview standalone 404, recovery, error, directory, and Markdown pages while that stack runs: open `/__devhost__/pages/` on a root-routed development domain. The gallery requires a source checkout: the one a development build records, which `just run` uses, or `DEVHOST_DEV_SOURCE_DIR`.
- Start the dedicated Chrome for Testing with React Developer Tools that native React DevTools attaches to: `just dev-browser` (or `just dev-browser <port>`); set `DEVHOST_BROWSER_ENDPOINT` in `.envrc.local` to its endpoint, such as `http://127.0.0.1:9222`, and restart `just run`
- Preview startup timeout and recovery pages: `just devhost demo-recovery`; configure the shared `DEVHOST_DEV_EXT` suffix through `.envrc.local` (the tracked `.envrc` defaults to `.localhost`) and reload direnv.
- Start the docs site locally: `just docs` (or `just docs run`)
- Open the injected devtools UI design reference (`packages/design/references/devtools.html`) in the default browser: `just design devtools`
- Open the docs site design reference (`packages/design/references/docs.html`) in the default browser: `just design docs`
- Open the general design reference document (`packages/design/references/design-system.html`) in the default browser: `just design system`

## Documentation policy

- `AGENTS.md`, deploy/release runbooks, and other contributor-facing docs must be kept up to date after workflow, policy, validation, or behavior changes.
- When shared validation commands, release or publish procedures, or contributor expectations change, update the affected docs in the same change, including `packages/docs/AGENTS.md` and `apps/devhost/RELEASE.md` when applicable.
- The public docs under `packages/docs/src/content/docs/` must always be kept up to date: document every user-visible feature and behavior change there, however small, in the same change.
- After every behavior change, review the docs and `README.md` for statements the change made inaccurate, and correct each one.
- When a change adds or alters a user-visible feature, update its row in the "Demo coverage" table of `docs/internal/references/demo-recording.md` in the same change: the film and clips that show it, or **No demo**. The `demo-update` skill in `.agents/skills/` covers changing a film.
- `README.md` is an overview, not a feature list. Ask the user before adding a new feature, section, or option to it; correcting or removing existing README text needs no approval. `apps/devhost/AGENTS.md` has the full policy.
- Root `README.md` is a symlink to `apps/devhost/README.md`. Update the app README, not the symlink.
- Public docs source content lives in `apps/devhost/README.md`, `apps/devhost/devhost.example.toml`, and `packages/docs/src/content/docs/**`; edit those sources instead of hand-editing generated docs outputs.
- Repository-local skills live under `.agents/skills/`. Put new local skills at `.agents/skills/<skill-name>/SKILL.md`.

## Workspace map

- `apps/devhost/` — Go CLI app; follow `apps/devhost/AGENTS.md`
- `packages/design/` — shared `--dh-*` design tokens and design references; follow `packages/design/AGENTS.md`
- `packages/devhost-ui/` — injected browser UI package; follow `packages/devhost-ui/AGENTS.md`
- `packages/docs/` — public Astro docs site; follow `packages/docs/AGENTS.md`

## Shared gotchas

- The development manifests compose service hostnames with `DEVHOST_DEV_EXT`. Root `.envrc` exports defaults, then loads ignored `.envrc.local` shell customizations with `source_env_if_exists`; use `export` assignments there to override the defaults. Reload direnv after editing these files. Devhost itself reads the exported environment and does not load dotenv files.

- Root `package.json` owns the shared TypeScript AI policy tooling and the shared `oxfmt` / `oxlint` configs. Keep workspace-local copies out unless the workspaces genuinely diverge.
- Root `just check` runs `typescript-ai-policy check` first (wrapping the shared `oxfmt` / `oxlint` enforcement and excluding `packages/playground/**`), then delegates to package-specific checks.
- `packages/playground/**` is a local dev harness and is intentionally excluded from shared root lint/format enforcement. Its two apps keep their own `justfile`, which the root links as `playground-backend` and `playground-frontend` (`just playground-backend run`); the stack starts them through `just run`. Its frontend tests are enforced all the same: `just playground-frontend check` runs them, and root `just check` and `just test` include it, because that server decides which files under a run directory it serves.
- The root `justfile` links every nested `justfile` with a `mod` line. Add one in the same change as a new `justfile`.
- The `archify` service in the root manifest starts with every service selection and serves committed contributor diagrams from `docs/internal/architecture/` through a loopback Bun server. Its server and behavioral tests live in `packages/devhost-ui/scripts/architecture/` and are included in `just ui check`. Keep JSON specifications, generated HTML, the diagram index, and `just archify build` synchronized; generated HTML is excluded from formatting to preserve Archify provenance. Verification receipts and `.archify/` scratch output stay ignored.
- `packages/devhost-ui/scripts/demo/` owns the recording workflow and uses the real playground services through the managed Caddy on HTTPS port 443. Preserve portless public URLs, manifest-scoped route cleanup, and per-run artifacts under ignored `.tmp/demos/`. Stop owned processes on failure as well as success; leave the shared Caddy running. Concurrent recordings must use distinct `.localhost` hostnames.
- `packages/devhost-ui/scripts/demo/promo/` is the promo's HyperFrames project. Its `package.json` pins the HyperFrames release and is not a workspace; keep it out of the root `workspaces` list. The ElevenLabs narration under `promo/assets/audio/` is tracked, so a render needs no key. Footage, fonts, GSAP, and the design tokens are staged into each run's copy under `.tmp/demos/` and are never committed.
- `packages/devhost-ui/scripts/demo/guide/` holds the one HyperFrames template every guide film is rendered from, the narration of all guides in `narration.json`, and their tracked ElevenLabs audio under `assets/audio/`. It has no `package.json`: a render uses the release `promo/package.json` pins. A guide's narration needs one line per recorded clip, so change a guide's steps, its lines, and its audio together.
- Recording changes stay inside a per-run playground copy. Restrict edits to the owned scene fixture, retain actual edits in run artifacts, and restore copied source during cleanup. Never reset checkout files to undo recording edits.
- Guide demo WebP posters and VTT captions under `packages/docs/public/demos/` are published site assets and stay tracked. The promo's poster and captions there, and its landing-page block `packages/docs/src/promoDemo.html`, are tracked the same way. Guide videos and the promo's video are never committed: `packages/docs/demo-media.json` pins each by SHA-256, the files are assets of the `media` GitHub release, and that directory's `*.mp4` files are ignored. The `media` release is not a devhost version; keep it out of "Latest" and never give it a `v` tag, which would start the binary release workflow. Runtime files stay in `.tmp/demos/`. Agent readers use guide prose and HTTPS links instead of reading binary media as text. CI installs FFmpeg for native publication tests.
- Workspace `justfile` recipes are package-local validation only; do not duplicate shared lint/format enforcement there unless a workspace intentionally diverges.
- The root `justfile` uses `run` for the development stack, `cli` and `run-ai` for the human and agent CLI entrypoints, and `test` for the `test` recipes of the `devhost`, `design`, `ui`, `docs`, and `playground-frontend` workspaces. Invoke other workspace recipes directly with `just <workspace> <recipe>`; keep the remaining root recipes for repository-wide work and do not add further forwarding recipes.
- `just devhost check` refreshes the generated embedded devtools bundle, then runs `just devhost lint` (fails on any `gofmt -l` output, then `go vet ./...`, `go tool predeclared ./...`, `go tool logpolicy ./...`, and `go mod tidy -diff`) and the Bun script tests and `go test -count=1 ./...` in `apps/devhost/`. Go tests run afresh because their live-process integration checks observe volatile kernel state; retain `-count=1` to prevent expensive validation of Linux `/proc` test-cache inputs. The Go build cache remains enabled. Fix formatting failures with root `just fix`.
- `just ui check` runs the package TypeScript/unused-export checks, then `just ui test`: three test runs in `packages/devhost-ui/`, each with coverage: `bun test`, the hook and `*.browser.test.ts` tests (`bun vitest run -c vitest.browser.config.ts`), and the stories (`NODE_ENV=development bun vitest run -c vitest.storybook.config.ts`). It then merges their reports into one line-coverage table and fails below the floor set in the package `justfile` (`just ui coverage`). The command-scoped development runtime exercises native devtools event clients; Vitest otherwise defaults `NODE_ENV` to `test`. Vite `--mode` does not select `NODE_ENV`.
- `packages/design` is the single source of the devhost colors, radii, and host markers for the devtools UI, the docs site, and design references. Change values only in `packages/design/src/constants.ts` and regenerate `tokens.css`; its `just design check` fails while the committed file is stale.
- `just docs check` downloads the pinned guide videos, then runs `bun test`, the content sync, the check that the videos on disk are the pinned ones, `astro check`, and `astro build`.
- `just docs run` (or `just docs`) binds Astro to `0.0.0.0` so the docs site can be reached from outside the current environment.
- `packages/docs` allows all dev/preview hosts in `astro.config.mjs`, so the docs server should be treated as broadly reachable while it is running.
- `just ui storybook` starts the interactive Storybook dev server for manual inspection; it does not replace the automated coverage already included in the workspace `check` recipe.
- `apps/devhost/internal/devtools/dist/` contains the generated static entry, lazy chunks, fonts, and gzip assets for Go `//go:embed` and is intentionally ignored; run `just devhost build-devtools-bundle`, `just devhost check`, or `just devhost compile` instead of committing those files. Instance configuration is served separately with `no-store`; production JavaScript and content-versioned assets use immutable caching.
- Root `postinstall` runs `just ui install-browser`, which uses `playwright install chromium` without `--force` so existing Chromium binaries are reused instead of being re-downloaded on every `bun install`.
- Keep a single root `bun.lock`. Do not add workspace-local lockfiles.
- Versioned dependency patches live in `patches/` and are registered by root `package.json` and `bun.lock`; `bun install` applies them. See `packages/devhost-ui/AGENTS.md` for the Jotai Storybook patch and its regression coverage.
- Root `package.json` `packageManager` names the Bun version. The CI, docs, and publish workflows read it through `bun-version-file: package.json`; change the version there and nowhere else.
- Browser contrast regressions share `test-support/readContrastRatio.ts`, which measures computed CSS colors and opacity using native canvas compositing. UI stories and docs style tests check minimum contrast ratios instead of fixed token values.

## Shipping

- CI: `.github/workflows/ci.yml` runs `just check` on every push to `main` and on pull requests. Its Linux test tools include FFmpeg, unzip, and Xvfb for native media, archive, and headed recording regressions. A second job runs `just devhost check` on macOS and reports without failing the workflow until it passes reliably.
- Docs deploy entrypoint: a CLI release. After the release exists, `.github/workflows/publish.yml` calls `.github/workflows/docs.yml`, which builds `packages/docs` from the release tag and publishes it to GitHub Pages. A push to `main` does not deploy, so the published docs describe the released version. A docs correction is published with the next release. The `github-pages` environment accepts deployments only from `main` and from `v*` tags, so a run of the `Deploy docs to GitHub Pages` workflow by hand can redeploy a release tag unchanged or deploy `main`, which also publishes the unreleased documentation `main` holds; it cannot deploy a correction branch.
- CLI release entrypoint: push a tag like `v0.0.2`. `apps/devhost/RELEASE.md` and `.github/workflows/publish.yml` are the authoritative GitHub Release binary procedure.

## File Conventions

- `docs/` — repository and internal-only documentation; follow `docs/AGENTS.md` and `docs/internal/AGENTS.md`

## Shared boundaries

- Always: run `just check` after changing workspace manifests, scripts, CI, or directory layout.
- Always: address all lint issues before the end of the turn.
- Always: resolve every finding of the unused-code report (`ts-unused`, run by `just ui check`) in the same change, including `[INFO]` findings such as "Used only in tests". Those findings do not fail the check, so read its output. No finding stays in place, and none is reported as unresolvable. Delete dead code end to end, including data a server sends that nothing reads; move a declaration that only tests use into those tests; move a type that only tests and their fixtures use into the sibling `__tests__/helpers.ts`, which fixtures import, since lint keeps types out of fixture files; and write out a real use the analyzer cannot follow, such as a property passed on through an object spread.
- Always: when changing shared commands, validation flow, deploy flow, release flow, or contributor policy, update the affected `AGENTS.md` files and user/contributor docs in the same change.
- Always: design runtime state, ports, temporary files, browser control channels, editor/plugin integrations, and cleanup logic to support multiple `devhost` instances running concurrently for different projects.
- Done: only claim completion after required docs are updated, required checks for the affected scope pass, and any temporary servers or processes started for validation are stopped.
- Done: if a required step was skipped, a check failed, or a blocker remains, report the work as incomplete and name the exact gap.
- Always: when formatting is required, use the root `just fix` recipe instead of ad-hoc formatter invocations so shared ignore/config behavior stays consistent.
- Ask first: adding a new workspace, changing cross-workspace dependency topology, or changing the publish/release flow.
- Never: disable lint rules unless the user explicitly authorizes it.
- Never: add tests that only lock static CSS, class names, theme token values, or full stylesheet text (generated artifact freshness checks such as `packages/design/tokens.css` are permitted). Prefer behavior and integration contracts such as config registration, accessible state, or browser-visible interactions.
- Never: build or release `devhost` from the repo root using ad-hoc Go commands; use the documented `apps/devhost/justfile` recipes, root justfile recipes, and runbook.
- Never: start local docs or Storybook dev servers proactively; the user will start them when needed.
- Testing exception: agents may start temporary local servers for validation or recording workflows, but must shut them down before the end of the turn.
- Temporary-file policy exception: generated end-to-end test fixtures, browser profiles, downloads, native dependencies, sockets, and evidence belong under `<os.tmpdir()>/devhost-e2e/`, outside the checkout. Use unique run directories and preserve owned process/directory cleanup. Demo recordings retain `.tmp/demos/`.

## References

- `docs/AGENTS.md`
- `docs/internal/AGENTS.md`
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

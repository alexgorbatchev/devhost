# devhost docs site

Public Astro + Starlight docs workspace for `devhost`, published to GitHub Pages under `/devhost`.

## Commands

- Open the docs site design reference in the default browser: `just design docs`
- Sync the generated landing page and manifest reference: `just docs sync`
- Start the local docs server: `just docs` (or `just docs dev`)
- Check package-local validations: `just docs check`
- Build the static site: `just docs build`
- Preview the production build: `just docs preview`
- Refresh all guide videos: `just demo guides`; refresh one: `just demo guides <guide-slug>`. See `../../docs/internal/references/demo-recording.md` for recording prerequisites.
- Download the pinned guide videos this checkout lacks: `just docs media`
- Upload reviewed guide videos to the `media` release and pin them: `just docs publish-media`

## Local conventions

- `apps/devhost/README.md` is the source of truth for the landing page.
- `apps/devhost/devhost.example.toml` is the source of truth for the manifest reference page.
- `src/content/docs/guides/**/*.md` is the source of truth for the Guides section.
- Every guide starts with a native video player and collapsed text transcript. Keep controls, inline playback, and `preload="none"`; use full HTTPS URLs under `https://alexgorbatchev.github.io/devhost/demos/` for its MP4, WebP poster, and English VTT captions. The recorder replaces only the `guide-demo` block and updates the `public/demos/` assets. Guide prose remains usable by agents without watching videos.
- `public/demos/` tracks each guide's poster and captions. Its `*.mp4` files are ignored: `demo-media.json` pins every video by name, SHA-256, and size, and the files are assets of the `media` GitHub release, each named after its content and never replaced. `demoMedia.ts` and `src/demoMedia/` download, check, and publish them. Never commit a video, and never hand-edit a pin except to delete the entry of a removed guide.
- `src/content/docs/architecture/**/*.md` is the source of truth for the Architecture section.
- `sync.ts` only regenerates `src/content/docs/index.mdx` and `src/content/docs/reference/devhost-example.md` from the app README and manifest reference.
- `../design/references/docs.html` (`just design docs`) is the visual design reference for the docs site. Match its tokens, layout, and state treatments when changing docs styling, and update it in the same change when the design intentionally diverges.
- Site styling lives in `src/styles/devhostTokens.css` (docs type scale and the Starlight `--sl-*` mapping), `src/styles/devhostChrome.css` (header, search, sidebar, table of contents, pagination), and `src/styles/devhostContent.css` (Markdown content, asides, code frames, diagrams). `src/starlight/SiteTitle.astro` overrides Starlight's `SiteTitle`.
- Colors, radii, and markers come from `@alexgorbatchev/devhost-design` (`tokens.css` in Starlight `customCss`); `src/styles/devhostTokens.css` only adds the docs type scale and the Starlight `--sl-*` mapping. Code block syntax colors come from `src/theme/createDevhostCodeTheme.ts` with palettes derived from `DESIGN_TOKENS`.
- Mermaid diagrams render as inline SVG themed by `MERMAID_CONFIG` in `src/theme/constants.ts` through `--dh-*` custom properties, so they follow the theme select; `src/markdown/rehypeWrapMermaidDiagrams.ts` wraps each one in a horizontally scrollable figure at its natural width.

## Local gotchas

- This workspace uses the repo-root `bun.lock`. Do not add a package-local lockfile.
- Shared `oxfmt` / `oxlint` enforcement runs from the repo root, not from this workspace `check` recipe.
- `just docs check` downloads the pinned guide videos, then runs `bun test`, content sync, the check that the videos on disk are the pinned ones, `astro check`, and `astro build`. `just docs dev`, `test`, and `build` download the videos first too, so they need network access until the videos are on disk.
- `just docs check` fails while a video in `public/demos/` differs from its pin or has none. After `just demo guides`, publish the render with `just docs publish-media`, or delete the file and run `just docs media` to return to the published video.
- The style tests render real CSS in Playwright Chromium to verify prose link indicators and search shortcuts. Chromium is installed by root `bun install`; use `just ui install-browser` if its cached binary is missing.
- Prose link underlines use opaque `--dh-accent` because their text matches surrounding prose. Keep search shortcut text opaque and use `--dh-input-line` for form-control boundaries.
- `just docs dev`, `just docs start`, and `just docs preview` bind the Astro server to `0.0.0.0` so the site is reachable from outside the current environment.
- `astro.config.mjs` allows all dev/preview hosts for this workspace; treat the docs server as broadly reachable while it is running.
- The site ships from GitHub Pages at `/devhost`, so content should rely on relative links or Starlight routing instead of hard-coded root-relative `/...` paths.
- `src/content/docs/index.mdx` and `src/content/docs/reference/devhost-example.md` are generated outputs; edit `apps/devhost/README.md` and `apps/devhost/devhost.example.toml` instead.
- Do not add docs tests that snapshot whole static CSS files or literal font/theme declarations when the real contract is config registration or successful build integration.
- The public devtools asset/configuration contract lives in `src/content/docs/guides/devtools.md`: static production scripts, lazy terminal chunks, and fonts are cached by content version; instance configuration is uncached. Keep that guide aligned with the Go server and browser entry.
- Astro caches rendered Markdown in `node_modules/.astro/data-store.json` and only invalidates it when `astro.config.mjs` itself changes. After editing a module the config imports (rehype plugins, Mermaid or code theme constants), delete that file before `just docs build`, or the build reuses stale content.
- Starlight ships its CSS inside `@layer`, so the unlayered stylesheets override it without `!important`. They target Starlight 0.38 markup (for example `.sidebar-content .top-level`, `starlight-toc`, `site-search`); recheck the site visually after Starlight upgrades.

## Boundaries

- Always: update this file, the repo-root `AGENTS.md`, and `.github/workflows/docs.yml` when the docs build or publish workflow changes.
- Always: edit `apps/devhost/README.md` for the landing page, `apps/devhost/devhost.example.toml` for the manifest reference, and `src/content/docs/guides/` or `src/content/docs/architecture/` for published docs pages.
- Never: hand-edit `src/content/docs/index.mdx` or `src/content/docs/reference/devhost-example.md`; they are generated by `sync.ts`.
- Done: only claim docs work complete after required docs/AGENTS updates are done and `just docs check` passes.
- Ask first: changing the GitHub Pages base path, replacing Astro/Starlight, or introducing another published docs workspace.

## References

- `package.json`
- `astro.config.mjs`
- `sync.ts`
- `demoMedia.ts`
- `demo-media.json`
- `../design/references/docs.html`
- `src/content.config.ts`
- `src/styles/`
- `src/theme/constants.ts`
- `../design/AGENTS.md`
- `.github/workflows/docs.yml`
- `apps/devhost/README.md`
- `apps/devhost/devhost.example.toml`
- `src/content/docs/guides/`
- `src/content/docs/architecture/`

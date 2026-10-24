---
title: "Preview standalone pages"
---

From a devhost source checkout, start the development stack:

```sh
just run
```

Open `/__devhost__/pages/` on one of that stack's root-routed domains, such as `devhost.localhost` or `playground.localhost` with the repository defaults. The development manifests append `DEVHOST_DEV_EXT` to each hostname prefix. The tracked `.env` sets `.localhost`; set a different suffix in ignored `.env.local` and reload direnv to override it. Keep the trailing slash. The gallery is served by devhost's control server, so the application can be starting or unavailable while you inspect the pages.

The gallery includes:

- Managed proxy 404 pages with active hostnames or an empty list.
- Starting, exited, and unavailable external services.
- Application 404, 500, 502, 503, and 504 recovery pages.
- Worktree selection with available and unavailable checkouts.
- The unavailable-backend fallback.
- A directory listing and a Markdown document with its source toggle.

Each example uses the same renderer as the real page and retains its HTTP status. Recovery polling keeps the selected example visible. **Restart** and **Switch worktree** display a preview-only message and leave the running stack alone. **Refresh worktrees** reloads the sample data. The preview omits the live devtools toolbar.

Change your browser's light or dark preference to inspect both themes; an open preview follows preference changes. Resize the browser for narrow-screen layouts. The error pages use the shared shadcn components from `packages/devhost-ui/src/statusPages/`; the directory and Markdown views retain their file-page renderer. The file examples live under `demos/pages/files/` and reflect edits on reload. After editing status-page components, styles, or Go templates, restart `just run` to rebuild the embedded pages.

Development builds, including the source shim behind `just run` and builds from `just dev-bootstrap`, enable the gallery through the checkout they record. Any other stack can set `DEVHOST_DEV_SOURCE_DIR` to the devhost checkout path. The gallery returns 404 when no source checkout is configured. It uses the existing stack's domains and control listener, so separate projects can run their own galleries concurrently.

For real startup timeout and restart behavior, use `just devhost demo-recovery`; see [Startup and recovery pages](../../guides/stack-lifecycle/#startup-and-recovery-pages).

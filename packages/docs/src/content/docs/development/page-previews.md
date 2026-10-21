---
title: "Preview standalone pages"
---

From a devhost source checkout, start the development stack:

```sh
just run
```

Open `/__devhost__/pages/` on one of that stack's root-routed domains, such as the domain configured by `DEVHOST_STORYBOOK` or `DEVHOST_PLAYGROUND`. Keep the trailing slash. The gallery is served by devhost's control server, so the application can be starting or unavailable while you inspect the pages.

The gallery includes:

- Managed proxy 404 pages with active hostnames or an empty list.
- Starting, exited, and unavailable external services.
- Application 404, 500, 502, 503, and 504 recovery pages.
- Worktree selection with available and unavailable checkouts.
- The unavailable-backend fallback.
- A directory listing and a Markdown document with its source toggle.

Each example uses the same renderer as the real page and retains its HTTP status. Recovery polling keeps the selected example visible. **Restart** and **Switch worktree** display a preview-only message and leave the running stack alone. **Refresh worktrees** reloads the sample data. The preview omits the live devtools toolbar.

Change your browser's light or dark preference to inspect both themes; an open preview follows preference changes. Resize the browser for narrow-screen layouts. The file examples live under `demos/pages/files/` and reflect edits on reload. After editing Go templates or the shared status stylesheet, restart `just run` to rebuild the embedded pages.

`just run` enables the gallery through `DEVHOST_DEV_SOURCE_DIR=.`. Other source-mode stacks can set `DEVHOST_DEV_SOURCE_DIR` to the devhost checkout path. The gallery returns 404 when that development setting is absent. It uses the existing stack's domains and control listener, so separate projects can run their own galleries concurrently.

For real startup timeout and restart behavior, use `just devhost demo-recovery`; see [Startup and recovery pages](../../guides/stack-lifecycle/#startup-and-recovery-pages).

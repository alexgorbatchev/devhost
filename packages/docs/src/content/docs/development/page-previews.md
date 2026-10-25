---
title: "Preview standalone pages"
---

devhost renders its own pages for unknown hostnames, starting and crashed services, app errors, folder listings, and Markdown. A source checkout can show all of them at once, without breaking anything.

## The page gallery

Start the repository's development stack:

```sh
just run
```

Then open `/__devhost__/pages/`, with the trailing slash, on one of its root-routed hostnames, such as `https://playground.localhost/__devhost__/pages/`. The gallery shows:

- the proxy's 404 page, with active hostnames and with none,
- starting, exited, and unavailable external services,
- app 404, 500, 502, 503, and 504 recovery pages,
- worktree selection with available and unavailable checkouts,
- the unavailable-backend fallback,
- a folder listing and a Markdown document with its source toggle.

Each example uses the real renderer and HTTP status. **Restart** and **Switch worktree** only show a preview message, and **Refresh worktrees** reloads sample data; the running stack is never touched. The gallery leaves out the devtools toolbar, and is served by devhost itself, so it works while the app is down.

Change your system's light or dark preference, or resize the window, to check both themes and narrow layouts. All built-in pages, including the gallery, file browser, and running-stack directory, use React and the shared shadcn components in `packages/devhost-ui/src/statusPages/`. The file examples live in `demos/pages/files/` and reflect edits on reload. After editing page components or styles, restart `just run` to rebuild the embedded pages.

The gallery exists only in a development build (see [Build from source](../building/)) or with `DEVHOST_DEV_SOURCE_DIR` set; otherwise it answers 404. Each stack serves its own, so several projects can show theirs at once.

## Hostnames for the development stack

The development manifests build every hostname from a prefix plus `DEVHOST_DEV_EXT`. The tracked `.envrc` sets it to `.localhost`; to use another suffix, export it in the ignored `.envrc.local`, including the leading dot, and reload direnv:

```sh
export DEVHOST_DEV_EXT='.example.test'
```

## A real startup failure

To watch a real health-check timeout and restart:

```sh
just devhost demo-recovery
```

Open `https://recovery.localhost/` (or `recovery` plus your suffix). Its service deliberately never opens its port: the page shows startup progress, then a health timeout after ten seconds with logs and a **Restart unhealthy** button, and every restart fails the same way. The demo turns the toolbar off so you see the standalone page. Press **Ctrl-C** to stop it.

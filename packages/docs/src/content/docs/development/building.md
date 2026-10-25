---
title: "Build from source"
---

Build devhost from a checkout of [the repository](https://github.com/alexgorbatchev/devhost) to try unreleased changes or work on devhost itself.

## Build a binary

```bash
just setup
just devhost compile
./apps/devhost/bin/devhost --version
```

`just setup` installs the workspace dependencies and Go modules and builds the embedded toolbar. `just devhost compile` rebuilds the toolbar and writes a binary for your platform to `apps/devhost/bin/devhost`, stamped with the version in `apps/devhost/metadata.json`.

To run devhost from source without installing it, use `just cli <args>`, or `just run-ai <args>` for agent output. Both run in the directory you call them from. `just run` starts the repository's own development stack.

## Iterate on the toolbar

A development build serves the toolbar from its source checkout and rebuilds it when you reload a page, so UI changes show up without rebuilding devhost or restarting the stack.

1. Use a development build. `just run`, `just cli`, `just run-ai`, and `just dev-bootstrap` (which replaces the `devhost` your dotfiles install) all record the checkout they were built from. For any other build, set `DEVHOST_DEV_SOURCE_DIR` to the checkout's root; a relative path resolves from the manifest's directory, and the variable wins over a recorded checkout.
2. Edit files under `packages/devhost-ui/src/devtools/` and reload the page.
3. When those files are newer than the built bundle, devhost rebuilds it, one build at a time, and serves it uncached. Tabs that loaded an earlier build keep working.
4. A failed build shows a `DEVHOST COMPILATION ERROR` banner on the page with the details; the next reload tries again.

Changes to Go code need a new binary: rerun `just dev-bootstrap`, or restart `just run`, which rebuilds on start.

If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` fails and names the path. If a development build's recorded checkout has moved or been deleted, devhost warns at startup and serves the toolbar built into the binary.

A development build also lets chat work on devhost itself; see [Chat about devhost itself](../../guides/annotations/#chat-about-devhost-itself).

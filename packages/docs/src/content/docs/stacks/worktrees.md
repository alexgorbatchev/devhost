---
title: "Git worktrees"
---

When your services run from a Git repository, the toolbar's **Worktrees** button switches the whole stack to another checkout of that repository, such as a linked worktree for a feature branch, and restarts it there.

Worktree switching is on by default and needs `git` on your `PATH`. To turn it off:

```toml
[worktrees]
enabled = false
```

## Switch checkouts

1. Open **Worktrees** in the toolbar. The button shows the current branch, or the short commit ID for a detached checkout.
2. When the stack runs services from several repositories, choose one with **Repository**.
3. Pick a checkout. **Find worktree** filters by branch, path, or commit ID.
4. Press **Switch and restart stack**.

devhost validates the target first. If its manifest is invalid, the current stack keeps running. Otherwise it stops every managed service, loads the target checkout's manifest and includes, starts the services there, and reloads the page at the same URL. If that URL no longer has a route, the 404 page lists the routes that do. If the new services fail to start, devhost tries to restore the previous checkout.

The services of one repository succeed or fail together. If one fails its health check, they all stop and each one's recovery page shows that error; restarting any of them retries the whole repository.

The stack takes all of the target manifest's settings, including its `name` and its services, which can differ from the checkout you left. The terminal logs the source and target checkout before and after a switch.

devhost remembers the selection for each root manifest path and restores it on the next `devhost start`.

## How devhost finds the target manifest

devhost uses the manifest at the same path relative to the repository in the target checkout. When your root manifest lives outside the repository, it looks for a manifest with the same file name at the target checkout's root. A checkout with no manifest of its own uses the one of the stack that owns it.

Keep every service of one repository pointing into the same checkout: its `cwd` values should all resolve inside one worktree.

## Checkouts you cannot pick

- **unavailable**: the checkout's manifest is missing or invalid, or a service directory is missing. Click the badge for the reason.
- **in use**: another running stack uses that checkout's manifest. Click the badge to see that stack's name, PID, and manifest. **Open stack** opens one of its pages on Caddy's current HTTPS port, and **Stop stack** stops it so you can switch.
- Repositories with an external service (`managed = false`) cannot switch at all, and say why.

The fork icon on **Worktrees** turns red when the selected checkout is unavailable or a repository reports an error. Open the panel for details.

## New and deleted worktrees

devhost looks for added and deleted worktrees when you open the picker or press **Refresh**. Deleting a worktree the stack does not use restarts nothing.

If the running checkout was deleted, devhost stops only that repository's services and shows a recovery error. Pick an available checkout to bring them back; devhost does not fall back to another checkout by itself. Until then, editor links and new chat conversations for that repository are blocked. Other repositories keep running.

## What follows the selected checkout

- Hot reload watches the selected checkout's manifest and includes.
- Relative `watch` paths follow the checkout; absolute ones do not.
- Editor source links open files in the selected checkout.
- New chat conversations start in the selected checkout. Existing conversations stay in the directory they started in, so start a new one after switching.
- Startup and recovery pages offer **Switch worktree** and **Refresh worktrees** too, even when the toolbar is off.

## Several worktrees at once

Each worktree can run its own stack at the same time when their hostnames and fixed ports differ. `devhost stop --worktrees` stops all of them; see [Stop every worktree of a repository](../../guides/stack-lifecycle/#stop-every-worktree-of-a-repository).

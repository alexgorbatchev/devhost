---
title: "Troubleshooting"
sidebar:
  order: 10
---

## Automatic port conflict during restart

A single-service restart reuses its assigned automatic port. If another process occupies it, devhost reports the conflict and leaves the service stopped. Choose **Restart stack with new ports** in the Services panel or recovery overlay to restart all managed services with fresh automatic ports and rebuilt port references and environments. External processes keep running, and fixed ports stay unchanged.

This action uses the last accepted manifest, so an invalid edit on disk does not block recovery. Launch or routing failures display an error and remain retryable. A fixed-port conflict requires freeing the configured port or changing that service's `port` setting; automatic-port reassignment cannot resolve it.

## Manifest changes rejected

Saving `devhost.toml` or an included manifest reloads service configuration. A `configuration reload rejected` log names the reason an edit could not apply. Correct parse or validation errors and save again. Edits to `name`, `killZombies`, Caddy, devtools, annotation settings, or worktree enablement require stopping and restarting devhost; the entire edit is rejected if it changes any of those settings.

If a replacement launch or route update fails, devhost attempts to restore the previous stack. Read the retained logs for restoration errors and recover stopped services explicitly. See [Stack lifecycle](./stack-lifecycle/) for the reload and recovery contract.

## Deleted selected worktree

Open the Services checkout picker or press **Refresh** after adding or deleting worktrees. If the running checkout was deleted, devhost stops only that repository's services and retains the missing selection with a recovery error. Select an available checkout before restarting the stack. Editor and annotation launches into that repository remain blocked until checkout recovery; other repositories keep running.

## Vite bind-host mismatch

Some dev servers print a URL like `http://localhost:5173`, and many projects copy that port directly into `devhost.toml`. With Vite-style setups, `localhost` and `127.0.0.1` can point at different listeners, which makes the routed hostname and the printed dev-server URL appear to disagree.

On some machines, though, `http://localhost:5173` and `http://127.0.0.1:5173` do not hit the same listener:

- `localhost` may resolve to `::1`
- `devhost` defaults `bindHost` to `127.0.0.1`
- a routed hostname such as `https://app.localhost` will therefore proxy to `127.0.0.1:<port>` unless you override `bindHost`

That can produce confusing behavior where the direct printed `localhost` URL works, but the routed `*.localhost` hostname lands on a different local process or response.

When `devhost` detects that mismatch, it logs an explicit startup warning.

For Vite-style apps that are actually listening on IPv6 loopback, set `bindHost = "::1"` explicitly:

```toml
[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
bindHost = "::1"
host = "app.localhost"
```

If you are unsure which listener your app is using, compare these directly:

```bash
curl -I http://localhost:5173/
curl -I http://127.0.0.1:5173/
curl -I http://[::1]:5173/
```

If those responses differ, set `bindHost` explicitly instead of relying on the default.

## Composite services

Some "one command" dev scripts are really wrappers that launch multiple long-lived processes, such as a frontend dev server plus an API worker. In those setups, an inherited `PORT` can miswire child processes if every nested process sees the same value.

By default, `devhost` injects the configured service `port` as `PORT` into that top-level command.
If the wrapper passes its environment through unchanged, every nested child process may inherit the same `PORT`.

That can produce confusing failures such as:

- one child binding the routed service port even though that port was intended for a different nested process
- another child silently moving to a fallback port after seeing the inherited `PORT` already in use
- the frontend proxying `/api` to its usual target while the API actually bound somewhere else
- routed requests returning backend `404`s even though the main page appears to load normally

If your manifest service launches multiple dev processes under one command, prefer splitting them into separate `devhost` services.
If you intentionally keep a composite wrapper, set `injectPort = false` on that service and configure the underlying processes explicitly instead:

```toml
[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
injectPort = false
host = "app.localhost"
```

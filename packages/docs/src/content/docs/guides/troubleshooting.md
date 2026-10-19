---
title: "Troubleshooting"
sidebar:
  order: 10
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.webp" aria-label="troubleshooting demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

## Hostname already claimed

`devhost start` fails with `<host> is already claimed by PID <pid> from <manifest>.` when another running stack routes that hostname. The stack may have been started from a different manifest, so `devhost stop` in your project folder reports that nothing is running there and points to `devhost stack list`.

List the running stacks, then stop the one that holds the hostname:

```bash
devhost stack list
# 3596463	/home/me/projects/app/.tmp/review/devhost.toml
devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"
```

Each line is the PID of the stack's devhost process, one tab, and its manifest path; the PID matches the one in the error. [Stopping a Stack](../stack-lifecycle/#stopping-a-stack) explains the command line piece by piece.

## Zombie cleanup messages

An `already running` startup error means another live stack in the same state directory owns the root manifest or an included file. Use the `devhost stop --manifest` command in the error to stop that stack before starting this one. The same conflict rejects an include change during hot reload. `killZombies` leaves registered live stacks running.

With `killZombies = true` (the default), devhost attempts to kill an existing owner from the same manifest when reclaiming a hostname or fixed port. It prints `Stopping zombie PID ...` before the attempt and `Stopped zombie PID ...` only after confirming that the owner has exited. If the kill fails, exit cannot be verified, or the owner does not exit within five seconds, devhost reports an error and leaves that claim unreclaimed.

Each startup or configuration reload claim pass sends at most one kill attempt and prints at most one pair of messages per process identity, even when that process owns several route registrations, hostname claims, or fixed-port claims. Every claim is still checked and reclaimed separately. Claims from a different manifest remain conflicts.

## Automatic port conflict during restart

A single-service restart reuses its assigned automatic port. If another process occupies it, devhost reports the conflict and leaves the service stopped. Choose **Restart Stack** in the Services panel or recovery overlay to restart all managed services with fresh automatic ports and rebuilt port references and environments. External processes keep running, and fixed ports stay unchanged.

This action uses the last accepted manifest, so an invalid edit on disk does not block recovery. Launch or routing failures display an error and remain retryable. A fixed-port conflict requires freeing the configured port or changing that service's `port` setting; automatic-port reassignment cannot resolve it.

## Manifest changes rejected

Saving `devhost.toml` or an included manifest reloads service configuration. A `configuration reload rejected` log names the reason an edit could not apply. Correct parse or validation errors and save again. Edits to `killZombies`, devtools, annotation settings, or worktree enablement require stopping and restarting devhost; the entire edit is rejected if it changes any of those settings.

If a replacement launch or route update fails, devhost attempts to restore the previous stack. Read the retained logs for restoration errors and recover stopped services explicitly. See [Stack lifecycle](./stack-lifecycle/) for the reload and recovery contract.

## Deleted selected worktree

Open the Worktrees toolbar picker or press **Refresh** after adding or deleting worktrees. If the running checkout was deleted, devhost stops only that repository's services and retains the missing selection with a recovery error. Select an available checkout before restarting the stack. Editor and annotation launches into that repository remain blocked until checkout recovery; other repositories keep running.

## Vite bind-host mismatch

Some dev servers print a URL like `http://localhost:5173`, and many projects copy that port directly into `devhost.toml`. With Vite-style setups, `localhost` and `127.0.0.1` can point at different listeners, which makes the routed hostname and the printed dev-server URL appear to disagree.

On some machines, though, `http://localhost:5173` and `http://127.0.0.1:5173` do not hit the same listener:

- `localhost` may resolve to `::1`
- `devhost` defaults `bindHost` to `127.0.0.1`
- a routed hostname such as `https://app.localhost` will therefore proxy to `127.0.0.1:<port>` unless you override `bindHost`

That can produce confusing behavior where the direct printed `localhost` URL works, but the routed `*.localhost` hostname lands on a different local process or response.

When a TCP health check cannot connect to its configured address but a connection to the other loopback address succeeds, `devhost` logs one warning per startup attempt. Progress logs include the checked address and elapsed time alongside the configured timeout. The final error retains both addresses and a concrete `services.<name>.bindHost` hint, including on recovery pages. The probe establishes connectivity only; verify that the listener belongs to your app before changing `bindHost`.

`bindHost` selects devhost's health-check and proxy target. The application owns its listener: changing the manifest alone does not reconfigure Vite's `server.host`. Configure Vite's `server.host` and `server.port` to match the manifest's address and assigned port, and use `server.strictPort = true` so it fails instead of moving to another port. See [Vite's server options](https://vite.dev/config/server-options).

For an existing app verified to listen on IPv6 loopback, matching that listener means setting `bindHost = "::1"` explicitly:

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
curl -g -I 'http://[::1]:5173/'
```

If those responses differ, match `bindHost` to the verified listener or configure the app to listen on devhost's address. Removing `bindHost` selects `127.0.0.1`, so it only resolves the mismatch if the app accepts IPv4 connections.

A mismatch that prevents readiness ends with a health-check error after the configured timeout (30 seconds by default). The supervisor stays running and recovery remains retryable. With worktrees enabled, a failed repository restart stops the group and shows the failing service's error on every member's recovery page. Correct the listener configuration, then retry **Restart**.

Before stopping a foreground process whose health check failed, devhost logs the health error and explains that it is sending `SIGTERM (signal 15)`. It also announces when a startup failure stops the repository's sibling services. Child messages such as `recipe dev was terminated ... by signal 15` or `script "dev" exited with code 143` can follow that stop request; the preceding devhost message explains the cause. If the stack itself received a signal, devhost names it in a `Received ...; shutting down the stack.` line before stopping services.

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

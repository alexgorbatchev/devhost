---
title: "Troubleshooting"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.webp" aria-label="troubleshooting demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/troubleshooting.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

Each section starts from what you see and ends with the fix.

## Manifest changes rejected

`configuration reload rejected` means a saved edit to `devhost.toml` or an included manifest could not apply. The stack keeps running with the last accepted manifest, and pages with the toolbar show the reason under it.

A syntax error names the file, line, and column; any other problem starts with the setting it concerns, such as `services.api.port`. Fix it and save again. If services failed to start partway through a reload, devhost restored the previous ones; the logs name anything it could not restore. See [Hot reload](../../stacks/hot-reload/).

## Caddy is unavailable or cannot start

`Caddy is not available.` means the shared proxy is not running. Start it:

```bash
devhost caddy start
```

On Linux, an error about binding port 443 means Caddy lacks the privilege to use low ports:

```bash
devhost caddy privileged-ports   # may ask for your password
devhost caddy start
```

Run `privileged-ports` again whenever the Caddy binary is replaced. For Caddy's own messages, read `<state>/caddy/caddy.runtime.log`, or `caddy.stdout.log` and `caddy.stderr.log` beside it for the last start; `AGENT=1` also prints the underlying connection error. See [Files and directories](../../reference/cli/#files-and-directories).

## Browsers reject devhost HTTPS certificates

`managed caddy local CA is not trusted, so browsers will reject devhost HTTPS certificates.` means your system does not trust Caddy's certificate authority yet: you declined the password prompt, the installation failed, or devhost could not ask (no terminal, or `AGENT=1`). Install it from a terminal:

```bash
devhost caddy trust
```

A phone or another computer needs the authority too; on a Mac, use `devhost caddy trust-remote`. See [Trust the certificates](../managed-caddy/#trust-the-certificates).

## Hostname already claimed

`<host> is already claimed by PID <pid> from <manifest>.` means another running stack routes that hostname. It may come from another directory, so `devhost stop` in yours finds nothing. Find and stop it:

```bash
devhost stack list
# 3596463	/home/me/projects/app/.tmp/review/devhost.toml
devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"
```

The PID in the list matches the one in the error. See [Stop a stack started elsewhere](../stack-lifecycle/#stop-a-stack-started-elsewhere).

## Manifest already in use

An `already running` error means another live stack already uses your root manifest or one of its included manifests. A manifest file belongs to one stack at a time, even when the two stacks start different services. The error prints the command that stops the other stack; run it, then start yours. The same conflict rejects a hot reload that adds an include another stack uses.

## Zombie cleanup messages

`Stopping zombie PID ...` followed by `Stopped zombie PID ...` means devhost found a process from an earlier run of the same manifest, one that crashed or was killed, still holding a hostname or port, and stopped it. This is on by default (`killZombies = true`).

- devhost tries each leftover process once per startup or reload, and prints the pair once even when that process held several hostnames and ports.
- If the process cannot be killed, or has not exited after five seconds, devhost reports an error and leaves that hostname or port unclaimed.
- Processes from a different manifest, and stacks that are still running, are never killed; they produce the usual conflict errors above.

To get a conflict error instead of the cleanup, turn it off at the top of the manifest:

```toml
killZombies = false
```

## Restart fails because a port is taken

A single-service restart keeps its automatic port. If another process took that port, the restart fails and points to **Restart Stack**, which assigns new automatic ports. A fixed `port` cannot be reassigned: stop whatever holds it or change the setting. See [Restarts and recovery](../../stacks/recovery/#port-conflicts-on-restart).

## The running worktree was deleted

devhost stops that repository's services and shows a recovery error. Open **Worktrees** and pick an available checkout. See [New and deleted worktrees](../../stacks/worktrees/#new-and-deleted-worktrees).

## Vite bind-host mismatch

The dev server prints `http://localhost:5173` and works there, but `https://app.localhost` times out or shows another app's response.

`localhost` can resolve to IPv6 `::1`, while devhost connects to `127.0.0.1` unless the service sets `bindHost`. The two addresses can reach different listeners, or one can have none. Compare them:

```bash
curl -I http://localhost:5173/
curl -I http://127.0.0.1:5173/
curl -g -I 'http://[::1]:5173/'
```

When the health check fails on one loopback address but the other answers, devhost says so once per start and suggests the `services.<name>.bindHost` value to use. Check that the listener that answered really is your app, then either:

- **Make the app listen where devhost connects.** Set Vite's `server.host` and `server.port` to the manifest's address and port, and `server.strictPort = true` so Vite fails instead of moving to another port. See [Vite's server options](https://vite.dev/config/server-options).
- **Point devhost at the app's listener**, for an app that listens on IPv6 loopback only:

  ```toml
  [services.app]
  command = ["bun", "run", "dev"]
  port = 5173
  bindHost = "::1"
  host = "app.localhost"
  ```

`bindHost` tells devhost where to connect and check health; it does not reconfigure your app. A mismatch ends in a health-check timeout (30 seconds by default) and a recovery page; fix the listener, then press **Restart**.

## A tool reports signal 15 or exit code 143

Messages such as `recipe dev was terminated ... by signal 15` or `script "dev" exited with code 143` mean devhost stopped that process. The devhost line just before it says why: a failed health check, a repository's sibling service failing, or a shutdown signal the stack received (`Received ...; shutting down the stack.`).

## One command runs several dev servers

A wrapper command that starts, say, a frontend and an API together passes the service's `PORT` to every process it starts. One of them takes the routed port, another moves to a fallback, and API requests return `404` while the page looks fine.

Split them into separate services, which is the better fix. To keep the wrapper, stop devhost from setting `PORT` and configure each process's port yourself:

```toml
[services.app]
command = ["bun", "run", "dev"]
port = 5173
injectPort = false
host = "app.localhost"
```

## A page through a tunnel or proxy is blank

When a tunnel or another proxy connects to devhost over plain HTTP, Caddy needs its HTTP listener even if visitors use HTTPS. Set `http = true` in `config.toml`; see [Proxy ports and listeners](../shared-managed-caddy-settings/).

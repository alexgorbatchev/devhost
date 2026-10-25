---
title: "Restarts and recovery"
---

A service that crashes, times out, or returns errors never takes the stack down with it. Its hostname shows what went wrong, with recent logs and a restart button, and the other services keep running.

## Startup pages

Open a service's hostname while it starts and you see **Starting <service>**, its address, and its latest output. The tab reloads itself at the same URL once the service is healthy. devhost never opens a browser for you.

These pages work for every hostname alias and path route, with or without the devtools toolbar, and need nothing from your app. Without JavaScript they still show the error, service details, and logs; live updates and buttons need JavaScript.

## When a service fails

If a service fails to start, fails its health check, exits, or stops answering, its hostname shows the error and its recent logs:

- **Managed services** get a **Restart <service>** button. It is enabled once the stack has finished starting, and disabled while a restart runs. A failed attempt shows its error and can be retried.
- **External services** (`managed = false`) show their status only; recover them outside devhost.
- **Daemon services** report their health check, not a process exit.

With the toolbar, a service that exits while you work opens a full-screen recovery view with its exit code, logs, and a **Restart** button. It closes once the service recovers. Stopping the stack or restarting a service on purpose does not open it.

devhost keeps a service that exited, even with exit code `0`, stopped until you restart it or save a manifest edit that affects it. The stack keeps running until you stop it or the idle timeout does.

## When the app returns an error

When a page load (not an API call or asset) reaches your app and gets back:

- **HTTP 404**: devhost shows **Page not found**, with the checkout picker when [worktrees](../worktrees/) are on.
- **HTTP 5xx**, including an empty response from a failed compile: devhost shows **<service> could not load** with recent logs.

The response keeps the original status code and is never cached. The page waits until that URL returns something other than 404 or 5xx, then reloads. Fix the error in your app, and restart the service if it needs it. API requests, assets, and WebSockets always get your app's own response.

## Restart services

| To restart                                                                               | Use                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| One service                                                                              | **Restart** on its recovery page, or its row in the Services panel.                                    |
| Every service marked **changed** by its `watch` paths (the primary service when none is) | **Restart Changed** in the Services panel, or **Alt+Ctrl+R** (`[devtools.shortcuts].restartServices`). |
| Every managed service, with new automatic ports                                          | **Restart Stack** in the Services panel or the recovery view.                                          |

A single-service restart keeps the service's automatic port, so other services that refer to it stay correct. It succeeds only when the new process is healthy and its routes are updated; otherwise devhost restores the previous route and the restart can be retried.

### Restart Stack

**Restart Stack** stops every managed service in reverse dependency order, assigns new automatic ports, rebuilds commands and environments that refer to them, and starts everything again in dependency order. It keeps:

- fixed ports and the selected checkouts,
- external services, which keep running,
- connected pages and chat sessions.

It uses the last manifest that was accepted, so an invalid edit on disk does not block it. If a launch or route update fails, devhost tries to restore the previous stack, reports what went wrong, and the button can be used again.

## Port conflicts on restart

Another process can take a service's automatic port while the service is stopped. The single-service restart then fails with an error that points to **Restart Stack**, which assigns a new port. Startup and hot reload retry this kind of conflict with another port on their own, up to three times.

**Restart Stack** cannot fix a conflict on a fixed port. Stop the process that holds it, or change the service's `port`.

## Health check messages

While a service starts, its log names the TCP address or HTTP URL being checked, the time spent, and the timeout. A failure keeps that target in the error, in the terminal and on the recovery page.

Before stopping a service that failed its health check, devhost explains that it is sending `SIGTERM (signal 15)`. A message from your tool such as `exited with code 143` that follows is reporting that stop. When the TCP check fails on one loopback address but the other one answers, devhost suggests a `bindHost`; see [Vite bind-host mismatch](../../guides/troubleshooting/#vite-bind-host-mismatch).

## What still stops startup

An invalid manifest, a hostname, port, or manifest that another stack holds, and a failure to register the first routes all stop `devhost start` with an error in the terminal. Nothing is left running.

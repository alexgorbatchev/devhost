---
title: "Control API"
---

The devtools toolbar talks to its stack through HTTP and WebSocket routes under `/__devhost__/` on the app's own hostname. This page documents those routes for integrations and scripts. They exist only while at least one devtools feature is on.

## Request routing

With devtools on, Caddy splits each routed hostname's traffic:

| Request                                 | Goes to                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `/__devhost__/*`                        | The stack's control server                                                              |
| Page loads (`Sec-Fetch-Dest: document`) | devhost's document server, which adds the toolbar and serves startup and recovery pages |
| Everything else                         | The app, directly                                                                       |

Assets, HMR, fetches, server-sent events, and WebSockets therefore never pass through devhost.

## Security model

The control API is meant for trusted local development and uses no authentication token. Each stack has its own control server, so stacks cannot reach each other's sessions.

Requests that change something, and every WebSocket, must come from the routed page itself or from a tool that sends no browser headers, such as `curl`:

- A request that a browser marks as cross-origin, through `Origin` or `Sec-Fetch-Site`, gets `403 Forbidden`. So does a WebSocket whose `Origin` names another host.
- The `Host` must be one of the stack's hostnames or a loopback name such as `localhost` or `127.0.0.1`. This stops a page whose own hostname was pointed at the control server.
- A request body must be `Content-Type: application/json`, or the request gets `415 Unsupported Media Type`.
- Starting, resuming, or closing a chat session, and the chat WebSocket, also require an `Origin`, so only a page can drive an agent.
- The config editor routes apply the `Host` rule to reads as well, because they return file contents.

Buttons on startup and recovery pages follow only the cross-origin rule, because those pages are served on the service's own hostname.

An authenticating proxy in front of devhost still applies its own rules; a sign-in redirect can stop a WebSocket from reaching devhost.

## HTTP endpoints

| Endpoint                                | Methods       | Purpose                                                                                            |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `/__devhost__/inject.js`                | `GET`         | The toolbar script that page loads include                                                         |
| `/__devhost__/config.json`              | `GET`         | Instance configuration for the toolbar                                                             |
| `/__devhost__/restart-service`          | `POST`        | Restart managed services                                                                           |
| `/__devhost__/restart-stack`            | `POST`        | Restart every managed service with new automatic ports                                             |
| `/__devhost__/worktrees`                | `GET`, `POST` | Refresh worktree state, or switch the selected checkout                                            |
| `/__devhost__/react-highlight/cursor`   | `POST`        | Publish an editor cursor position; see [Highlight source locations](../../guides/react-highlight/) |
| `/__devhost__/config/files`             | `GET`         | The files the config editor can change, with contents                                              |
| `/__devhost__/config/schema`            | `GET`         | The settings each kind of file accepts                                                             |
| `/__devhost__/config/validate`          | `POST`        | Check unsaved content with the checks a reload runs                                                |
| `/__devhost__/config/save`              | `POST`        | Write checked content over the version it was edited from                                          |
| `/__devhost__/chat/harnesses`           | `GET`         | Installed coding agents and their models                                                           |
| `/__devhost__/chat/sessions`            | `GET`, `POST` | List chat sessions, or start or resume one                                                         |
| `/__devhost__/chat/sessions/<id>/close` | `POST`        | End a chat session's process                                                                       |
| `/__devhost__/redux.js`                 | `GET`         | Store registration module; see [Redux Toolkit and Zustand](../../integrations/redux/)              |

The chat endpoints are described in the [Chat API](../chat-api/).

### Status codes

| Code                         | When                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `400 Bad Request`            | A malformed request                                                                                                            |
| `403 Forbidden`              | A request that fails the rules above. A config save also gets it for a file the editor does not list, or from another machine. |
| `404 Not Found`              | A feature that is off, such as the config editor or chat                                                                       |
| `405 Method Not Allowed`     | The wrong method                                                                                                               |
| `409 Conflict`               | A config save whose file changed on disk since it was read; the body holds the file on disk                                    |
| `415 Unsupported Media Type` | A body that is not JSON                                                                                                        |
| `422 Unprocessable Entity`   | A config save that fails the checks; the body lists the problems                                                               |
| `501 Not Implemented`        | A control that is not available                                                                                                |

## WebSockets

Connect with `wss://` on an HTTPS hostname, or `ws://` on plain HTTP:

| Path                                                                    | Streams                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/__devhost__/ws/health`                                                | Service health                                                               |
| `/__devhost__/ws/logs`                                                  | Service and devhost log lines                                                |
| `/__devhost__/ws/resources`                                             | CPU, memory, and disk readings; `404` while all readouts are off             |
| `/__devhost__/ws/react-highlight`                                       | Editor cursor positions                                                      |
| `/__devhost__/ws/chat?sessionId=<id>&pageURL=<url>&chatTarget=<target>` | One chat session; see the [Chat API](../chat-api/#event-stream-and-commands) |

The toolbar reconnects every stream after a loss, waiting from one up to ten seconds between attempts. While health is disconnected, services show as unavailable; logs keep what they buffered; resource readouts hide; editor highlights clear.

devhost drops a connection whose reader stops reading for ten seconds while updates wait, for example a page paused in a debugger. The page reconnects once it runs again.

When the stack stops, every stream closes with code `1001` (going away). Closing a chat session closes its stream with `1000`.

## Instance configuration and caching

Before it mounts, the toolbar script fetches `/__devhost__/config.json` with `cache: "no-store"`. The response holds the stack name, project root, enabled features, and UI settings, and is sent with `Cache-Control: no-store`, so a reload always sees current settings.

Everything else the toolbar loads is cached for a year:

- The entry script, `redux.js`, and the Redux inspector carry a content version in their URL (`?v=`). An unversioned URL redirects, uncached, to the current version, so an upgrade picks up new files while unchanged ones stay cached across restarts.
- Lazy JavaScript chunks and fonts have content-hashed names.
- Scripts and styles are gzip-compressed when the browser accepts it.

A development build of devhost serves these assets uncached and rebuilds them on demand; see [Build from source](../../development/building/#iterate-on-the-toolbar).

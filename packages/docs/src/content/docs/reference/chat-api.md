---
title: "Chat API"
---

The toolbar's chat drives the installed Codex CLI through its app-server protocol and Claude Code through its stream-json protocol. devhost adds no model service and stores no API keys: each CLI keeps its own sign-in, permissions, settings, and environment. This page documents the routes the chat uses; for using chat, see [Chat with a coding agent](../../guides/annotations/).

All routes live on the page's own hostname and follow the [Control API security rules](../control-api/#security-model).

## Chat targets

Every chat request names a target, which devhost turns into the agent's working directory. The browser never supplies a directory, executable, flags, or environment.

| Target    | Working directory                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project` | The checkout of the routed service that `pageURL` belongs to                                                                                                         |
| `devhost` | devhost's own source checkout. Only development builds have one; other builds answer `400`, and `/__devhost__/config.json` reports an empty `devhostSourceRootPath`. |

A missing or unknown target gets `400 Bad Request`. `GET` requests, the WebSocket, and session close pass `pageURL` and `chatTarget` as query parameters; creating a session passes them as `pageURL` and `target` in its JSON body.

## Discover agents

```text
GET /__devhost__/chat/harnesses?pageURL=<page-url>&chatTarget=<target>
```

devhost asks each installed CLI for its model list without sending a prompt. Each harness has `id`, `label`, `available`, `models`, and an optional `error`; each model has an `id`, a label, and a description. A harness can be available and still fail to answer prompts when its CLI is not signed in.

## Sessions

### Start or resume

```text
POST /__devhost__/chat/sessions
```

```json
{
  "harness": "codex",
  "pageURL": "https://app.localhost/",
  "target": "project",
  "model": "optional-model-id",
  "resumeId": "optional-native-session-id"
}
```

Leaving out `model` keeps the CLI's configured default. `resumeId` resumes the CLI's own saved conversation; the session then carries that ID as `nativeSessionId` from the start, and replaces closed sessions of the same conversation in the list. Resuming a conversation that belongs to another project is rejected.

The response, like every session record, has `id`, `harness`, `projectRootPath`, `status`, an optional `nativeSessionId`, and an optional `error`. `nativeSessionId` can appear later; Claude Code usually reports it after its first turn.

| `status`          | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `starting`        | The CLI is starting.                                                      |
| `idle`            | Waiting for a message.                                                    |
| `running`         | A turn is in progress.                                                    |
| `requires_action` | The agent waits for an approval or an answer.                             |
| `error`           | The last turn failed; `error` has the reason. The next message clears it. |
| `closed`          | The process ended. The session stays listed and can be resumed.           |

### List and close

```text
GET  /__devhost__/chat/sessions?pageURL=<page-url>&chatTarget=<target>
POST /__devhost__/chat/sessions/<id>/close?pageURL=<page-url>&chatTarget=<target>
```

Listing returns only the sessions of the directory that `pageURL` and the target resolve to. Closing ends the session's process and returns its record with status `closed`. A session of another directory answers `404`.

Sessions belong to the running stack: closing a tab or reloading never ends a turn, and stopping the stack ends every session. A new session uses the checkout selected at that time; existing sessions keep their directory. Interrupting a turn (below) leaves the session open.

## Event stream and commands

```text
wss://<host>/__devhost__/ws/chat?sessionId=<id>&pageURL=<page-url>&chatTarget=<target>
```

A missing `sessionId` gets `400` and an unknown one `404`, before the upgrade. devhost checks the session's directory when the socket attaches and again before every command, so an old socket cannot send into a checkout the page has switched away from.

### Frames from devhost

| `type`           | Content                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `snapshot`       | First frame: the session, every retained `event`, and `pendingRequestIds`.   |
| `event`          | One CLI event: an increasing `sequence` and the unchanged native `payload`.  |
| `state`          | Session metadata and the current `pendingRequestIds`.                        |
| `command_result` | `{sessionId, commandId, error?}` for one `send`, on the socket that sent it. |
| `error`          | A command that failed and could not be matched to a `commandId`.             |

### Commands to devhost

| `type`      | Fields                                                                                   | Effect                                                |
| ----------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `send`      | `commandId` (non-empty string), `text`, optional `model`, optional `images: [{dataURL}]` | Starts a turn, or adds the message to the active turn |
| `interrupt` | none                                                                                     | Interrupts the current turn                           |
| `respond`   | `requestId` (string or number), native `result`                                          | Answers one pending approval or question              |

- A `send` is acknowledged once the CLI accepts or rejects it, not when the turn ends. Acknowledgements are not shared with other browsers or kept in history.
- During an active turn, Codex receives the message through `turn/steer` and Claude Code through its streaming input. Model changes then wait for the next turn. If Codex rejects a steer because the turn just ended, devhost starts a new turn with the message.
- For Claude Code, devhost confirms a send once the CLI echoes the user message back, so a message that later fails still appears in history.
- `model` set to an empty string returns to the CLI's configured default; leaving it out keeps the session's current model.
- Sends from one socket are delivered in order. Approvals and interrupts are handled while a send waits for its acknowledgement.

### Images and size limit

Images must be PNG or JPEG `data:` URLs; remote URLs and file paths are rejected. A whole `send` frame, as UTF-8 JSON, must fit in 8 MiB. The browser checks this before sending, and devhost enforces it.

### Workflow instructions

devhost appends `[devtools.chat].prompt` to the text of each non-empty `send`, as a labeled section of the user message. The CLI's own system prompt and permissions are untouched. Without `prompt`, devhost appends its default worktree workflow; an empty string appends nothing. A changed `prompt` applies to the next send of every session.

## Approvals, questions, and failures

Approvals and questions stay in the CLI's own message format. devhost never answers them itself, and rejects a `respond` for a request that is not pending, including one already answered or cancelled. A reconnecting page uses `pendingRequestIds` to tell which requests in its history still need an answer.

- A Codex turn that ends with status `failed` sets the session to `error` with the CLI's message, or `Native Codex turn failed` when there is none. Errors Codex retries on its own leave the turn running until it ends.
- A Claude Code result with `is_error: true` is an error even when its subtype says `success`, and keeps the CLI's error text.
- A CLI that is not signed in fails at the first turn, even when discovery found it. Sign in through the CLI, never in the browser.

Closing a session closes its socket with code `1000`; stopping the stack uses `1001`. devhost stops every process a session started, including children that ignore the first signal.

## History storage

devhost keeps each session's full event history in a private temporary file and streams it to every page that attaches. On Unix systems the file is unlinked as soon as it opens, so its space is freed when devhost closes it, even after a crash. A closed session keeps its history until it is resumed or the stack stops.

The history grows with the conversation. If devhost cannot write it, it stops that session's process and reports an error rather than dropping events. The history does not survive a stack restart; resume through the CLI's own saved conversations.

## Browser state

The page stores its chat state in `localStorage`, under keys starting with `devhost:settings:` that include the project directory and the page's origin. Pages that differ only in path, query, or fragment share it. It holds:

- whether chat is open, its side, and the chat target,
- the selected harness, model, and session,
- the unsent text, until the send is acknowledged,
- the conversation's scroll position,
- whether the hot reload notice was dismissed.

Each target keeps its own conversation state, so switching to **devhost** and back restores the project's conversation. Invalid or outdated saved data resets to defaults. Transcripts, screenshots, selections, drawings, screen-sharing permission, and approval answers are never stored in the browser.

After a reload, the page reattaches the saved session only if it still exists and is not closed, and a saved model that the CLI no longer offers returns to the configured default.

Before a screenshot is sent, the page shows a preview. Choosing an area sends only that crop as its own PNG, with its position and the full screenshot's size in the page context; cancelling keeps the draft and context.

## Activity logs

Chat activity appears in the stack's terminal and under `chat` in the log minimap. Every line carries the devhost session ID and harness; CLI turn and tool IDs appear where the CLI supplies them, and Claude Code turns get IDs local to the session.

| Record               | Includes                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Session              | Start, resume, and close; the project directory and requested model; the CLI's session ID once known                                         |
| Turn                 | Start with the selected or configured model (and the model Claude Code reports using), outcome, and duration                                 |
| Message              | Command ID, number of attachments, time queued, whether it started a turn or joined one, and the CLI's acceptance or rejection time          |
| Tool                 | Tool name, path or working directory, outcome, duration, and exit code where available                                                       |
| Approval or question | Request ID and kind, time waited, whether it was answered or cancelled, and whether the answer was delivered                                 |
| Heartbeat            | For a turn with no CLI event in the last 30 seconds: elapsed time, quiet time, active tools, and pending requests. Checked every 30 seconds. |
| Usage                | Codex token counts per turn; Claude Code usage, duration, and `total_cost_usd` (an estimate). Only what the CLI reports.                     |
| Error                | Startup, protocol, process, and timeout failures, with a short diagnostic                                                                    |

Log lines never include prompts, replies, screenshots, tool input or output, or answers to approvals. They can include file paths, project paths, IDs, and a process's error output. Error details are cut at 512 bytes and a whole line at 2 KiB. The browser keeps the latest 512 log entries; the terminal keeps whatever your terminal keeps.

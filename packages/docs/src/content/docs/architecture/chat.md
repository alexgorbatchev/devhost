---
title: "Browser Chat Sessions"
---

The injected chat uses installed Codex and Claude Code clients. Codex runs its native app-server protocol; Claude Code runs its native stream-json protocol. The clients keep their configured authentication, permissions, settings, environment, and working directory. Devhost does not implement a separate model service or store browser API keys.

## Discovery and checkout ownership

`GET /__devhost__/chat/harnesses?pageURL=<page-url>` asks each installed client for its native model catalog without sending an inference request. Each harness reports `id`, `label`, `available`, `models`, and an optional error. A model exposes its selectable `id`, label, description, and complete native row as `metadata`. Discovery does not prove the account is signed in for inference.

The page URL resolves a routed service and its selected checkout on the server. Browsers cannot choose an executable, command flags, environment, or arbitrary working directory. Omitting a model preserves the client's configured default.

## Native sessions

`POST /__devhost__/chat/sessions` accepts:

```json
{
  "harness": "codex",
  "pageURL": "https://app.localhost/"
}
```

Optional `model` selects an advertised model; optional `resumeId` asks the native client to resume its own conversation ID. Codex uses its native thread start/resume operations. Claude Code receives its native resume argument. A resumed conversation still resolves its checkout from the supplied routed page.

The response contains `id`, `harness`, `projectRootPath`, `status`, an optional `nativeSessionId`, and an optional error. Native identity can arrive later, particularly before Claude Code's first turn. Status is `starting`, `idle`, `running`, `requires_action`, `closed`, or `error`.

`GET /__devhost__/chat/sessions?pageURL=<page-url>` returns only the records belonging to that page's resolved project. `DELETE /__devhost__/chat/sessions/<id>?pageURL=<page-url>` terminates and joins a session in that same project. Cross-project attachment and deletion return 404, and resuming a native ID already associated with another project is rejected. Interrupting a turn is a separate operation and leaves its session available.

Sessions and retained events are owned by the running stack. Reloading or closing a browser does not end an in-flight turn. New sessions follow a newly selected checkout; existing sessions retain the directory they started in. Stack shutdown stops and joins its processes. Browser replay is in memory and does not constitute a durable prompt queue across stack restarts; native clients own their own saved conversation history.

## Browser view persistence

The injected UI uses the shared Zustand settings store with `persist` and `createJSONStorage`. Local storage keys start with `devhost:settings:` and include the resolved project directory and page origin. Paths, query parameters, and fragments share settings so client-side navigation followed by reload retains the active conversation. Different project directories and origins remain isolated. The versioned payload contains chat visibility, panel side, selected harness and model, active devhost session ID, text draft, and conversation scroll position. Zod validates saved settings; invalid data and unknown versions reset to defaults. Storage access and quota failures leave the in-memory UI usable.

On reload, the client lists the routed project's sessions and attaches the saved ID only if that record still exists and is not closed. It obtains messages and pending request IDs from the authoritative WebSocket snapshot, then restores the scroll position once the panel is visible. A position at the bottom follows the end of the replay and then each new reply; a position above the bottom stays in place as replies arrive. Closing a conversation clears its saved ID and scroll position. Stored harness/model preferences are reconciled with discovery; a missing model returns to the configured default.

Draft text remains saved until send acknowledgement, and reloading never submits it. Browser storage contains no transcript, snapshot images, page selections, drawings, tab-sharing permissions, or approval responses. Those remain owned by the server, page, or browser permission lifecycle.

## Event replay and commands

Connect to `/__devhost__/ws/chat?sessionId=<id>&pageURL=<page-url>` on the routed origin. Supply the same routed page URL for discovery, listing, attachment, and closure. The server checks the resolved project before attachment and again before every command, so an old socket cannot send into the previous checkout after a project switch. Chat mutations and WebSocket attachments require a matching `Origin` header.

The first frame is a `snapshot` with the current session, retained `events`, and `pendingRequestIds`. Each event has an increasing `sequence` and an unchanged native `payload`. Live `event` frames continue that sequence. `state` frames publish session metadata and authoritative pending request IDs.

Browser commands are:

| Type        | Fields                                                                                | Native action                                  |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `send`      | Nonempty `commandId` string, `text`, optional `model`, optional `images: [{dataURL}]` | Start a native turn with text and image blocks |
| `interrupt` | None                                                                                  | Interrupt the current native turn              |
| `respond`   | `requestId` as string or number, native `result`                                      | Answer one currently pending native request    |

Each send receives `{type: "command_result", sessionId, commandId, error?}` on its issuing socket after native execution accepts or rejects it. Validation and native turn-start failures carry an error; success omits it. Acknowledgements are not broadcast to other browsers or retained as native conversation events. Missing command IDs and malformed commands that cannot be correlated use generic `error` frames, as do rejected interrupt and response commands.

Claude Code runs with native user-message replay enabled. Devhost supplies a native message UUID and waits for the matching `user` replay before confirming the send; a correlated native error before replay rejects it. The replayed user message remains in history even if later inference fails. An empty send `model` restores the configured CLI default; an omitted model preserves the session's selected model. Codex resets use the effective project configuration or the native catalog's advertised default rather than assuming a null override clears sticky thread settings.

Text stays intact. Only PNG/JPEG base64 data URLs are accepted as image attachments. The complete UTF-8 WebSocket command, including JSON fields and text, must fit within 8 MiB; the browser checks this before transmission so a rejected send retains its draft. The server independently enforces that native frame limit. Remote image URLs and browser filesystem paths are not accepted.

## Permissions and failures

Native approvals, questions, and other control requests remain native messages. Devhost never approves a request automatically. It rejects invented, cancelled, or already-resolved request IDs. Claude Code's initialize response can restore pending native prompts; reconnecting browsers filter replay against `pendingRequestIds` so an answered historical prompt does not reappear as actionable.

A CLI authentication failure is an inference failure even when discovery succeeded. In Claude Code, a result with `is_error: true` remains an error even if its subtype says `success`; its native error text is retained. Sign in through the CLI's normal flow rather than entering credentials into the browser.

Explicit session closure sends WebSocket close code `1000`; stack shutdown sends `1001`. Slow readers have bounded writes. Cleanup removes connections from state before closing them and joins owned process groups, including uncooperative children.

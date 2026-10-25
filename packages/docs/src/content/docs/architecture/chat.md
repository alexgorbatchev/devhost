---
title: "Browser Chat Sessions"
---

The injected chat uses installed Codex and Claude Code clients. Codex runs its native app-server protocol; Claude Code runs its native stream-json protocol. The clients keep their configured authentication, permissions, settings, environment, and working directory. Devhost does not implement a separate model service or store browser API keys.

## Discovery and checkout ownership

`GET /__devhost__/chat/harnesses?pageURL=<page-url>&chatTarget=<target>` asks each installed client for its native model catalog without sending an inference request. Each harness reports `id`, `label`, `available`, `models`, and an optional error. A model exposes its selectable `id`, label and description. Discovery does not prove the account is signed in for inference.

Every chat request names a chat target, and the server maps it to the working directory:

- `project`: the page URL resolves a routed service and its selected checkout.
- `devhost`: the devhost source checkout that the stack serves its devtools from. Development builds from `just dev-bootstrap` or the source shim name their own checkout; `DEVHOST_DEV_SOURCE_DIR` overrides it. Without a source checkout the target is rejected with `400 Bad Request`, and `/__devhost__/config.json` reports an empty `devhostSourceRootPath`.

A missing or unknown target is rejected with `400 Bad Request`. Browsers cannot choose an executable, command flags, environment, or arbitrary working directory. Omitting a model preserves the client's configured default.

## Native sessions

`POST /__devhost__/chat/sessions` accepts:

```json
{
  "harness": "codex",
  "pageURL": "https://app.localhost/",
  "target": "project"
}
```

Optional `model` selects an advertised model; optional `resumeId` asks the native client to resume its own conversation ID. Codex uses its native thread start/resume operations. Claude Code receives its native resume argument. A resumed conversation still resolves its checkout from the supplied routed page and target.

The response contains `id`, `harness`, `projectRootPath`, `status`, an optional `nativeSessionId`, and an optional error. Native identity can arrive later, particularly before Claude Code's first turn. Status is `starting`, `idle`, `running`, `requires_action`, `closed`, or `error`.

`GET /__devhost__/chat/sessions?pageURL=<page-url>&chatTarget=<target>` returns only the records belonging to the directory that page and target resolve to. `POST /__devhost__/chat/sessions/<id>/close?pageURL=<page-url>&chatTarget=<target>` terminates and joins a session in that same directory and returns its record with status `closed`. A closed session stays listed with its retained events, so a page can offer it again and resume it through its native session ID. A session started with that ID as `resumeId` carries it as its `nativeSessionId` from the start and replaces the closed records of the same conversation (harness, directory, and native ID); sessions still running are kept. Cross-project attachment and closing return 404, and resuming a native ID already associated with another project is rejected. Interrupting a turn is a separate operation and leaves its session available.

Sessions and retained events are owned by the running stack. Reloading or closing a browser does not end an in-flight turn. New sessions follow a newly selected checkout; existing sessions retain the directory they started in. Stack shutdown stops and joins its processes. Full native replay is stored in a private temporary disk journal per session and streamed to reconnecting pages, keeping retained event data out of Go memory. On supported Unix hosts the journal is unlinked as soon as it is opened: its storage remains available through the owned descriptor and is reclaimed when that descriptor closes, including after a crash. A closed conversation retains its journal until it is replaced by a resumed session or the stack stops. Disk usage grows with retained history; a write failure reports an error and stops the native process rather than silently losing events. This journal is not a durable prompt queue across stack restarts; native clients own their own saved conversation history. The browser still receives and renders the full replay.

## Activity logs

Chat activity appears in foreground stack output and in the log minimap under `chat`. Each record carries the devhost session ID and harness. Native turn and tool IDs correlate activity where supplied; Claude turns receive session-local turn IDs.

- Session records cover startup, native session identification, resume, and closure. Startup and resume include the project directory and requested model. Turn starts report the selected or configured model when known; Claude's assistant frames also identify its observed model.
- Message records include the command ID, attachment count, queue wait, dispatch as a new turn or active-turn follow-up, and native acceptance or rejection time. They report receipt by the native client, separately from eventual turn completion.
- Turn and tool records include outcomes and durations, with tool names, paths or working directories, and native exit codes when available. Streamed and complete Claude tool blocks share one start record.
- Approval and input records include the native request ID, request kind, pending wait, cancellation or resolution, and response delivery outcome.
- After at least 30 seconds without a native event, an active turn emits a heartbeat at the next 30-second check with elapsed time, quiet time, active tool names, and pending-request count. Native traffic suppresses heartbeats; waiting for user input remains visible.
- Startup, protocol, process, timeout, and native error records include bounded diagnostics. Individual activity lines are limited to 2 KiB plus a truncation marker, with error details limited to 512 bytes.
- Codex reports turn token usage when its native usage notification is available. Claude reports result usage, native duration, and `total_cost_usd` as an estimate when supplied. Missing metrics remain unreported.

Activity summaries omit prompts, assistant text, screenshot data, tool arguments and output, and approval response contents. Tool paths, project paths, IDs, and bounded process stderr diagnostics can appear. Full native content remains in chat replay. Browser log retention uses the existing shared 512-entry buffer; terminal log storage follows the stack's normal output destination.

## Browser view persistence

The injected UI uses the shared Zustand settings store with `persist` and `createJSONStorage`. Local storage keys start with `devhost:settings:` and include the resolved project directory and page origin. Paths, query parameters, and fragments share settings so client-side navigation followed by reload retains the active conversation. Different project directories and origins remain isolated. The versioned payload contains chat visibility, chat target, panel side, selected harness and model, active devhost session ID, text draft, and conversation scroll position. The page's project store keeps chat visibility and the chat target. Conversation state (panel side, harness, model, session, draft, and scroll position) belongs to the target's directory, so the devhost target keeps its conversation under the devhost checkout's key and switching back restores the project's conversation. Zod validates saved settings; invalid data and unknown versions reset to defaults. Storage access and quota failures leave the in-memory UI usable.

On reload, the client lists the routed project's sessions and attaches the saved ID only if that record still exists and is not closed. It obtains messages and pending request IDs from the authoritative WebSocket snapshot, then restores the scroll position once the full conversation is expanded. Chat opens in the compact view after reload; expanding shows the retained full transcript. A position at the bottom follows the end of the replay and then each new reply; a position above the bottom stays in place as replies arrive. Closing a conversation clears its saved ID and scroll position and keeps the closed record in the conversation list. Stored harness/model preferences are reconciled with discovery; a missing model returns to the configured default.

Screenshot sends pause for a browser-side preview before any chat command is delivered. The user confirms a cropped area or the whole captured tab; cancellation rejects preparation and retains the draft and context. A cropped image is encoded as its own PNG, with its pixel bounds and original image dimensions recorded in page context. The full original image is not attached when an area is chosen. Preview state is temporary and is cancelled when sharing changes or chat unmounts.

Draft text remains saved until send acknowledgement, and reloading never submits it. Browser storage contains no transcript, snapshot images, page selections, drawings, tab-sharing permissions, or approval responses. Those remain owned by the server, page, or browser permission lifecycle.

## Event replay and commands

Connect to `/__devhost__/ws/chat?sessionId=<id>&pageURL=<page-url>&chatTarget=<target>` on the routed origin. Supply the same routed page URL and target for discovery, listing, attachment, and closure. The server checks the resolved project before attachment and again before every command, so an old socket cannot send into the previous checkout after a project switch. Chat mutations and WebSocket attachments require a matching `Origin` header.

The first frame is a `snapshot` with the current session, retained `events`, and `pendingRequestIds`. Each event has an increasing `sequence` and an unchanged native `payload`. Live `event` frames continue that sequence. `state` frames publish session metadata and authoritative pending request IDs.

Browser commands are:

| Type        | Fields                                                                                | Native action                                                |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `send`      | Nonempty `commandId` string, `text`, optional `model`, optional `images: [{dataURL}]` | Start a turn or steer active work with text and image blocks |
| `interrupt` | None                                                                                  | Interrupt the current native turn                            |
| `respond`   | `requestId` as string or number, native `result`                                      | Answer one currently pending native request                  |

Each send receives `{type: "command_result", sessionId, commandId, error?}` on its issuing socket after native execution accepts or rejects it. Validation and native turn-start failures carry an error; success omits it. Acknowledgements are not broadcast to other browsers or retained as native conversation events. Missing command IDs and malformed commands that cannot be correlated use generic `error` frames, as do rejected interrupt and response commands.

Claude Code runs with native user-message replay enabled. Devhost supplies a native message UUID and waits for the matching `user` replay before confirming the send; a correlated native error before replay rejects it. The replayed user message remains in history even if later inference fails. An empty send `model` restores the configured CLI default; an omitted model preserves the session's selected model. Codex resets use the effective project configuration or the native catalog's advertised default rather than assuming a null override clears sticky thread settings.

The server appends the current `[devtools.chat].prompt` to each nonempty send as a labeled user-message section, leaving native system prompts and permissions intact. Omission selects the worktree/validation/local-main merge/cleanup workflow; an empty string omits the section. Reloaded instructions apply to existing sessions on their next send. The browser collapses this section under **Workflow Instructions**.

Sends on a socket are ordered through a bounded delivery queue; approvals and interrupts remain readable while a send awaits native acknowledgement. Codex uses `turn/steer` with `expectedTurnId` when a turn is active, without model overrides. If native completion races a rejected steer, a new turn starts with that input; ambiguous transport failures are not retried. Claude uses native streaming user input while active, deferring model changes to the next new turn. The composer uses assistant-ui queue and image attachment adapters, and forwards pasted images together with captured page context. Browser queueing waits for delivery, not turn completion.

Only PNG/JPEG base64 data URLs are accepted as image attachments. The complete UTF-8 WebSocket command, including JSON fields and text, must fit within 8 MiB; the browser checks this before transmission so a rejected send retains its draft. The server independently enforces that native frame limit. Remote image URLs and browser filesystem paths are not accepted.

## Permissions and failures

Native approvals, questions, and other control requests remain native messages. Devhost never approves a request automatically. It rejects invented, cancelled, or already-resolved request IDs. Claude Code's initialize response can restore pending native prompts; reconnecting browsers filter replay against `pendingRequestIds` so an answered historical prompt does not reappear as actionable.

A CLI authentication failure is an inference failure even when discovery succeeded. A Codex turn completed with native status `failed` sets the session status to `error` and retains its native error message, or reports `Native Codex turn failed` when the message is absent. Completed and interrupted Codex turns return to `idle`; retryable error notifications leave the turn active until its final outcome. A failed turn ends active work while keeping the session available for another send, which clears the previous error and starts a new turn. In Claude Code, a result with `is_error: true` remains an error even if its subtype says `success`; its native error text is retained. Sign in through the CLI's normal flow rather than entering credentials into the browser.

Explicit session closure sends WebSocket close code `1000`; stack shutdown sends `1001`. Slow readers have bounded writes. Cleanup removes connections from state before closing them and joins owned process groups, including uncooperative children.

# Durable annotation queues for devtools agent sessions

## Objective

Implement durable FIFO annotation queues for devtools agent sessions so that annotations submitted while an agent is already working are not written directly into the running terminal session. The queue must survive browser reloads and `devhost` restarts, must drain automatically when the agent emits `OSC 1337; SetAgentStatus=finished`, and must be visible and editable from the injected devtools UI.

## Scope

This design covers:

- durable queue persistence on disk under the existing devhost state directory
- FIFO dispatch for annotations that target agent terminal sessions
- queue recovery after browser reload and `devhost` restart
- server-side tracking of agent status by parsing existing `SetAgentStatus` OSC sequences
- a devtools UI panel that shows outstanding queues and allows editing/removing queued work
- exact HTTP and websocket contracts for queue state and queue mutations
- failure handling for session exit, user termination, and corrupted queue files

## Non-goals

This implementation does **not** include:

- editing marker geometry, page URL/title, or source-location metadata after submission
- queue reordering; FIFO order remains fixed
- heuristics based on process idleness, shell prompts, or terminal silence
- preserving conversational context across `devhost` restarts; restart recovery replays the queued annotation into a fresh agent session
- changing the current product behavior where unchecking the active-session checkbox starts a separate agent session
- adding a manifest flag or configuration knob for queue behavior

## Current-system baseline

### `packages/devhost/src/devtools/features/terminalSessions/TerminalSessionPanel.tsx`

Current facts:

- The xterm instance locally parses `OSC 1337` and only recognizes:
  - `SetAgentStatus=working`
  - `SetAgentStatus=finished`
- Those OSC sequences only update the panel badge text via local `useState`.
- No status leaves the browser UI.
- Reloading the page loses the current working/finished knowledge until another OSC sequence arrives.

### `packages/devhost/src/devtools-server/startDevtoolsControlServer.ts`

Current facts:

- `POST /__devhost__/terminal-sessions` accepts both editor and agent requests.
- Agent request behavior today:
  - if `targetSessionId` matches a live, unexited terminal session, the server immediately writes a new prompt into that PTY
  - otherwise the server starts a brand-new agent terminal session
- There is no queue. A second annotation can be injected into an already working agent session immediately.
- Terminal session state is stored only in memory inside `terminalSessions: Map<string, ITerminalSessionState>`.
- The server retains terminal output text and forwards raw output to websocket clients, but it does not parse agent-status OSC sequences.
- `GET /__devhost__/terminal-sessions` restores only live terminal sessions after a browser reload. It does not restore pending annotation work.

### Related current behavior

- `packages/devhost/src/devtools/features/annotationComposer/AnnotationComposer.tsx` shows a `Send to active session` checkbox whenever an agent terminal session exists.
- `packages/devhost/src/devtools/features/terminalSessions/useTerminalSessions.ts` always appends/replaces a local terminal session when `POST /terminal-sessions` returns a `sessionId`, even when that `sessionId` already exists.
- `packages/devhost/src/agents/createAgentSessionFiles.ts` already configures built-in adapters to emit:
  - `SetAgentStatus=working`
  - `SetAgentStatus=finished`
- No annotation state is persisted to disk today.

## Chosen design

### Summary

The queue is owned by the devtools control server, not by the browser UI.

The implementation uses durable queues that are **bucketed by routed service identity** (`host` + normalized `path`) instead of one global queue:

- submitting with `targetSessionId` appends to that live agent session’s queue when it belongs to the same routed service
- submitting without `targetSessionId` reuses the existing queue for the same routed service when one already exists
- if no queue exists for that routed service yet, a new queue is created and dispatched
- each queue drains strictly FIFO within that queue
- multiple agent queues exist concurrently when a stack exposes multiple routed services

The queue state is persisted to a JSON file in the devhost state directory and mirrored to the injected UI via a dedicated authenticated websocket snapshot stream.

### Why this design

Rejected alternatives:

1. **UI-owned queue in React/Preact state or `localStorage`**
   - rejected because it cannot survive `devhost` restarts correctly
   - rejected because draining would stop whenever the page is closed or reloaded

2. **Server-owned in-memory queue only**
   - rejected because it loses queued work on `devhost` restart

3. **One global queue for all annotations**
   - rejected because it would mix unrelated routed services into one drain order

The selected design keeps queue ownership on the server while ensuring routed services do not accidentally share queue state.

## Engineering decisions

### Queue ownership and lifecycle

A queue exists only while it has outstanding work.

- A queue is created when an annotation is submitted to:
  - an existing live agent session, or
  - a new agent session request
- A queue is deleted as soon as its head item completes and no pending items remain.
- A live agent session with no outstanding queue does **not** keep an idle queue record.
- At most one queue is bound to a live terminal `sessionId` at a time.

### FIFO rule

FIFO is enforced per queue.

- `pendingEntries[0]` is always the next annotation to dispatch.
- The UI does not expose reordering actions.
- Editing an entry never changes its position.

### Durability rule

All queue mutations are serialized and persisted **before** external side effects occur.

That means:

- enqueue persists before any prompt is written or any new agent PTY is launched
- finish/promotion persists before the next prompt is written or next PTY is launched
- delete/edit persists before the mutation response is returned

This guarantees that queued work is not lost if `devhost` crashes between state transition and dispatch.

### Recovery rule

Recovery is intentionally **at-least-once** for the current in-flight annotation.

If `devhost` stops after an annotation was already written into an agent session but before that session later emits `SetAgentStatus=finished`, the head annotation is replayed into a fresh session on recovery unless the queue was explicitly paused by the user.

This design chooses durability over exactly-once replay.

## File and module plan

### New files

#### Server

- `packages/devhost/src/devtools-server/createAnnotationQueueStore.ts`
  - owns runtime queue state
  - loads and persists durable queue state
  - serializes mutations
  - binds queues to live terminal sessions
  - dispatches queued annotations into existing sessions or newly started sessions
  - exposes snapshot, enqueue, edit, delete, resume, session-exit, and agent-status handlers

- `packages/devhost/src/devtools-server/parseAgentStatusOsc.ts`
  - incremental parser for `OSC 1337;SetAgentStatus=...`
  - supports BEL (`\x07`) and ST (`\x1b\\`) terminators
  - handles split terminal chunks without dropping or double-processing status events

- `packages/devhost/src/devtools-server/__tests__/createAnnotationQueueStore.test.ts`
  - unit coverage for queue state transitions, persistence, recovery, and editing rules

- `packages/devhost/src/devtools-server/__tests__/parseAgentStatusOsc.test.ts`
  - unit coverage for split-chunk OSC parsing and accepted terminators

#### Devtools UI

- `packages/devhost/src/devtools/features/annotationQueue/types.ts`
  - shared queue contracts used by the UI and the control server

- `packages/devhost/src/devtools/features/annotationQueue/useAnnotationQueues.ts`
  - authenticated websocket subscription for queue snapshots
  - authenticated `PATCH`, `DELETE`, and `POST /resume` calls
  - UI-local mutation pending/error state

- `packages/devhost/src/devtools/features/annotationQueue/AnnotationQueuePanel.tsx`
  - queue visualization and editing UI

- `packages/devhost/src/devtools/features/annotationQueue/index.ts`
  - feature exports

- `packages/devhost/src/devtools/features/annotationQueue/stories/AnnotationQueuePanel.stories.tsx`
  - Storybook coverage for active, paused, and multi-queue states

- `packages/devhost/src/devtools/features/annotationQueue/__tests__/AnnotationQueuePanel.test.tsx`
  - rendering and interaction tests

- `packages/devhost/src/devtools/features/annotationQueue/__tests__/useAnnotationQueues.test.ts`
  - websocket snapshot parsing and mutation call tests

### Modified files

- `packages/devhost/src/services/startStack.ts`
  - pass `manifest.manifestPath`
  - pass `managedCaddyPaths.stateDirectoryPath`
  - pass the package logger into `startDevtoolsControlServer`

- `packages/devhost/src/devtools-server/startDevtoolsControlServer.ts`
  - create and own `AnnotationQueueStore`
  - add queue HTTP routes and websocket topic
  - route agent submissions through the queue store
  - parse agent-status OSC sequences from PTY output
  - notify the queue store when sessions close or exit
  - resume persisted queues on startup
  - preserve queue state on shutdown

- `packages/devhost/src/devtools/shared/constants.ts`
  - add queue HTTP and websocket paths

- `packages/devhost/src/devtools/App.tsx`
  - mount `AnnotationQueuePanel` in the corner dock

- `packages/devhost/src/devtools/features/annotationComposer/AnnotationComposer.tsx`
  - update copy to queue-oriented language
  - rename the checkbox label to match queue semantics

- `packages/devhost/src/devtools/features/terminalSessions/useTerminalSessions.ts`
  - do not replace an existing local terminal session when the server returns an already-known `sessionId`

- `packages/devhost/src/devtools-server/__tests__/startDevtoolsControlServer.test.ts`
  - integration coverage for queue endpoints, websocket snapshots, and automatic draining

- `packages/devhost/src/devtools/features/terminalSessions/__tests__/useTerminalSessions.test.ts`
  - verify duplicate `sessionId` submissions keep the existing local session entry

- `packages/devhost/README.md`
  - document durable annotation queues and the OSC requirement

- `packages/www/src/app/App.tsx`
  - mirror the README user-facing queue behavior

## Persisted data model

### Persisted JSON file location

The queue file path is:

```ts
join(
  stateDirectoryPath,
  "devtools",
  "annotation-queues",
  `${sanitizeFileSegment(stackName)}-${sha256(manifestPath).slice(0, 12)}.json`,
);
```

Rules:

- `stateDirectoryPath` comes from `managedCaddyPaths.stateDirectoryPath`
- `sanitizeFileSegment` replaces any character outside `[A-Za-z0-9._-]` with `-`
- the directory is created with mode `0o700`
- the file is written with mode `0o600`
- writes use `write temp file -> fsync/flush -> rename` semantics in the same directory

### Persisted TypeScript types

```ts
type PersistedAnnotationQueuePauseReason = "session-exited-before-finished" | "shutdown" | "user-terminated" | null;

interface IPersistedAnnotationQueueEntry {
  annotation: IAnnotationSubmitDetail;
  createdAt: number;
  entryId: string;
  updatedAt: number;
}

interface IPersistedAnnotationQueueRecord {
  currentEntry: IPersistedAnnotationQueueEntry;
  pauseReason: PersistedAnnotationQueuePauseReason;
  pendingEntries: IPersistedAnnotationQueueEntry[];
  queueId: string;
}

interface IPersistedAnnotationQueueState {
  queues: IPersistedAnnotationQueueRecord[];
  version: 1;
}
```

Persisted invariants:

- `version` is always `1`
- a persisted queue always has `currentEntry`
- `pendingEntries` are ordered oldest-first
- empty queues are not written to disk
- live `sessionId` values are **not** persisted

## Runtime state model

### Shared queue contracts

`packages/devhost/src/devtools/features/annotationQueue/types.ts` will define:

```ts
export type AnnotationQueueStatus = "launching" | "working" | "paused";

export type AnnotationQueueEntryState = "active" | "paused-active" | "queued";

export type AnnotationQueuePauseReason = "session-exited-before-finished" | "user-terminated";

export interface IAnnotationQueueEntrySnapshot {
  annotation: IAnnotationSubmitDetail;
  createdAt: number;
  entryId: string;
  state: AnnotationQueueEntryState;
  updatedAt: number;
}

export interface IAnnotationQueueSnapshot {
  activeSessionId: string | null;
  entries: IAnnotationQueueEntrySnapshot[];
  pauseReason: AnnotationQueuePauseReason | null;
  queueId: string;
  status: AnnotationQueueStatus;
}

export interface IListAnnotationQueuesResponse {
  queues: IAnnotationQueueSnapshot[];
}

export interface IUpdateAnnotationQueueEntryRequest {
  comment: string;
}

export interface IAnnotationQueueMutationResponse {
  success: true;
}

export interface IResumeAnnotationQueueResponse {
  sessionId: string;
  success: true;
}

export interface IAnnotationQueuesSnapshotMessage {
  queues: IAnnotationQueueSnapshot[];
  type: "snapshot";
}

export type AnnotationQueueServerMessage = IAnnotationQueuesSnapshotMessage;
```

### Runtime-only queue fields

Inside `createAnnotationQueueStore.ts`, each queue record also keeps non-persisted runtime fields:

```ts
interface IRuntimeAnnotationQueueRecord extends IPersistedAnnotationQueueRecord {
  activeSessionId: string | null;
  oscCarryover: string;
  status: AnnotationQueueStatus;
}
```

Runtime invariants:

- `status === "paused"` implies `activeSessionId === null`
- `entries[0]` in the snapshot is always the head item
- `entries[0].state` is:
  - `"active"` when `status` is `launching` or `working`
  - `"paused-active"` when `status` is `paused`
- all later entries have `state === "queued"`
- only `queued` and `paused-active` entries are editable/deletable

## State transitions

### Queue creation

1. `POST /terminal-sessions` receives an agent request.
2. The server resolves the target queue:
   - `targetSessionId` present and bound to a same-service live queue → use that queue
   - routed-service bucket already exists → use that queue, even if the request did not include `targetSessionId`
   - `targetSessionId` present and same-service live session exists but no queue exists yet → create a new queue bound to that session
   - no matching routed-service queue exists → create a new queue with no bound session yet
3. The submitted annotation becomes:
   - `currentEntry` when the queue is newly created
   - the last item in `pendingEntries` when the queue already exists
4. The new durable state is persisted.
5. If the queue has no active live session and is not paused-by-user, dispatch starts immediately.

### Dispatch

Dispatch algorithm for a queue head:

1. Persist queue state with `status = "launching"`.
2. If `activeSessionId` points at a live, unexited agent terminal session, write the rendered prompt into that PTY.
3. Otherwise start a new agent terminal session using the current head annotation and bind `activeSessionId` to the new `sessionId`.
4. Publish a fresh websocket snapshot.
5. Wait for terminal output to emit `SetAgentStatus=working` or `SetAgentStatus=finished`.

### `working` status

When a bound session emits `SetAgentStatus=working`:

- update the queue `status` to `working`
- persist the new state
- publish a fresh websocket snapshot

### `finished` status

When a bound session emits `SetAgentStatus=finished`:

1. Remove `currentEntry` from the queue.
2. If `pendingEntries.length > 0`:
   - promote `pendingEntries[0]` into `currentEntry`
   - remove it from `pendingEntries`
   - persist the promoted state
   - dispatch the new head immediately into the same live session if it still exists, otherwise start a new session
3. If no pending entries remain:
   - delete the queue record
   - persist the empty overall queue state
4. Publish a fresh websocket snapshot.

### User termination

When the browser sends `TerminalSessionClientMessage { type: "close" }` for a live agent session that still has a queue head:

- convert the queue to:
  - `status = "paused"`
  - `activeSessionId = null`
  - `pauseReason = "user-terminated"`
- keep the current head annotation as `currentEntry`
- do not auto-start a replacement session
- persist and publish the paused state

### Unexpected session exit before `finished`

When the PTY exits and the bound queue head has not completed:

- convert the queue to:
  - `status = "paused"`
  - `activeSessionId = null`
  - `pauseReason = "session-exited-before-finished"`
- keep `currentEntry`
- do not auto-start a replacement session during the same runtime
- persist and publish the paused state

### Resume

Resuming a paused queue:

1. keep the current head item unchanged
2. clear `pauseReason`
3. persist
4. dispatch the head, creating a new live agent session
5. return that new `sessionId`

### Shutdown

When `devhost` shuts down normally:

- all live queues are persisted with:
  - `activeSessionId = null`
  - `status = "paused"`
  - `pauseReason = "shutdown"`
- session shutdown then proceeds
- on the next `devhost` startup:
  - queues with `pauseReason !== "user-terminated"` auto-resume
  - queues with `pauseReason === "user-terminated"` stay paused until resumed from the UI

## Terminal OSC parsing

### Parser behavior

`parseAgentStatusOsc.ts` will implement an incremental parser with this exact matching rule:

```ts
const oscPrefix = "\x1b]1337;SetAgentStatus=";
const statuses = new Set(["working", "finished"]);
```

Accepted terminators:

- BEL: `\x07`
- ST: `\x1b\\`

Algorithm:

1. append the new decoded output chunk to `oscCarryover`
2. scan from the first `oscPrefix`
3. if a full terminator is present, emit exactly one status event and continue scanning the remaining suffix
4. if the prefix is present but no terminator is present yet, keep the incomplete suffix in `oscCarryover`
5. if no prefix is present, truncate `oscCarryover` to the last `oscPrefix.length` characters

The raw PTY output is still forwarded to the terminal websocket unchanged.

## HTTP and websocket contracts

### Added constants

`packages/devhost/src/devtools/shared/constants.ts` will add:

```ts
export const ANNOTATION_QUEUES_PATH: string = `${CONTROL_PATH_PREFIX}/annotation-queues`;
export const ANNOTATION_QUEUES_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/annotation-queues`;
```

### Authentication

All queue routes and the queue websocket require the existing control token.

- HTTP routes use `x-devhost-control-token`
- websocket uses the existing `token` query parameter

### HTTP routes

#### `GET /__devhost__/annotation-queues`

Response:

```ts
IListAnnotationQueuesResponse;
```

#### `PATCH /__devhost__/annotation-queues/:entryId`

Request body:

```ts
IUpdateAnnotationQueueEntryRequest;
```

Validation:

- `comment` must be a string
- `comment.trim().length > 0`
- the target entry must exist
- the target entry must not be in `active` state

Success response:

```ts
IAnnotationQueueMutationResponse;
```

Failure responses:

- `400` invalid payload
- `403` invalid control token
- `404` entry not found
- `409` entry is active and not editable

#### `DELETE /__devhost__/annotation-queues/:entryId`

Rules:

- `queued` and `paused-active` entries are deletable
- `active` entries are not deletable
- deleting `paused-active` promotes the next pending entry to the head if one exists
- deleting the last remaining entry removes the queue

Success response:

```ts
IAnnotationQueueMutationResponse;
```

Failure responses:

- `403` invalid control token
- `404` entry not found
- `409` entry is active and not deletable

#### `POST /__devhost__/annotation-queues/:queueId/resume`

Success response:

```ts
IResumeAnnotationQueueResponse;
```

Failure responses:

- `403` invalid control token
- `404` queue not found
- `409` queue is not paused
- `500` launching a replacement agent session failed

### Queue websocket

#### `GET /__devhost__/ws/annotation-queues?token=...`

Server message:

```ts
IAnnotationQueuesSnapshotMessage;
```

Rules:

- on websocket open, the server immediately sends one full snapshot
- every successful queue mutation publishes one new full snapshot
- every automatic drain transition publishes one new full snapshot
- the queue websocket is read-only; all mutations use HTTP

## UI behavior

### Placement

`AnnotationQueuePanel` renders inside the existing `cornerDockClassName` in `packages/devhost/src/devtools/App.tsx`, directly below `ServiceStatusPanel`.

Render rule:

- render when `queues.length > 0`
- render when the queue hook has an error message
- otherwise render nothing

### Panel layout

For each queue card:

- header title: `Annotation queue`
- header meta line:
  - `{agentDisplayName}`
  - current status badge: `Launching`, `Working`, or `Paused`
  - item count: `{entries.length} item` / `{entries.length} items`
- body entries are shown in dispatch order, head first

Each entry row shows:

- comment text
- marker count
- page title
- URL host
- submitted timestamp

### Editing behavior

#### `active` entry

- rendered read-only
- no save button
- no delete button

#### `paused-active` entry

- rendered in an editable textarea
- `Save` button updates only `annotation.comment`
- `Remove` button removes the head item from the paused queue
- if the paused queue still has entries after removal, the next queued item becomes the new `paused-active` head

#### `queued` entry

- rendered in an editable textarea
- `Save` button updates only `annotation.comment`
- `Remove` button removes the queued item in place

### Pause affordance

When `queue.status === "paused"`, the queue card shows:

- a descriptive reason message
  - `user-terminated` → `Session terminated. Edit the head annotation or resume the queue.`
  - `session-exited-before-finished` → `Session exited before the annotation finished. Resume to retry.`
- a `Resume` button

The `Resume` button is disabled while the resume request is in flight.

### Composer copy changes

`packages/devhost/src/devtools/features/annotationComposer/AnnotationComposer.tsx` will change copy as follows:

- popup meta while submitting:
  - from `Starting ${agentDisplayName} session…`
  - to `Submitting annotation…`
- submit button label while pending:
  - from `Starting ${agentDisplayName}…`
  - to `Submitting…`
- active-session checkbox label:
  - from `Send to active session`
  - to `Append to active session queue`

No other annotation-composer interaction changes are introduced.

## Server integration details

### `startDevtoolsControlServer.ts`

#### New option fields

`IStartDevtoolsControlServerOptions` must add:

```ts
manifestPath: string;
stateDirectoryPath: string;
logger: IDevhostLogger;
```

#### Queue startup flow

`startDevtoolsControlServer()` must:

1. create the queue store before starting request handling
2. start Bun.serve
3. after the server port is known, call `annotationQueueStore.resumePersistedQueues()`
4. only then return the control server handle

#### Agent submission flow

`POST /terminal-sessions` for `request.kind === "agent"` must no longer inject prompts directly in the route handler.

Instead it must call:

```ts
annotationQueueStore.enqueue(request.annotation, request.targetSessionId);
```

and return:

```ts
{
  sessionId: string;
}
```

Where `sessionId` is:

- the existing live session id when the queue targets a live session
- the newly created session id when the queue starts a new session immediately

#### Session close/exit hooks

`closeTerminalSession()` must notify the queue store when the session being closed is a bound queue session.

Two distinct hooks are required:

- user-requested close from websocket message → `handleUserClosedSession(sessionId)`
- PTY exit promise resolution → `handleSessionExited(sessionId)`

#### Output hook

`appendTerminalSessionOutput()` must:

1. decode the output chunk as it already does
2. if `session.request.kind === "agent"`, feed the decoded text into `parseAgentStatusOsc()`
3. forward each parsed status to `annotationQueueStore.handleAgentStatus(sessionId, status)`
4. continue publishing the raw output chunk to websocket subscribers unchanged

### `useTerminalSessions.ts`

When `POST /terminal-sessions` returns an already-known `sessionId`, the hook must keep the existing local session object unchanged.

Exact rule:

```ts
if (currentSessions.some((session) => session.sessionId === responseBody.sessionId)) {
  return currentSessions;
}
```

Only previously unseen `sessionId` values are appended.

This prevents queue appends from overwriting the tray summary for an already-open session.

## Validation and repair behavior

### Queue file load

Load behavior is exact:

1. if the file does not exist, start from `{ version: 1, queues: [] }`
2. if the file is unreadable JSON or has an invalid top-level shape:
   - move it to `*.corrupt-<timestamp>.json`
   - log one `logger.error(...)`
   - start from an empty state
3. if individual queue records are partially invalid:
   - drop only the invalid queue record
   - keep valid queue records
4. if a queue has an invalid `pendingEntries` item:
   - drop only that invalid item
5. if a queue has no valid `currentEntry` but still has valid `pendingEntries`:
   - promote the first pending item to `currentEntry`
6. if a queue becomes empty after repair:
   - drop it entirely

### Mutation validation

- `enqueue` rejects annotations that fail the existing `isAnnotationSubmitDetail()` validation
- `PATCH` rejects blank trimmed comments
- `PATCH` and `DELETE` reject active entries with `409`
- `resume` rejects non-paused queues with `409`

## Security considerations

- Queue endpoints and the queue websocket use the existing control token.
- Persisted queue files contain source paths, page URLs, page titles, and user-authored comments. They are stored under the existing devhost state directory with owner-only permissions.
- Queue editing updates only `annotation.comment`. Marker snapshots and source locations are immutable after capture.
- Queue entry ids and queue ids are treated as opaque identifiers. They are never interpolated into filesystem paths.
- The queue implementation does not execute edited comments. Edited comments flow only into the existing prompt-file generation path already used for annotations.
- No host-page script receives direct access to queue data except through the injected devtools control token.

## Implementation order

1. **Add shared queue contracts and constants**
   - create `annotationQueue/types.ts`
   - add queue route constants

2. **Implement the server-side queue store**
   - create `createAnnotationQueueStore.ts`
   - create `parseAgentStatusOsc.ts`
   - add unit tests for state transitions and persistence

3. **Integrate the queue store into the control server**
   - wire enqueue into `POST /terminal-sessions`
   - add queue HTTP routes
   - add queue websocket topic
   - wire PTY output parsing
   - wire session close and exit notifications
   - add startup resume and shutdown persistence
   - extend integration tests in `startDevtoolsControlServer.test.ts`

4. **Update the browser UI**
   - add `useAnnotationQueues.ts`
   - add `AnnotationQueuePanel.tsx`
   - mount it in `App.tsx`
   - add panel tests and story

5. **Align existing session/composer behavior**
   - prevent duplicate-session replacement in `useTerminalSessions.ts`
   - update queue-oriented copy in `AnnotationComposer.tsx`

6. **Update user-facing docs**
   - update `packages/devhost/README.md`
   - mirror the same behavior in `packages/www/src/app/App.tsx`

## Test plan

### Unit tests

#### `createAnnotationQueueStore.test.ts`

Add exact coverage for:

- enqueue to a new queue persists the head entry and starts a new session
- enqueue to an existing bound live session appends in FIFO order without starting a new session
- `working` status updates queue status only
- `finished` status removes the head and dispatches the next queued item
- a queue with one entry is deleted after `finished`
- paused queue resume starts a replacement session
- deleting a queued item preserves order of remaining items
- deleting a `paused-active` head promotes the next entry to the head
- editing a queued item updates only `annotation.comment`
- editing an active item throws/returns conflict
- corrupted persisted files are repaired as specified
- persisted queues auto-resume on startup unless `pauseReason === "user-terminated"`

#### `parseAgentStatusOsc.test.ts`

Add exact coverage for:

- single complete `working` sequence
- single complete `finished` sequence
- multiple sequences in one chunk
- prefix split across chunks
- terminator split across chunks
- BEL and ST terminators
- unrelated OSC sequences ignored

### Integration tests

#### `startDevtoolsControlServer.test.ts`

Extend with coverage for:

- `POST /terminal-sessions` enqueues instead of directly writing when targeting an already-live agent session
- `GET /annotation-queues` returns a full snapshot
- queue websocket sends an initial snapshot and subsequent updates
- `PATCH /annotation-queues/:entryId` edits a queued comment
- `DELETE /annotation-queues/:entryId` removes a queued item
- `POST /annotation-queues/:queueId/resume` starts a replacement session for a paused queue
- parsed `SetAgentStatus=finished` causes the next annotation to be written into the same live session
- queue state survives control-server restart by reloading from disk

### UI tests

#### `AnnotationQueuePanel.test.tsx`

Add exact coverage for:

- hidden when empty and no error
- renders multiple queues and entries in correct order
- active entry is read-only
- queued entry is editable
- paused-active entry is editable
- pause reason text and `Resume` button render correctly
- save/remove button disabled while mutation is pending

#### `useAnnotationQueues.test.ts`

Add exact coverage for:

- parses websocket snapshot messages
- attaches control token to websocket query params
- sends authenticated `PATCH`, `DELETE`, and `POST /resume` requests
- surfaces server errors

#### `useTerminalSessions.test.ts`

Replace the placeholder assertion with coverage that duplicate `sessionId` responses do not replace the existing session entry.

## Definition of done

The implementation is done when all of the following are true:

- submitting an annotation to an already-live agent session never writes directly into the PTY without first entering the queue state machine
- queued annotations drain in FIFO order per queue
- queue state survives browser reloads
- queue state survives `devhost` restarts via disk persistence
- `SetAgentStatus=finished` emitted in terminal output causes the next queued annotation to dispatch automatically
- queue state is visible in the injected devtools UI
- queued and paused-head entries can be edited and removed from the UI
- paused queues can be resumed from the UI
- active live entries are not editable or removable
- duplicate `sessionId` responses no longer overwrite existing local terminal sessions
- queue file corruption is handled without crashing `devhost`
- the queue routes and websocket require the control token
- package tests pass
- `packages/devhost/README.md` and `packages/www/src/app/App.tsx` describe the new queue behavior accurately

## Review guardrails

Implementation review must reject changes that do any of the following:

- put queue ownership in the browser UI instead of the control server
- store the queue only in memory
- collapse all routed services into one shared queue bucket
- reorder queued items
- allow editing or deleting a live active entry
- infer completion from idle output, shell prompts, or timers instead of the existing OSC sequence
- persist live `sessionId` values as durable recovery identifiers
- expose queue routes without the control token
- update README without updating `packages/www/src/app/App.tsx`

## Ambiguity sweep

Resolved choices in this document:

- queue owner: **devtools control server**
- queue granularity: **per agent session / per targeted conversation**
- persistence medium: **JSON file in devhost state dir**
- dispatch trigger: **parsed `SetAgentStatus=finished` OSC**
- crash semantics: **at-least-once replay for the current head annotation**
- editable fields: **comment only**
- reorder support: **not implemented**
- paused-queue recovery: **explicit Resume button; auto-resume after restart except user-terminated queues**
- websocket payload style: **full snapshot only**
- duplicate local terminal-session handling: **ignore already-known `sessionId` values**

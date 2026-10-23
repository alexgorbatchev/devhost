---
title: "Browser Chat and Page Context"
sidebar:
  order: 10
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/annotations.webp" aria-label="annotations demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/annotations.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

:::note[Video coverage]
The published film demonstrates the terminal-based annotation workflow. Browser chat, drawing tools, and tab sharing are described below and have no current demo film.
:::

Open **Chat** in the injected toolbar to talk to an installed coding agent while working on your page. The chat panel can move to either side of the viewport or collapse while its conversation continues. The message composer stays at the bottom of the panel with compact spacing, including before your first message. Typing or clearing a single-line draft keeps it in place.

## Connect an installed CLI

Install and sign in to the [Codex CLI](https://learn.chatgpt.com/docs/cli) or [Claude Code](https://code.claude.com/docs/en/cli-reference) on the machine running devhost. Devhost launches the installed client with its existing account, settings, environment, and selected checkout. Enter no API key into the browser.

Open **Chat Settings** using the gear button. Choose **Harness**, then select a model advertised by that client's native catalog. **Configured default** restores the CLI's configured model for the next turn, including after selecting another model or resuming a conversation. **Refresh Harnesses** repeats discovery; discovery can succeed even when the account needs to sign in before inference. A native authentication failure is displayed in the conversation; sign in through the CLI and retry.

Chat Settings receives pointer input above the page and chat panel. Its backdrop blocks clicks on page controls until the dialog closes; closing it restores ordinary page interaction.

Type a message and send it through the browser composer. Opening chat places the cursor in the composer. Agent replies and native tool activity stream into the conversation, which keeps the latest reply in view while you are at the bottom; scroll back and the conversation stays where you left it until you return to the bottom. Claude Code confirms receipt by replaying the actual user message into the conversation; a later model or authentication failure keeps that submitted message in history. The **New Conversation** (+) button beside **Share Tab** starts a separate native session; **Conversation** in Chat Settings selects an existing session. New Conversation is disabled while connecting, preparing a send, running a turn, or waiting for a native response. Collapsing the panel does not terminate it. Interrupt, or Escape in the composer, cancels the current turn, while **Close Conversation** ends its owned process and returns the panel to a new conversation. The closed conversation stays in **Conversation**, marked `closed`; selecting it resumes the CLI's own saved session in a new process, which then takes its place in the list.

Live sessions and retained events belong to the running devhost stack, so a page reload can reconnect. Stopping devhost ends its processes. Session replay in the browser is not a separate durable queue or an automatic replay of prompts after a stack restart.

Reloading restores whether chat is expanded or collapsed, its side, unsent text, harness and model choices, and the selected live conversation, including after navigating to another page in the same project and origin. The conversation continues until you choose New Conversation, select another conversation, or close it. The conversation's scroll position is restored after its history arrives; a view left at the bottom opens at the latest reply. These settings use browser local storage, separately for each project and origin (scheme, hostname, and port); paths, query parameters, and fragments share the same conversation. A missing or closed conversation is not restarted automatically, and an unavailable model returns to **Configured default**. Prompts and permission responses are never resent on reload.

If browser storage is unavailable or full, chat continues working but cannot save further changes across reloads. Page selections, drawings, and tab sharing do not survive reload.

Client-side navigation within the same project keeps the conversation, draft, and selected harness and model. Switching to a different project resets the browser panel's project-specific state. Context sent with a message uses the current page URL.

## Chat about devhost itself

A development build of devhost knows its own source checkout: `just dev-bootstrap` and the source shim behind `just run`, `just cli`, and `just run-ai` record it at build time. Release builds do not. With a source checkout, the chat header shows a **Chat Directory** switch with **Project** and **devhost**. Choose **devhost** when the problem is in devhost rather than in your app: new conversations then run the agent in the devhost checkout, and the conversation list shows only conversations started there. Choose **Project** to return to your app's conversation, which is restored as you left it. The choice is remembered for each project and origin.

The directory also decides what you annotate. With **devhost**, devhost's own UI is the subject: you can select its toolbar, panels, and chat as context, and selections and drawings paint over them. With **Project**, the page is the subject: devhost's toolbar, panels, and chat stay above selections and drawings and keep working while you select. Switching the directory clears the current selections and drawings.

The same build serves the devtools UI from that checkout and rebuilds it when its sources change, so after an agent edits the UI, reloading the page shows the change. Go changes need the binary rebuilt and devhost restarted: rerun `just dev-bootstrap`, or restart the source stack, which rebuilds on start. Stopping devhost also ends its chat sessions, so restart it after the agent's turn has finished. If the recorded checkout has moved or been deleted, devhost prints a warning at startup, serves the UI built into the binary, and hides the switch.

## Select page context

1. Choose **Select Elements** in the floating toolbar at the top of the page, or hold Alt (Option on macOS). Alt works while you type in the chat composer, but not while you type in one of the page's own fields.
2. Click one or more page elements to add numbered markers. Devhost controls keep working during selection. With the **devhost** chat directory, devhost UI elements are selectable too, and clicking a devhost control selects it without activating it. Releasing Alt ends selection mode without discarding the context.
3. Write your request in the chat composer, referring to markers such as #1 and #2.
4. Send the message. If you have not already shared the tab, choose the current tab in the browser's sharing picker.

Selecting elements opens chat and places the cursor in the composer, so you can describe the selection straight away. Escape leaves selection or drawing mode, also while you type in the composer, so the page accepts ordinary interactions. The instruction tip follows the pointer without moving the chat layout. Use the remove button beside any element or drawing to discard just that item, or **Clear Page Context** to discard all context. A successfully submitted message clears its markers and drawings so the next message starts with fresh context. Cancelled sharing and failed sends retain context. In conversation history, the attached **Page Context** section is collapsed by default; expand it to inspect the metadata.

Selected element metadata includes its path, nearby text, accessibility information, bounds and computed styles. React development source locations and fetchable source maps are used when the host exposes them; source resolution remains best effort.

Selection highlights and drawings render above page content, including the page's open Popover API panels and modal `<dialog>` elements. They stay beneath devhost's toolbar, panels, and chat, unless the **devhost** chat directory makes devhost's UI the subject; then they render above it too. The floating annotation tools always render on top. Tools and chat stay usable while a modal is open, so you can annotate it and send the snapshot without closing it. Annotation controls stay inside the active popup's interaction scope without moving or reopening the target itself. Escape ends selection or drawing without dismissing that popup; another Escape follows its normal close behavior. Separate inspector windows and browser-controlled dialogs, such as `window.alert()`, are outside the page canvas.

## Draw over the page

Choose **Arrow**, **Line**, or **Box** from the floating toolbar, then drag on the visible page. With the **devhost** chat directory you can also draw over the devhost toolbar and chat panel; otherwise they stay above your drawings and receive the pointer. Each completed drawing ends drawing mode, appears in **Page context**, and places the cursor in the composer. Drag an existing drawing by its stroke to move it. Escape cancels an in-progress move or drawing. Use **Undo Drawing** to remove the most recent shape, or remove any drawing individually from the context list. Drawing coordinates and selected element metadata accompany the captured image.

## Share one tab snapshot

Sending text without page context does not open the sharing picker. Use **Share Tab** beside **Send Message** to share ahead of time. Sending selected elements or drawings captures the active share, or opens the sharing picker when there is no active share, so the agent receives the visible page and its annotations as one PNG image.

Choose the current tab so the image matches the selected elements and drawings. The browser owns that choice; preferring the current tab does not prevent choosing another browser tab. Window and entire-screen captures are rejected. Screen capture requires a supporting browser in a secure context, such as the routed HTTPS page.

A share opened through **Share Tab** stays active for subsequent snapshots until you choose **Stop Sharing**, stop it in the browser, reload, or unmount the chat integration. Collapsing chat keeps that share active. Each message takes a fresh snapshot; it does not send continuous video. A share opened directly by sending a message stops after that snapshot, including on failure. Browser sharing permission is not persisted after the stream ends. Cancelling the picker retains the message draft and sends no context. Conversation, harness, and model controls stay locked while a send is being prepared or confirmed, so sharing cannot redirect it to another conversation. The complete encoded message, including PNG/JPEG attachments, must fit within 8 MiB; the selected client and model must accept the image input.

The configured coding agent receives the message, selected metadata, page URL/title, drawing coordinates, and image. Review what is visible before sharing.

Snapshots hide the floating annotation tools, instruction tip, and devhost tooltips, including tooltips still fading out after a click. Tooltips stay hidden even when an annotation overlaps them. Chat and the other devhost surfaces are hidden too. With the **devhost** chat directory, a devhost surface that a selected element or drawing overlaps stays visible in the image sent to the agent.

Before accepting the snapshot, devhost waits for the image to visibly change where each hidden surface was shown. Animation elsewhere on the page does not satisfy this check. If capture cannot confirm those changes within ten seconds, or the tab changes capture size during preparation, the send fails and retains your draft and context so you can retry. An already active share remains available.

## Native permissions and questions

Native tool approval and user-input requests require an explicit answer. Devhost forwards the native request details and never approves them automatically. A resolved or cancelled request cannot be answered again. If a native prompt is unsupported by the browser controls, its preserved details remain available; no response is fabricated.

## Configuration

Both settings default to true:

```toml
[devtools.chat]
enabled = true

[devtools.annotations]
enabled = true
```

Disable annotations to keep ordinary chat without page-selection and drawing controls. Disable chat to remove the browser chat entry and its native control routes. Changing devtools settings requires restarting the stack. External IDE source links use the separate editor setting.

## Annotation selection plugin contract

```ts
type AnnotationSelectionIntent = "hover" | "select";

interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IAnnotationSourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface IAnnotationMarkerPayload {
  accessibility: string;
  boundingBox: IRectSnapshot;
  computedStyles: string;
  computedStylesObj: Record<string, string>;
  cssClasses: string;
  element: string;
  elementPath: string;
  fullPath: string;
  isFixed: boolean;
  markerNumber: number;
  nearbyElements: string;
  nearbyText: string;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
}

interface IAnnotationSelectionCandidate {
  id: string;
  label: string;
  readRect(): IRectSnapshot | null;
  buildMarkerPayload(markerNumber: number): Promise<IAnnotationMarkerPayload>;
}

interface IAnnotationSelectionPluginContext {
  isDevtoolsEventTarget(target: EventTarget | null): boolean;
}

interface IAnnotationSelectionPlugin {
  id: string;
  label: string;
  priority?: number;
  matches?(): boolean;
  getCursorStyleText?(): string | null;
  resolveCandidate(
    event: MouseEvent,
    intent: AnnotationSelectionIntent,
    context: IAnnotationSelectionPluginContext,
  ): IAnnotationSelectionCandidate | Promise<IAnnotationSelectionCandidate | null> | null;
}

interface IAnnotationSelectionPluginRegistry {
  listPlugins(): IAnnotationSelectionPlugin[];
  registerPlugin(plugin: IAnnotationSelectionPlugin): () => void;
  subscribe(listener: () => void): () => void;
  unregisterPlugin(pluginId: string): void;
}
```

At runtime, `devhost` installs `globalThis.__DEVHOST__` as an `IAnnotationSelectionPluginRegistry`, drains any plugins preloaded into `globalThis.__DEVHOST_PLUGINS__`, and dispatches `window` event `devhost:annotation-selection-ready` after the registry is ready.

Selection semantics:

- the built-in DOM selector plugin is always registered with id `dom-elements`
- `matches()` defaults to `true` when omitted
- `priority` defaults to `0` when omitted
- the active selector is the highest-priority matching plugin
- devhost UI is selectable only with the **devhost** chat directory, and then uses the built-in DOM selector, independently of host-page plugins; the annotation tools themselves remain controls
- when priorities tie, the earlier-registered matching plugin stays active
- returning `null` from `resolveCandidate(...)` means that event does not produce a candidate
- `readRect()` controls the selection highlight box; return `null` when there is nothing to highlight
- `getCursorStyleText()` returns raw CSS text that `devhost` injects only while annotation selection mode is active; return `null` or omit it for no cursor override

Register a host-page plugin directly against the runtime registry:

```js
const plugin = {
  id: "custom-surface",
  label: "Custom surface",
  priority: 10,
  matches() {
    return true;
  },
  resolveCandidate(event, intent, context) {
    if (context.isDevtoolsEventTarget(event.target)) {
      return null;
    }

    return {
      id: "target-1",
      label: "Target 1",
      readRect() {
        return { x: 0, y: 0, width: 100, height: 40 };
      },
      async buildMarkerPayload(markerNumber) {
        return {
          accessibility: "",
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
          computedStyles: "",
          computedStylesObj: {},
          cssClasses: "",
          element: "Target 1",
          elementPath: "Target 1",
          fullPath: "Target 1",
          isFixed: false,
          markerNumber,
          nearbyElements: "",
          nearbyText: "",
        };
      },
    };
  },
};

const registry = globalThis.__DEVHOST__;

if (registry) {
  registry.registerPlugin(plugin);
} else {
  globalThis.__DEVHOST_PLUGINS__ ??= [];
  globalThis.__DEVHOST_PLUGINS__.push(plugin);
}
```

Messages with selected page context include the page URL and title, per-marker element metadata, drawing coordinates, and captured image dimensions alongside your message text.

When the host page is a React development build that exposes component source metadata, each marker captures the nearest available component source location. When the host app serves fetchable source maps, `devhost` attempts to symbolicate generated bundle locations back to original source files before storing the annotation.

For native session transport and replay, see [Browser chat sessions](../architecture/chat/). For the rest of the injected overlay, see [Devtools](./devtools/).

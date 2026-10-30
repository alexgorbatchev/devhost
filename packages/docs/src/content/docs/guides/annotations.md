---
title: "Chat with a coding agent"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/annotations.webp" aria-label="annotations demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/annotations.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

:::note[Video coverage]
The film shows the earlier terminal-based annotation workflow. Browser chat, drawing, and tab sharing below have no film yet.
:::

**Chat** in the toolbar runs your installed Codex or Claude Code CLI against your project. Point at elements on the page, draw over it, or attach a screenshot, and the agent gets that context with your message.

## Set up

1. Install and sign in to the [Codex CLI](https://learn.chatgpt.com/docs/cli) or [Claude Code](https://code.claude.com/docs/en/cli-reference) on the machine running devhost. The agent runs with its own account, settings, permissions, and environment; you never enter an API key in the browser.
2. Open **Chat** in the toolbar, then **Chat Settings** (the gear).
3. Choose a **Harness** and a model from its list. **Configured default** uses the CLI's own default model.

**Refresh Harnesses** looks for installed CLIs again. Finding a CLI does not prove it is signed in: if it is not, the first message fails with an authentication error in the conversation. Sign in through the CLI and send again.

The agent works in the checkout the page belongs to. After a [worktree switch](../../stacks/worktrees/), start a new conversation to work in the new checkout.

## Talk to the agent

Chat opens compact, showing a working spinner and then the latest reply. **Expand Chat** shows the whole conversation with streamed replies and tool activity, with consecutive tool calls in one collapsible group; **Compact Chat** goes back. The panel can sit on either side of the page, and collapsing it does not stop the agent. The **Chat** button shows a spinner while the agent works or waits for you.

| To                            | Use                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Stop the current turn         | **Stop Generating**, or **Escape** in the composer                                                      |
| Start a separate conversation | **New Conversation** (+)                                                                                |
| Switch conversations          | **Conversation** in **Chat Settings**                                                                   |
| End a conversation's process  | **Close Conversation**. It stays in the list as `closed`; selecting it resumes the CLI's saved session. |

You can send more messages while the agent works, including while it waits for an approval. Codex receives them as steering for the current turn, Claude Code as streaming input, and the agent decides when to use them. Sending never approves a pending tool or interrupts the agent. A model change applies from the next turn.

Paste a PNG or JPEG into the composer to attach it. A message, with all its images, must fit in 8 MiB; a rejected send puts its text and images back in the composer.

## Point at the page

1. Choose **Select Elements** in the floating tools at the top of the page, or hold **Alt** (**Option** on macOS). Alt works while you type in the chat composer, but not in the page's own fields.
2. Click elements to add numbered markers.
3. Refer to them in your message, such as "make #1 match #2", and send.

To draw instead, choose **Arrow**, **Line**, or **Box** and drag on the page. Drag a finished shape by its stroke to move it, and use **Undo Drawing** to remove the last one.

- **Escape** leaves selection or drawing mode, even while you type in the composer.
- Each item in **Page context** has a remove button; **Clear Page Context** removes them all.
- Sending clears the markers and drawings. A cancelled or failed send keeps them.
- Selection and drawing work over your page's popovers and modal dialogs, without closing them. Separate windows and browser dialogs such as `window.alert()` cannot be annotated.

With each marker the agent receives the element's path, nearby text, accessibility information, bounds, and computed styles. On a React development build it also gets the component's source location when one can be found, using source maps where the page serves them. A sent message's **Page Context** section shows exactly what was attached.

## Attach a screenshot

Screenshots are optional; markers and drawings work without them.

1. Choose **Share Tab** next to **Send Message**, and pick the current tab in the browser's picker. Windows and whole screens are rejected.
2. While **Include Tab Snapshot** (the camera) is on, each message takes a fresh screenshot of the tab. Turn it off to send messages without one.
3. Before the screenshot is sent, a preview opens. Drag to select an area, or adjust **Left**, **Top**, **Width**, and **Height** with the keyboard, then choose **Share Selected Area** or **Share Whole Tab**.

**Cancel** or **Escape** in the preview cancels the send and keeps your draft and context. The share stays active until **Stop Sharing**, a reload, or you stop it in the browser; devhost never sends video, only one image per message.

devhost hides its own toolbar, chat, and tooltips in the screenshot and waits until the image shows them gone, for up to ten seconds; if it cannot confirm that, the send fails and keeps your draft. Screen capture needs a secure page, such as the routed HTTPS one.

:::caution
The agent receives your message, the page URL and title, the selected element details, drawing positions, and any screenshot. Check what is visible before you share.
:::

## Approvals and questions

When the agent asks for permission to run a tool or asks you a question, chat shows the request and waits for your answer. devhost never answers for you, and an answered or cancelled request cannot be answered again. A request the browser cannot display stays visible with its details.

## The workflow prompt

devhost adds instructions to each message: work in a dedicated Git worktree, keep unrelated changes, run the project's checks, commit and merge into the local `main`, then remove the worktree and branch. Follow-ups reuse that worktree, nothing is pushed unless you ask, and a blocked merge leaves the worktree in place with a report. These are instructions to the agent; its own permissions still apply, and devhost runs no Git commands itself.

Replace them with your own text, or turn them off with an empty string:

```toml
[devtools.chat]
prompt = "Implement the requested changes in a worktree. Run checks and leave the branch for review."
```

Edits apply to the next message, even in an open conversation. Expand **Workflow Instructions** on a sent message to see what it included.

## Reloads, restarts, and history

Conversations belong to the running stack, not the page. Reloading or closing the tab never stops a turn, and the page reconnects with the full history.

After a reload, chat restores whether it was open, its side, your unsent text, the harness and model, the selected conversation, and the scroll position. That state is stored in the browser for each project and origin; pages that differ only in path, query, or fragment share it. A closed or missing conversation is never restarted on its own, and prompts or approvals are never sent again. Selections, drawings, screenshot shares, pasted images, and queued follow-ups do not survive a reload.

Stopping devhost ends every conversation's process. devhost keeps the history it streams back to pages in private temporary files on disk, which grow with the conversation and are freed when the stack stops. If writing them fails, devhost stops that conversation and reports an error. After a restart, resume a conversation through the CLI's own saved history.

## Activity in the terminal

The stack's terminal and the minimap's `chat` entries log each conversation's activity: sessions starting and closing, messages delivered, turns and tools with their outcomes and timings, approval waits, token counts or cost estimates where the CLI reports them, and errors. A turn with no agent output for 30 seconds logs a heartbeat. These lines never include your messages, screenshots, tool input or output, or answers to approvals. See the [Chat API](../../reference/chat-api/#activity-logs) for each field.

## Chat about devhost itself

A development build of devhost knows its own source checkout (see [Build from source](../../development/building/)). It then shows a **Chat Directory** switch with **Project** and **devhost**:

- **devhost** starts conversations in the devhost checkout, lists only those conversations, and lets you select and draw over devhost's own toolbar and panels.
- **Project** returns to your app and its conversation.

Changing the directory clears current selections and drawings, and the choice is remembered per project and origin. UI changes the agent makes show up when you reload the page; Go changes need the devhost binary rebuilt and the stack restarted, which ends its conversations.

## Turn it off

```toml
[devtools.chat]
enabled = false   # removes chat and its routes

[devtools.annotations]
enabled = false   # keeps chat, removes selection and drawing
```

Both default to `true` and apply without a restart. Conversations already running keep running while chat is off.

To change how elements are selected on your page, see [Selection plugins](../../reference/selection-plugins/).

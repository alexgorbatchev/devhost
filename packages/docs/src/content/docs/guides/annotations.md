---
title: "Annotations"
sidebar:
  order: 10
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1280" height="860" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/annotations.webp" aria-label="annotations demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/annotations.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/annotations.mp4">Watch the demo video</a>.
</video>

<details>
<summary>Demo transcript</summary>
<p>Alt-click. Describe the change. Watch Pi fix the live page.</p>
<p>Pi is working on the annotated change.</p>
<p>The heading updates live from Pi&#x27;s source edit.</p>
</details>
<!-- /guide-demo -->

Annotations build on top of the injected devtools UI. For the overlay and routing model itself, see [Devtools](./devtools/).

## AI annotations

- hold `Alt` (`Option` on macOS) to enter annotation selection mode
- click one or more page elements while holding `Alt` to place numbered markers
- release `Alt` to leave selection mode while keeping the current draft open
- write a comment that references markers like `#1` and `#2`
- click `Submit` or press `⌘ ↵` / `Ctrl + Enter` to start the selected annotation action with the draft
- when `Append to active session queue` is enabled, the draft is added to the matching routed service's active agent queue instead of being injected immediately into a busy terminal
- queued annotations are grouped by service name and annotation action, shared across the service's domains, and survive browser reloads and `devhost` restarts
- running agent and command annotation sessions continue across page reloads, closed tabs, and browser closure; reopening a routed page reconnects to existing sessions with retained terminal output
- queued annotations drain automatically when the agent emits `OSC 1337;SetAgentStatus=finished`
- by default, the queue stays collapsed into a compact progress summary until you expand it to edit or delete queued or paused items
- click `Cancel` or press `Escape` to discard the draft

Annotation selection runs through a selector plugin. The built-in DOM picker is one plugin in that registry, so custom host pages can replace it with a higher-priority selector when the selectable surface is not plain DOM.

`devhost` exposes that registry through the host page at runtime so mirrored previews, canvas-based UIs, terminal surfaces, and other non-DOM inspection targets can participate in the same annotation draft, queue, and submission flow.

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
- when priorities tie, the earlier-registered matching plugin stays active
- returning `null` from `resolveCandidate(...)` means that event does not produce a candidate
- `readRect()` controls the draft highlight box; return `null` when there is nothing to highlight
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

The submitted draft includes the current stack name, page URL and title, comment text, and collected per-marker element metadata.

When the host page is a React development build that exposes component source metadata, each marker captures the nearest available component source location. When the host app serves fetchable source maps, `devhost` attempts to symbolicate generated bundle locations back to original source files before storing the annotation.

## Annotation actions

Configure annotation launchers with a root-level `[annotation]` table and one or more `[[annotation.actions]]` entries.
If you omit `[annotation]`, `devhost` does not expose annotation submission actions in the injected UI.
Each action declares a stable `id` and a `kind`. The `label` names the action in the composer. Actions that use a built-in agent adapter default it to the adapter's name (`Pi`, `Claude Code`, `OpenCode`, or `Codex`); set `label` on them to tell apart actions that share an adapter. Custom agent actions and command actions require `label`. Set `defaultAction` when the UI should preselect an action other than the first one.

Agent actions use the existing built-in integrations:

```toml
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"
args = ["--thinking", "high"]
```

Supported agent adapters are `"pi"`, `"claude-code"`, `"opencode"`, and `"codex"`. Built-in adapters accept an optional `args` string array to pass harness flags (such as a model, thinking level, or permission mode) while keeping status reporting, hooks, and prompt file arguments intact.
For a custom agent action, omit `adapter`, set `command` inside `[annotation.actions.agent]`, and give the action a `label` (`args` is valid only with `adapter`).

For Codex, install and sign in to the [Codex CLI](https://learn.chatgpt.com/docs/cli), then use:

```toml
[[annotation.actions]]
id = "ask-codex"
kind = "agent"

[annotation.actions.agent]
adapter = "codex"
args = ["-c", "model_reasoning_effort=high"]
```

The Codex adapter requires a CLI version supporting `--no-daemon` and lifecycle hooks and is validated
against 0.159.2. It launches an independent interactive session, keeps your authentication and
permission settings, and passes an instruction to read the annotation prompt file.
Use `/hooks` in the embedded Codex terminal to review and trust the devhost status hooks.
Codex skips untrusted hooks, so queues cannot drain until those hooks are trusted and enabled.
A managed-hooks-only policy also prevents these session hooks from running. Devhost does not
bypass hook trust or change that policy. See [Codex hooks](https://learn.chatgpt.com/docs/hooks).
If the initial annotation finishes before hook review, send another prompt after trusting the
hooks so Codex can report readiness and drain waiting annotations.

Generic command actions run directly in a `devhost` terminal and receive the annotation through context files:

```toml
[annotation]

[[annotation.actions]]
id = "lint"
label = "Run lint"
kind = "command"

[annotation.actions.command]
command = ["bun", "run", "lint"]
cwd = "."

[annotation.actions.command.env]
CI = "1"
```

`devhost` executes command actions directly, not through a shell string. Command actions receive:

- `DEVHOST_ANNOTATION_ACTION_ID`
- `DEVHOST_ANNOTATION_ACTION_KIND`
- `DEVHOST_ANNOTATION_ACTION_LABEL`
- `DEVHOST_ANNOTATION_FILE`
- `DEVHOST_ANNOTATION_PROMPT_FILE`
- `DEVHOST_ANNOTATION_TRANSPORT=files`
- `DEVHOST_PROJECT_ROOT`
- `DEVHOST_STACK_NAME`

Use command actions for non-agent automations such as creating a Jira ticket, running a linter, or handing the annotation off to another project-local CLI. `devhost` does not ship a built-in Jira adapter; the intended integration point is a `kind = "command"` action that reads the annotation files and performs the external side effect itself.

Example manifest for a Jira handoff:

```toml
[annotation]
defaultAction = "jira"

[[annotation.actions]]
id = "jira"
label = "Create Jira Ticket"
kind = "command"

[annotation.actions.command]
command = ["bun", "./scripts/mock-jira-ticket.ts"]
cwd = "."

[annotation.actions.command.env]
JIRA_BASE_URL = "https://example.atlassian.net"
JIRA_PROJECT_KEY = "WEB"
```

Basic mock CLI for illustration:

```ts
interface AnnotationMarker {
  element: string;
  fullPath: string;
  nearbyText: string;
}

interface AnnotationPayload {
  comment: string;
  markers: AnnotationMarker[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}

const annotationFile = process.env.DEVHOST_ANNOTATION_FILE;

if (!annotationFile) {
  throw new Error("DEVHOST_ANNOTATION_FILE is required");
}

const annotation = (await Bun.file(annotationFile).json()) as AnnotationPayload;
const projectKey = process.env.JIRA_PROJECT_KEY ?? "UNKNOWN";
const ticketSummary = `[${projectKey}] ${annotation.title}`;
const ticketDescription = [
  `Comment: ${annotation.comment}`,
  `URL: ${annotation.url}`,
  `Stack: ${annotation.stackName}`,
  "Markers:",
  ...annotation.markers.map((marker, index) => {
    return `${index + 1}. ${marker.element} — ${marker.fullPath} — ${marker.nearbyText}`;
  }),
].join("\n");

console.log("Mock Jira CLI would create ticket", {
  baseUrl: process.env.JIRA_BASE_URL,
  description: ticketDescription,
  summary: ticketSummary,
});
```

Replace the `console.log(...)` with your real Jira client or HTTP call. The important part is that the script reads the annotation from `DEVHOST_ANNOTATION_FILE` or `DEVHOST_ANNOTATION_PROMPT_FILE` rather than expecting `devhost` to provide a first-class Jira integration.

Agent actions continue to support durable annotation queues. Command actions start standalone terminal sessions and are not queued.
Running annotation sessions keep the stack alive through its idle timeout. Use the terminal's terminate action or stop `devhost` to end a running session.

The injected config includes UI-safe action metadata as `annotationActions`, with each action exposing `id`, `kind`, `label`, and `queueEnabled`, plus `annotationDefaultActionId` for the selected default.

`devhost` executes custom agent commands directly, not through a shell string. For configured commands, `devhost` writes the annotation JSON and rendered prompt to temp files and injects their paths as `DEVHOST_ANNOTATION_FILE` and `DEVHOST_ANNOTATION_PROMPT_FILE`. Agent commands receive every variable listed for command actions; `DEVHOST_ANNOTATION_ACTION_LABEL` carries the action's label. Built-in adapters receive the rendered prompt natively via command-line arguments.

All built-in adapters integrate terminal OSC sequences to reflect working and idle states during embedded session execution, and the durable annotation queue uses those same status events to decide when to drain queued work:

- `pi` leverages an injected extension to capture `agent_start` and `agent_end` hooks
- `claude-code` utilizes its `--settings` API mapping commands to its native session and user prompt hooks
- `opencode` integrates via an inline `--config` plugin listening for `session.status` events
- `codex` uses session-local config overrides for `SessionStart`, `UserPromptSubmit`, `Stop`, `Interrupt`, and `SessionEnd`; trusted hooks write status to that session's PTY instead of captured hook stdout

Agent sessions render inside the devtools terminal. Theme handling depends on the adapter:

- `pi` is launched with `--use-theme light` or `--use-theme dark`
- `claude-code` receives `"theme": "light"` or `"theme": "dark"` in its generated `--settings` file, which overrides the user's own theme for that session
- `opencode` runs as `opencode run`, which has no interactive theme to set
- `codex` retains your configured syntax theme; set `tui.theme` through `args` if you want a session-specific override

Queued work keeps the color scheme it was submitted with. Resuming a paused queue relaunches the agent with the color scheme the devtools show at that moment.

Custom annotation agents must emit `OSC 1337;SetAgentStatus=working` when they begin handling an annotation and `OSC 1337;SetAgentStatus=finished` when they are ready for the next queued item. `devhost` accepts either BEL (`\x07`) or ST (`\x1b\\`) OSC terminators.

For the queue internals and server-owned drain model, see [Durable annotation queues](../architecture/annotations/queue/).

For the external toolbar aggregation architecture, see [External devtools launcher aggregation](../architecture/external-devtools/).

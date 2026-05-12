---
title: "Annotations"
sidebar:
  order: 10
---

Annotations build on top of the injected devtools UI. For the overlay and routing model itself, see [Devtools](./devtools/).

## AI annotations

- hold `Alt` (`Option` on macOS) to enter annotation selection mode
- click one or more page elements while holding `Alt` to place numbered markers
- release `Alt` to leave selection mode while keeping the current draft open
- write a comment that references markers like `#1` and `#2`
- click `Submit` or press `⌘ ↵` / `Ctrl + Enter` to start the selected annotation action with the draft
- when `Append to active session queue` is enabled, the draft is added to the matching routed service's active agent queue instead of being injected immediately into a busy terminal
- queued annotations are grouped by routed service host and path and survive browser reloads and `devhost` restarts
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
Each action declares a stable `id`, a UI `label`, and a `kind`. Set `defaultAction` when the UI should preselect an action other than the first one.

Agent actions use the existing built-in integrations:

```toml
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
label = "Ask Claude"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"
```

Supported agent adapters are `"pi"`, `"claude-code"`, and `"opencode"`.
For a custom agent action, omit `adapter` and set `command` plus `displayName` inside `[annotation.actions.agent]`; the parent `label` is the action label shown in the composer, and `displayName` remains the agent display name exposed through the agent command environment.

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
- `DEVHOST_ANNOTATION_DISPLAY_NAME`
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

The injected config includes UI-safe action metadata as `annotationActions`, with each action exposing `id`, `displayName`, `kind`, and `queueEnabled`, plus `annotationDefaultActionId` for the selected default.

`devhost` executes custom agent commands directly, not through a shell string. For configured commands, `devhost` writes the annotation JSON and rendered prompt to temp files and injects them via `DEVHOST_AGENT_*` and neutral `DEVHOST_ANNOTATION_*` environment variables. Built-in adapters receive the rendered prompt natively via command-line arguments.

All built-in adapters integrate terminal OSC sequences to reflect working and idle states during embedded session execution, and the durable annotation queue uses those same status events to decide when to drain queued work:

- `pi` leverages an injected extension to capture `agent_start` and `agent_end` hooks
- `claude-code` utilizes its `--settings` API mapping commands to its native session and user prompt hooks
- `opencode` integrates via an inline `--config` plugin listening for `session.status` events

Custom annotation agents must emit `OSC 1337;SetAgentStatus=working` when they begin handling an annotation and `OSC 1337;SetAgentStatus=finished` when they are ready for the next queued item. `devhost` accepts either BEL (`\x07`) or ST (`\x1b\\`) OSC terminators.

For the queue internals and server-owned drain model, see [Durable annotation queues](../architecture/annotations/queue/).

For the external toolbar aggregation architecture, see [External devtools launcher aggregation](../architecture/external-devtools/).

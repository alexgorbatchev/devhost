export type FeatureHighlightId =
  | "managed-edge"
  | "stack-lifecycle"
  | "runtime-context"
  | "devtools"
  | "agent-handoff";

export interface IFeatureHighlight {
  bullets: readonly string[];
  demoRecordingUrl?: string;
  description: string;
  id: FeatureHighlightId;
  kicker: string;
  tabLabel: string;
  title: string;
}

export const featureHighlights: readonly IFeatureHighlight[] = [
  {
    bullets: [
      "Run multiple projects against the same managed Caddy instance at the same time.",
      "Keep hostname ownership exclusive so one live stack cannot quietly steal another stack's public host.",
      "Download Caddy explicitly, trust its local CA once, and keep its lifecycle shared and manual.",
    ],
    description:
      "devhost makes the local edge feel intentional instead of improvised: one managed HTTPS entry point, explicit hostname ownership, and a setup you can trust across concurrent projects.",
    id: "managed-edge",
    kicker: "Managed edge",
    tabLabel: "Managed edge",
    title: "Put every local service behind a real HTTPS front door",
  },
  {
    bullets: [
      "Validate manifests before spawn, not after the browser hits a broken route.",
      "Reserve fixed numeric bind ports and public hostnames before services start.",
      "Wait for health checks before reloading the managed edge so the route appears at the correct moment.",
    ],
    description:
      "Local routing gets dramatically less fragile when the stack lifecycle is strict. devhost treats startup, readiness, and teardown like real infrastructure instead of hopeful shell glue.",
    id: "stack-lifecycle",
    kicker: "Stack lifecycle",
    tabLabel: "Stack lifecycle",
    title: "Make the hostname appear only when the stack is actually ready",
  },
  {
    bullets: [
      "Use DEVHOST_BIND_HOST and PORT as the actual bind inputs for the child process.",
      "Treat DEVHOST_HOST and DEVHOST_PATH as routed context, not socket bind targets.",
      "Pass DEVHOST_SERVICE_NAME and DEVHOST_MANIFEST_PATH through the process tree as manifest metadata.",
    ],
    description:
      "The runtime contract stays clean: devhost injects the context every service needs without forcing you to hard-code local ports or confuse public routing metadata with bind configuration.",
    id: "runtime-context",
    kicker: "Injected environment",
    tabLabel: "Runtime context",
    title: "Give each service the right context without hard-coding the local stack",
  },
  {
    bullets: [
      "Split document requests from asset traffic so HMR, fetches, SSE, and WebSockets stay on the direct app path.",
      "Mount the injected UI inside its own Shadow DOM container so runtime styles do not leak into the host page.",
      "Keep logs, service status, and source-aware inspection attached to the routed page instead of a separate tool window.",
    ],
    description:
      "The devtools overlay earns its place by staying out of the way. You get page-level visibility and source-aware debugging without forcing every request through a noisy proxy path.",
    id: "devtools",
    kicker: "Devtools overlay",
    tabLabel: "Devtools overlay",
    title: "Inspect the routed page without breaking the app around it",
  },
  {
    bullets: [
      "Hold Alt to select elements, reference markers like #1 and #2, and submit the draft without retyping page context elsewhere.",
      "Capture page URL, page title, element metadata, and nearest component source details when React development metadata exists.",
      "Launch Pi by default or switch to built-in adapters such as claude-code and opencode, or provide a custom command.",
    ],
    demoRecordingUrl: "/recordings/marketing/annotation.json",
    description:
      "AI annotations turn page evidence into action. The page state, stack context, and source hints stay attached to the handoff, so the debugging loop keeps its momentum instead of restarting in chat or a ticket.",
    id: "agent-handoff",
    kicker: "AI annotations",
    tabLabel: "Agent handoff",
    title: "Turn a page bug into a live coding session with context attached",
  },
];

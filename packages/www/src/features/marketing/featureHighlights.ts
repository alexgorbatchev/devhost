export type FeatureHighlightId = "annotation" | "source-jumps" | "sessions" | "overlay" | "routing-health";

export interface IFeatureHighlight {
  bullets: readonly string[];
  demoRecordingUrl: string;
  description: string;
  id: FeatureHighlightId;
  kicker: string;
  tabLabel: string;
  title: string;
}

export const featureHighlights: readonly IFeatureHighlight[] = [
  {
    bullets: [
      "Mark multiple elements in one draft instead of losing context between screenshots.",
      "Carry component source paths into the handoff when the page exposes them.",
      "Start a coding session from the page itself instead of rewriting the bug report elsewhere.",
    ],
    demoRecordingUrl: "/recordings/marketing/annotation.json",
    description:
      "Hold Alt, tag page elements, draft a note, and submit a Pi session seeded with the stack name, page URL, selected elements, and component source details when React metadata is available.",
    id: "annotation",
    kicker: "Annotation handoff",
    tabLabel: "Annotation handoff",
    title: "Send annotated page state straight into Pi",
  },
  {
    bullets: [
      "Jump from the routed page to the nearest component without manually tracing the tree.",
      "Keep source navigation wired to the editor the stack already expects.",
      "Use the inspection loop to move from page evidence into code without re-establishing context.",
    ],
    demoRecordingUrl: "/recordings/marketing/source-jumps.json",
    description: "Alt + right-click component inspection can open the nearest React source in the editor you configured.",
    id: "source-jumps",
    kicker: "Source navigation",
    tabLabel: "Source navigation",
    title: "Editor-aware component jumps",
  },
  {
    bullets: [
      "Keep source navigation and editing inside the same inspection flow.",
      "Normalize TERM and color capabilities for browser-backed terminal sessions.",
      "Use the session tray as persistent working memory while you inspect the page.",
    ],
    demoRecordingUrl: "/recordings/marketing/sessions.json",
    description:
      "Component-source jumps and annotation sessions can open embedded terminals, including Neovim, with a normalized xterm.js environment so terminal UIs render correctly inside the browser surface.",
    id: "sessions",
    kicker: "Terminal sessions",
    tabLabel: "Terminal sessions",
    title: "Keep the editor and agent session attached to the inspection loop",
  },
  {
    bullets: [
      "Keep HMR, assets, fetches, SSE, and WebSockets off the injection path.",
      "Inject the debugging chrome only where page-level context matters.",
      "Preserve visual isolation between the app and the overlay runtime.",
    ],
    demoRecordingUrl: "/recordings/marketing/overlay.json",
    description:
      "The injected devtools split document navigation from asset traffic and mount inside a Shadow DOM root, so the overlay can inspect the page without polluting the host app's CSS.",
    id: "overlay",
    kicker: "Devtools overlay",
    tabLabel: "Devtools overlay",
    title: "Inspect live pages without turning the proxy into a bottleneck",
  },
  {
    bullets: [
      "Use real hostnames instead of juggling localhost ports by hand.",
      "Keep routes aligned with process lifetime so stale hosts disappear automatically.",
      "Expose the hostname only after the service is actually healthy.",
    ],
    demoRecordingUrl: "/recordings/marketing/routing-health.json",
    description:
      "devhost reserves public hosts before the app goes live, waits for each health check to pass, and only then reloads the managed Caddy instance so the route becomes real at the correct moment.",
    id: "routing-health",
    kicker: "Routing + health",
    tabLabel: "Routing + health",
    title: "Reserve the host, wait for health, then expose the route",
  },
];

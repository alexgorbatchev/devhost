import type { IMarketingContent } from "./types";

export const marketingContent: IMarketingContent = {
  defaultFeatureId: "routing",
  featureHighlights: [
    {
      body:
        "devhost reserves public hosts before the app goes live, waits for each health check to pass," +
        " and only then reloads the managed Caddy instance.",
      checklist: [
        "Use real hostnames instead of juggling localhost ports by hand.",
        "Keep routes aligned with process lifetime so stale hosts disappear automatically.",
        "Avoid exposing half-ready services just because the child process started.",
      ],
      id: "routing",
      kicker: "Managed routing",
      title: "Route the app only after it is actually healthy",
    },
    {
      body:
        "Routes are held back until the service passes its configured health check," +
        " which is the only sane time to expose a hostname.",
      checklist: [],
      id: "health-checks",
      kicker: "Release discipline",
      title: "Health checks gate exposure",
    },
    {
      body:
        "The injected devtools split document navigation from asset traffic and mount inside a Shadow DOM root," +
        " so the overlay can inspect the page without polluting the host app's CSS.",
      checklist: [
        "Keep HMR, assets, fetches, SSE, and WebSockets off the injection path.",
        "Inject the debugging chrome only where page-level context matters.",
        "Preserve visual isolation between the app and the overlay runtime.",
      ],
      id: "overlay",
      kicker: "Devtools overlay",
      title: "Inspect live pages without turning the proxy into a bottleneck",
    },
    {
      body:
        "Hold Alt, tag page elements, draft a note, and submit a Pi session seeded with the stack name, page URL," +
        " selected elements, and component source details when React metadata is available.",
      checklist: [
        "Mark multiple elements in one draft instead of losing context between screenshots.",
        "Carry component source paths into the handoff when the page exposes them.",
        "Start a coding session from the page itself instead of rewriting the bug report elsewhere.",
      ],
      id: "annotation",
      kicker: "Annotation handoff",
      title: "Send annotated page state straight into Pi",
    },
    {
      body: "Alt + right-click component inspection can open the nearest React source in the editor you configured.",
      checklist: [
        "Jump from the routed page to the nearest component without manually tracing the tree.",
        "Keep source navigation wired to the editor the stack already expects.",
        "Use the inspection loop to move from page evidence into code without re-establishing context.",
      ],
      id: "source-jumps",
      kicker: "Source navigation",
      title: "Editor-aware component jumps",
    },
    {
      body:
        "Component-source jumps and annotation sessions can open embedded terminals, including Neovim, with a" +
        " normalized xterm.js environment so terminal UIs render correctly inside the browser surface.",
      checklist: [
        "Keep source navigation and editing inside the same inspection flow.",
        "Normalize TERM and color capabilities for browser-backed terminal sessions.",
        "Use the session tray as persistent working memory while you inspect the page.",
      ],
      id: "sessions",
      kicker: "Terminal sessions",
      title: "Keep the editor and agent session attached to the inspection loop",
    },
    {
      body: "The manifest resolves ports, hostnames, dependencies, and optional agent configuration in one place.",
      checklist: [],
      id: "stack-contract",
      kicker: "Stack contract",
      title: "One file defines the local stack",
    },
  ],
  featureSectionProofCardId: "local-https",
  launchCommands: ["bun devhost caddy start", "bun devhost --manifest ./test/devhost.toml"],
  manifestPreviewLines: [
    'name = "hello-test-app"',
    'primaryService = "hello"',
    'devtoolsPosition = "top-right"',
    'devtoolsComponentEditor = "neovim"',
    "",
    "[services.hello]",
    'command = ["bun", "dev"]',
    "port = 3200",
    'host = "hello.xcv.lol"',
    "",
    "[services.logs.health]",
    "process = true",
  ],
  proofCards: [
    {
      body: "Document navigations are injected, but assets and hot-reload traffic stay on the direct app path.",
      eyebrow: "Proxy discipline",
      id: "proxy-discipline",
      title: "Devtools stay off the noisy traffic",
    },
    {
      body: "The overlay lives inside its own Shadow DOM container so host styles do not quietly corrupt the tooling UI.",
      eyebrow: "Isolation",
      id: "isolation",
      title: "The debugging shell is visually contained",
    },
    {
      body:
        "Managed Caddy trust and lifecycle commands are exposed directly because local TLS setup is part of the" +
        " product, not a side quest.",
      eyebrow: "Operational honesty",
      id: "local-https",
      title: "Local HTTPS is a first-class workflow",
    },
  ],
  workflowSteps: [
    {
      body: "Start the managed Caddy instance once so devhost can own route registration and local TLS.",
      step: "01",
      title: "Boot the managed edge",
    },
    {
      body: "Launch one service or a whole manifest and let devhost resolve ports, dependencies, and health checks.",
      step: "02",
      title: "Run the stack from a manifest",
    },
    {
      body: "Open the routed hostname and inspect the real page with source-aware devtools layered on top.",
      step: "03",
      title: "Work on the routed host",
    },
    {
      body: "Annotate the page, jump to source, or spawn a terminal session without leaving the browser loop.",
      step: "04",
      title: "Hand off context without rewriting it",
    },
  ],
};

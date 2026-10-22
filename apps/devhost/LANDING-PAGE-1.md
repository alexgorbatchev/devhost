<div align="center">
  <h1>devhost</h1>
  <p><b>The ultimate local development host runner for modern stacks.</b></p>
</div>

**devhost** is an open-source local host runner that ships as a native Go binary and orchestrates your development processes behind an automated, managed Caddy proxy. Get production-like custom domains, seamless local HTTPS, and powerful injected devtools—all with zero manual configuration.

Whether you're booting up a single frontend or orchestrating a complex, multi-service backend, `devhost` ensures your local environment is fast, reliable, and deeply integrated with your editor and AI workflows.

---

## 🚀 Key Features

### Seamless Custom Domains & Local HTTPS

Stop developing on `localhost:3000`. `devhost` automatically manages a rootless Caddy proxy to provide clean, custom hostnames (e.g., `app.local.test`) over secure HTTPS. It handles local CA trust, reverse proxying, and zero-downtime route reloading on the fly.

### Intelligent Stack Orchestration

Define your entire local ecosystem in a simple `devhost.toml` manifest, backed by strict schema validation. `devhost` takes care of the rest:

- **Dependency Ordering:** Starts services in the correct sequence via `dependsOn`.
- **Health Gates:** Waits for HTTP, TCP, or process health checks before enabling routes, eliminating startup race conditions.
- **Auto-Port Resolution:** Assign `port = "auto"` and let `devhost` dynamically allocate available ports, injecting them natively via `PORT` environment variables alongside safe `DEVHOST_BIND_HOST` policies.

### Zero-Conflict Injected Devtools & Real-Time Metrics

`devhost` intelligently splits traffic to inject a lightweight Devtools UI into your HTML document requests (`Sec-Fetch-Dest: document`).

- **Shadow DOM Encapsulated:** The devtools UI mounts entirely inside a Shadow DOM to guarantee **zero CSS conflicts** with your host application.
- **Real-Time Data Streams:** A built-in high-performance WebSocket control server streams live service health status, memory-capped service logs, and chat conversations directly to the browser UI without polluting the host app's network layer.

### In-Browser Chat with Page Context

Spot a bug or want to request a change? Open **Chat** in the injected toolbar to talk to the Codex CLI or Claude Code already installed and signed in on your machine, then hold `Alt` (`Option` on macOS) to point at the page:

1. Click elements to place numbered markers, or draw arrows, lines, and boxes over the page.
2. Write your request in the chat composer, referring to the markers.
3. Send it, and the agent receives a snapshot of the shared tab with your markings.
   Behind the scenes, `devhost` attaches the page URL and title, computed CSS, bounding boxes, accessibility information, nearby text, drawing coordinates, and React source locations when available.

### Jump to Source in Your Editor

Alt + right-click a React component in a development build to open its source in VS Code, VS Code Insiders, Cursor, or WebStorm through the editor's URL handler. `devhost` symbolicates generated locations back to original files when source maps are available.

### Smart Environment Injection

No more hardcoded ports. `devhost` automatically injects `PORT`, `DEVHOST_HOST`, `DEVHOST_BIND_HOST`, and `DEVHOST_SERVICE_NAME` environment variables into your child processes, giving your services absolute context about their local network topology.

---

## 🛠️ Built for Any Workflow

**Manifest Mode**  
Working on a full stack? Just run:

```bash
devhost start
```

`devhost` will automatically find your `devhost.toml`, validate it, reserve public hosts, boot your services in order, and gracefully tear down processes and routes on exit.

---

## Start Building Better

Download the archive for your platform from GitHub Releases, then run `devhost start`. `devhost` requires either a global `caddy` on your `PATH` or a managed Caddy binary downloaded with `devhost caddy download`. Experience the fastest, most integrated local development workflow today.

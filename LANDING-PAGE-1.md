<div align="center">
  <h1>devhost</h1>
  <p><b>The ultimate local development host runner for modern stacks.</b></p>
</div>

**devhost** is an open-source, Bun-based local host runner that orchestrates your development processes behind an automated, managed Caddy proxy. Get production-like custom domains, seamless local HTTPS, and powerful injected devtools—all with zero manual configuration.

Whether you're booting up a single frontend or orchestrating a complex, multi-service backend, `devhost` ensures your local environment is fast, reliable, and deeply integrated with your editor and AI workflows.

---

## 🚀 Key Features

### Seamless Custom Domains & Local HTTPS

Stop developing on `localhost:3000`. `devhost` automatically manages a rootless Caddy proxy to provide clean, custom hostnames (e.g., `app.local.test`) over secure HTTPS. It handles local CA trust, reverse proxying, and zero-downtime route reloading on the fly.

### Intelligent Stack Orchestration

Define your entire local ecosystem in a simple `devhost.toml` manifest, backed by strict Zod schema validation. `devhost` takes care of the rest:

- **Dependency Ordering:** Starts services in the correct sequence via `dependsOn`.
- **Health Gates:** Waits for HTTP, TCP, or process health checks before enabling routes, eliminating startup race conditions.
- **Auto-Port Resolution:** Assign `port = "auto"` and let `devhost` dynamically allocate available ports, injecting them natively via `PORT` environment variables alongside safe `DEVHOST_BIND_HOST` policies.

### Zero-Conflict Injected Devtools & Real-Time Metrics

`devhost` intelligently splits traffic to inject a lightweight Devtools UI into your HTML document requests (`Sec-Fetch-Dest: document`).

- **Shadow DOM Encapsulated:** The devtools UI mounts entirely inside a Shadow DOM to guarantee **zero CSS conflicts** with your host application.
- **Real-Time Data Streams:** A built-in high-performance WebSocket control server streams live service health status, memory-capped service logs, and terminal sessions directly to the browser UI without polluting the host app's network layer.

### Deep In-Browser AI Annotation

Spot a bug or want to request a change? Hold `Alt` (`Option` on macOS) to enter annotation mode:

1. Click elements to place numbered markers.
2. Draft a comment directly in the browser overlay.
3. Instantly launch an interactive **Pi Agent Session** seeded with your draft.
   Behind the scenes, `devhost` captures comprehensive payload metadata: computed CSS, bounding boxes, accessibility tree state, nearby text context, and React component fiber source maps.

### Click-to-Editor & Embedded Terminal

Jump straight from the browser UI to the exact line of code. Alt + right-click any component to instantly open its source file in your configured editor (VS Code, Cursor, WebStorm).

Prefer the terminal? Set your editor to `neovim`. `devhost` embeds a fully-featured, truecolor `xterm.js` emulator in the browser overlay, mapping native process streams over WebSockets directly into your Neovim session.

### Smart Environment Injection

No more hardcoded ports. `devhost` automatically injects `PORT`, `DEVHOST_HOST`, `DEVHOST_BIND_HOST`, and `DEVHOST_SERVICE_NAME` environment variables into your child processes, giving your services absolute context about their local network topology.

---

## 🛠️ Built for Any Workflow

**Manifest Mode**  
Working on a full stack? Just run:

```bash
bun run dev
```

`devhost` will automatically find your `devhost.toml`, validate it, reserve public hosts, boot your services in order, and gracefully tear down processes and routes on exit.

---

## Start Building Better

`devhost` requires `bun` and `caddy`. Experience the fastest, most integrated local development workflow today.

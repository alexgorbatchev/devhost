# devhost landing page copy

## Title tag

devhost — Local HTTPS and multi-service routing for real development domains

## Meta description

Run one app or a full local stack behind real hostnames with managed Caddy, health-gated routing, built-in browser devtools, and source-aware annotations.

---

## Hero

### Headline

Real local domains. Real HTTPS. Less local setup nonsense.

### Subheadline

`devhost` is an open source utility for running a single app or a full development stack behind real hostnames with a devhost-managed Caddy instance. Start services, wait for health checks, activate routes only when they are ready, and debug everything from an in-page devtools overlay.

### Primary CTA

Get started

### Secondary CTA

Read the docs

### Supporting points

- Run one service or a full stack from `devhost.toml`
- Managed local HTTPS with Caddy lifecycle commands
- Routes go live only after health checks pass
- Built-in logs, service status, annotations, and terminal sessions in the browser

---

## Value proposition section

### Heading

Local development should feel like using the real app, not babysitting proxy config.

### Body

Most local setups fall apart as soon as you need more than `localhost:3000`.
You add a reverse proxy, wire up hostnames, juggle ports, wait for services by hand, and still end up testing something that behaves differently than a real routed app.

`devhost` fixes that.

It gives your local project a proper front door: real hostnames, managed HTTPS, health-aware routing, and a workflow that works for your apps and multi-service stacks. And because it is open source, you can inspect it, adapt it, and keep it in your own toolchain.

---

## Feature grid

### 1. Real hostnames for local development

Stop pretending every app lives on `localhost`.

`devhost` lets you run local services behind real routed domains such as `app.local.test` or `api.local.test`, so cookies, auth flows, callbacks, cross-service behavior, and browser policies are much closer to production reality.

### 2. Managed local HTTPS without a pile of hand-rolled proxy scripts

`devhost` manages a dedicated Caddy instance for local routing and exposes explicit lifecycle commands to start, stop, and trust the local CA.

That means you get a repeatable HTTPS setup instead of tribal knowledge and shell history.

### 3. Manifest mode when your project is actually a stack

When one process is not enough, `devhost.toml` lets you describe your local stack in one place:

- service commands
- working directories
- environment variables
- fixed or auto-assigned ports
- public hosts
- dependency order
- health checks

Run `devhost`, and it starts the stack in dependency order, resolves ports, waits for readiness, and activates routes as services come online.

### 5. Health-gated routing, not wishful thinking

`devhost` does not route to a service just because the process started.

It waits for the service health check to pass first. TCP, HTTP, and process-based checks are supported, and routes are activated only after the target is actually ready.

That removes a whole category of flaky startup behavior and false-positive "it booted" states.

### 6. Auto ports with predictable environment injection

For manifest-driven stacks, `devhost` can allocate ports automatically and inject the values your services need at runtime, including `PORT`, bind host information, stack metadata, and routed hostnames.

You keep configuration explicit without hard-coding every port in every project.

### 7. In-page devtools built for routed local apps

`devhost` can inject a lightweight devtools UI into HTML document requests so you can inspect the running stack where it actually matters: in the browser, on the page you are debugging.

The overlay includes:

- live service health status
- streamed service logs
- a log minimap for fast scanning
- browser-connected terminal sessions

### 8. Annotate the UI and turn feedback into action

Hold `Alt`, select one or more elements on the page, write a comment, and send that annotated context into an agent session.

The submitted context includes page metadata, element details, marker references, selected text, computed styles, and available source-location data. That makes UI feedback much more actionable than a screenshot and a vague bug report.

### 9. Jump from the page to source

For React development builds, `devhost` can capture component source metadata and, when source maps are available, symbolicate generated locations back to original files.

From there, component-source navigation can open your configured editor, including:

- VS Code
- VS Code Insiders
- Cursor
- WebStorm
- Neovim

### 10. Embedded terminal workflows for debugging and editing

Need to inspect an agent session or open Neovim without leaving the browser workflow?

`devhost` supports browser-connected terminal sessions, including editor-backed flows and agent-backed flows, so feedback, code context, and action stay in one loop.

### 11. Clean startup, clean shutdown

`devhost` reserves hosts before startup, starts services sequentially, tears them down in reverse order, and removes routes when the process exits or fails.

That matters. Local tooling that leaves processes or stale routes behind is not a convenience tool; it is a source of drift.

### 12. Open source and adaptable by design

`devhost` is not a black box SaaS and not a hosted control plane.

It is an open source utility you can run locally, inspect directly, and adapt to your own development workflow. If your team wants to wire in a custom agent command, editor behavior, or stack convention, the tool is built for that kind of ownership.

---

## How it works

### Heading

From manifest to working local domain in one flow

### Steps

1. Define your services in `devhost.toml` or run a single service directly.
2. Start `devhost`.
3. `devhost` validates config, resolves ports, and reserves routed hosts.
4. Services start in dependency order.
5. Each route is activated only after its health check passes.
6. Open your local domain over HTTPS and use the injected devtools to inspect health, logs, source locations, and terminal sessions.

---

## Who it is for

### Heading

Built for developers who have outgrown `localhost:3000`

### Body

`devhost` is a strong fit for:

- frontend apps that need real hostnames and HTTPS locally
- full-stack projects with multiple dependent services
- teams debugging auth, callback, cookie, and routing behavior
- developers who want browser-native debugging tools tied to the actual local stack
- open source users who want local tooling they can inspect and extend

---

## Positioning section

### Heading

Not another container orchestrator. Not another mystery proxy.

### Body

`devhost` is focused.

It is not trying to replace Docker Compose, manage DNS for you, or become a remote orchestration platform. It solves a more specific and more painful problem: making local routed development feel correct, visible, and maintainable.

That focus is exactly why it stays useful.

---

## Open source section

### Heading

Open source utility, not locked-down infrastructure

### Body

Because `devhost` is open source, teams can audit behavior, understand how routing works, customize local workflows, and keep their development stack under their own control.

If you want local tooling you can trust, the correct answer is not "more magic." The correct answer is tooling you can read.

---

## FAQ-style copy

### Do I need to run a full stack every time?

No. `devhost` supports manifest-driven stack mode.

### Does it handle HTTPS locally?

Yes. `devhost` manages a local Caddy setup and provides lifecycle commands to start, stop, and trust the local CA.

### Will it route traffic before my app is ready?

No. Routed services are activated only after their health checks pass.

### Does it manage DNS too?

No. Your chosen hostnames still need to resolve to your machine. `devhost` manages local routing, not name resolution.

### Can I use it with my editor and agent workflow?

Yes. `devhost` supports configurable component-source navigation and agent-backed annotation sessions, including the default Pi workflow or a custom configured agent command.

---

## Closing section

### Heading

Make local development behave more like the real thing

### Body

If your app depends on real hostnames, HTTPS, multiple services, or tight browser-to-code feedback loops, `localhost` alone is not enough.

`devhost` gives you a cleaner local front door, better observability, and a faster path from what you see in the browser to the code that needs to change.

### Primary CTA

Try devhost

### Secondary CTA

Explore the configuration

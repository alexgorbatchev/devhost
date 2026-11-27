---
created_on: 2026-10-25 08:30
last_modified: 2026-11-25 14:30
status: current
---

# devhost architecture

Architecture diagrams for contributors working on service supervision, routing, and the injected browser UI.

[Service supervision and browser routing](overview.html) follows requests through shared Caddy, the per-service document proxy, the application, and the devtools control server. It separates that request path from the supervisor that selects and starts service processes.

The overview cites committed revision `bea147f374edd1114c2856c20e37c6cc33c63594`. It abstracts individual devtools features, service restart internals, worktree management, shared-daemon RPC multiplexing (`apps/devhost/src/daemon/`), and release deployment. Source references use local-only mode because the recorded repository identity uses SSH; inspect the cited paths at the pinned revision.

The dedicated stack directory is also outside that snapshot. Shared Caddy serves `https://devhost.localhost/` through any available stack control server, which reads live stack records and gathers read-only service and TOML snapshots from their loopback control listeners. Stack startup publishes its listener in the record; reload preserves it, and shutdown withdraws it before stopping the listener. With no registered backend, Caddy serves an embedded empty directory. See `apps/devhost/src/caddy/routes.rs`, `apps/devhost/src/devtools/directory.rs`, and `apps/devhost/src/statuspage.rs` for that path.

Native manifest `serve` services are outside the pinned diagram snapshot as well. `start_service_process` in `apps/devhost/src/services/stack.rs` starts `FileServer::start` in `apps/devhost/src/services/serve.rs`, which runs `apps/devhost/src/files/` inside the supervisor instead of spawning a command. The same document proxies, Caddy routes, health checks, and lifecycle operations apply. Each file handler pins its served directory through `apps/devhost/src/files/confined.rs`; stopping a native service closes its listener and file handler. The root stack uses this mode for the design package.

Command-mode `devhost serve` is outside the pinned snapshot. `apps/devhost/src/services/serve_command.rs` resolves a managed command session, discovers process-owned TCP listeners, verifies HTTP, and replaces routes through the same stack runtime. The command has process health; discovered ports are external route services. Detached startup reuses stack ownership and readiness, keyed by the generated session name instead of a manifest. Session inspection and stopping use the same live registrations.

Remote previews are outside the pinned snapshot. Stacks automatically use a configured relay unless started with `--local`. Short host labels receive the machine’s local or relay suffix before service commands resolve. Remote stacks register their active hosts with a shared machine connector in `apps/devhost/src/remote/`. The connector runs Chisel reverse forwarding through an authenticated outbound WebSocket, accepts only live remote-stack hosts, and proxies to shared Caddy with its local CA verified. The public gateway owns browser authentication and HTTPS; the connector rejects remote machine-configuration writes. Stack cleanup withdraws its lease, and the last lease stops the worker. See [Remote previews](../../../packages/docs/src/content/docs/stacks/remote-previews.md) for configuration and operational boundaries.

Inside the shared supervisor daemon (`apps/devhost/src/daemon/`), each hosted stack publishes a shared read model in `apps/devhost/src/services/stack/live.rs`, which the loopback server in `apps/devhost/src/devtools/server.rs` reads without waiting for service mutations. That server owns health, log, resource, and editor cursor streams, configuration editing, recovery controls, and the stack directory. `apps/devhost/src/services/stack_info.rs` reads its private snapshot endpoint for `devhost stack info`; `apps/devhost/src/services/stack/documents.rs` connects native document injection and recovery to the same live state. The control server owns its runtime, health poller, and resource sampler and joins them during shutdown.

## Viewing

1. Run `just run` from the repository root. The `archify` service starts with the stack, including service selections made through `just run-ai start`.
2. Open the printed architecture URL (`https://devhost-archify.localhost/` with the default local config). Machine config supplies the local or relay suffix.
3. Stop the stack to stop its architecture server. Caddy remains shared with other instances.

The Bun server binds to loopback on the port devhost assigns. It renders this Markdown index with YAML frontmatter shown as a compact metadata bullet list, without its delimiter lines, and serves HTML diagrams, including nested pages. It accepts GET and HEAD and returns 404 for source specifications, scripts, receipts, and missing pages. Committed HTML opens offline and needs no Archify installation to view.

## Regenerating

1. Install the [Archify skill](https://github.com/tt-a1i/archify) version 3.3.1 and set `ARCHIFY_CLI` to that installation's `bin/archify.mjs`.
2. Set `ARCHIFY_CHROME` to a supported Chrome/Chromium executable if browser discovery needs help. On isolated Linux validation hosts without a usable Chrome sandbox, Archify accepts `ARCHIFY_CHROME_NO_SANDBOX=1` for that command.
3. From the repository root, run `just archify build` (also the default for `just archify`). It validates source evidence, renders the HTML, checks provenance, and runs real-browser checks. A failed or skipped gate fails the recipe.
4. Review the changed diagram and commit its JSON specification and generated HTML together. Automated browser checks do not establish visual review. Run `just check` for repository validation.

Keep specifications and generated diagrams here, and link every delivered page from this index. Add its finalize command to the architecture justfile when adding a diagram. Recheck affected source ranges and behavior when updating the pinned revision; changing a revision label alone does not validate the content.

Delivery receipts alongside HTML and browser evidence under `.tmp/architecture-review/` are ignored local verification output. `.archify/` is scratch space. Keep workstation paths, browser captures, and private deployment hostnames out of committed artifacts. Deliver project diagrams through this site and verify the exact active HTTP(S) URL before reporting a live link.

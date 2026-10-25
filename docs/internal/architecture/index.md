---
created_on: 2026-10-25 08:30
last_modified: 2026-10-25 09:17
status: current
---

# devhost architecture

Architecture diagrams for contributors working on service supervision, routing, and the injected browser UI.

[Service supervision and browser routing](overview.html) follows requests through shared Caddy, the per-service document proxy, the application, and the devtools control server. It separates that request path from the supervisor that selects and starts service processes.

The overview cites committed revision `b2496c7459ac103a50fb3842b741d145b7c7d18d`. It abstracts individual devtools features, service restart internals, worktree management, and release deployment. The Archify site itself is contributor tooling added after that snapshot. Source references use local-only mode because the recorded repository identity uses SSH; inspect the cited paths at the pinned revision.

## Viewing

1. Run `just run` from the repository root. The `archify` service starts with the stack, including service selections made through `just run-ai start`.
2. Open `https://devhost-archify.localhost/`. The hostname uses the shared `DEVHOST_DEV_EXT` override from `.envrc.local`; reload direnv after changing it.
3. Stop the stack to stop its architecture server. Caddy remains shared with other instances.

The Bun server binds to loopback on the port devhost assigns. It renders this Markdown index with YAML frontmatter shown as a compact metadata bullet list, without its delimiter lines, and serves HTML diagrams, including nested pages. It accepts GET and HEAD and returns 404 for source specifications, scripts, receipts, and missing pages. Committed HTML opens offline and needs no Archify installation to view.

## Regenerating

1. Install the [Archify skill](https://github.com/tt-a1i/archify) version 3.2.0 and set `ARCHIFY_CLI` to that installation's `bin/archify.mjs`.
2. Set `ARCHIFY_CHROME` to a supported Chrome/Chromium executable if browser discovery needs help. On isolated Linux validation hosts without a usable Chrome sandbox, Archify accepts `ARCHIFY_CHROME_NO_SANDBOX=1` for that command.
3. From the repository root, run `just archify build` (also the default for `just archify`). It validates source evidence, renders the HTML, checks provenance, and runs real-browser checks. A failed or skipped gate fails the recipe.
4. Review the changed diagram and commit its JSON specification and generated HTML together. Automated browser checks do not establish visual review. Run `just check` for repository validation.

Keep specifications and generated diagrams here, and link every delivered page from this index. Add its finalize command to the architecture justfile when adding a diagram. Recheck affected source ranges and behavior when updating the pinned revision; changing a revision label alone does not validate the content.

Delivery receipts alongside HTML and browser evidence under `.tmp/architecture-review/` are ignored local verification output. `.archify/` is scratch space. Keep workstation paths, browser captures, and private deployment hostnames out of committed artifacts. Deliver project diagrams through this site and verify the exact active HTTP(S) URL before reporting a live link.

---
title: "Serve files or a port without a manifest"
---

Serve the current directory over local HTTPS:

```bash
devhost serve --domain notes.localhost
```

Or choose a directory, including paths with spaces:

```bash
devhost serve --dir "./my notes" --domain notes.localhost
```

Open `https://notes.localhost` after devhost prints the URL. `--domain` (or `-d`) is required and accepts a hostname, without a scheme, port, or path. The hostname must resolve to the machine running devhost. A `.localhost` hostname works for local access; another domain needs DNS or a hosts-file entry pointing here.

`--dir` and `--port` are mutually exclusive. With neither, devhost serves the current directory. Directory paths resolve from the current working directory. Positional arguments are rejected.

The command runs no build, installs no project dependencies, and reads no `devhost.toml`, including one selected by `DEVHOST_MANIFEST`.

## Route an existing port

Expose an HTTP service already listening on `127.0.0.1:3000`:

```bash
devhost serve --port 3000 --domain app.localhost
```

Open `https://app.localhost` after devhost prints the URL. `--port` (or `-p`) accepts an integer from `1` through `65535`. The upstream service must be reachable on IPv4 loopback and speak HTTP; this is HTTP reverse proxying, not a tunnel for arbitrary TCP protocols. For Docker, publish the container port onto the host first.

Devhost checks TCP readiness and routes requests through its usual stack routing, including the toolbar in HTML documents. It does not start, restart, or stop the external service. Start and manage that process separately. Ctrl-C removes the devhost route while leaving the service running. Use a manifest when you need custom health checks, service commands, or other stack configuration.

## HTTPS and stopping

Devhost starts its shared Caddy proxy automatically when needed. When it does and the system does not trust Caddy's local HTTPS certificate authority yet, it installs the authority once, which may ask for your password; `devhost caddy trust` does the same later. On Linux, prepare privileged ports once with `devhost caddy privileged-ports`. See [Managed Caddy](../../guides/managed-caddy/) for setup and troubleshooting.

The session stays in the foreground. **Ctrl-C** removes its routes and ownership records and, in directory mode, stops its file server. Caddy, external services, and other sessions remain running. Ctrl-C exits with `130`; SIGTERM exits with `143`. The working or served directory receives no manifest or runtime files. Temporary session state lives in devhost's state directory and is removed on normal shutdown.

Serve sessions use the usual hostname ownership checks, so a hostname already held by another live session is rejected. Use distinct hostnames for concurrent sessions. `devhost stack list` and `devhost stop --manifest` operate on manifest-backed stacks; stop a serve session from its terminal or by signaling its devhost process.

## Files and Markdown

Directories serve `index.html` first, then `index.md`. A directory with neither gets a clickable listing. Files are read on each request, so reloading shows changes and newly created files. Ordinary assets support GET, HEAD, and byte ranges. This is a static server: an unmatched URL returns 404 rather than falling back to a single-page application's entry point.

Listings and Markdown use the same React/shadcn interface as devhost's other built-in pages. An empty folder shows an empty state; JavaScript is required for rendered Markdown and its source toggle. Without JavaScript, the page still exposes escaped source text or directory links.

The breadcrumb above a listing or Markdown page links to its parent directories. Select **devhost** to return to the served root. The current location is shown as text; the root shows **devhost** once, including when it serves `index.md`.

Use the small **Show source** button to view the original Markdown and **Show rendered** to return. The choice is saved in browser local storage for that origin and applies to other Markdown pages, reloads, and later sessions on the same origin. If browser storage is unavailable, the toggle still works for the current page.

HTML documents, including rendered Markdown, receive the usual devhost toolbar. Dotfiles and directories beginning with `.` are hidden from listings and direct requests. Symlinks work within the served root; links to hidden paths or outside the root are excluded. Only regular files and directories are served.

---
title: "Serve files or a port"
---

`devhost serve` gives a folder or an already running HTTP server an HTTPS hostname, without a manifest.

## Serve a folder

```bash
devhost serve --domain notes.localhost
devhost serve --dir "./my notes" --domain notes.localhost
```

The first command serves the current directory; `--dir` picks another one, relative to the current directory. Open `https://notes.localhost` once devhost prints the URL.

- A folder serves `index.html`, then `index.md`, and otherwise shows a clickable listing.
- Files are read on every request, so a reload shows edits and new files.
- Markdown files (`.md`, any case) render as GitHub Flavored Markdown, without raw HTML or unsafe links. **Show source** switches to the raw text and **Show rendered** switches back; the choice is remembered for that hostname.
- A breadcrumb above each listing and Markdown page links to its parent folders; **devhost** returns to the served root.
- Listings and Markdown use the same React/shadcn interface as devhost's other built-in pages. An empty folder shows an empty state; JavaScript is required for rendered Markdown and its source toggle. Without JavaScript, the page still exposes escaped source text or directory links.
- Files support `GET`, `HEAD`, and byte ranges.
- Files and folders whose names start with `.` are not listed and not served. Symbolic links work only when they point inside the served folder.
- This is a static server: an unknown URL returns 404, with no fallback to a single-page app's `index.html`.

## Route a running server

```bash
devhost serve --port 3000 --domain app.localhost
```

This routes `https://app.localhost` to an HTTP server already listening on `127.0.0.1:3000`. devhost waits until the port accepts connections, then routes it like a stack service, including the devtools toolbar on HTML pages. It never starts, restarts, or stops that server. For a Docker container, publish its port on the host first.

Use a [manifest](../../guides/stack-lifecycle/) instead when you want devhost to run the server, check an HTTP health URL, or route several services.

## Options

| Option           | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--domain`, `-d` | Required. A hostname without scheme, port, or path. It must resolve to this machine; `.localhost` names always do. |
| `--dir`          | Folder to serve. Defaults to the current directory.                                                                |
| `--port`, `-p`   | Port of a running HTTP server on `127.0.0.1`, from `1` to `65535`. Cannot be combined with `--dir`.                |

`devhost serve` ignores any `devhost.toml`, including one named by `DEVHOST_MANIFEST`, and writes nothing into the served folder.

## HTTPS and stopping

`devhost serve` starts the shared Caddy when it is not running. The first time, devhost installs Caddy's local certificate authority, which can ask for your password; see [Route apps over HTTPS](../../guides/managed-caddy/#prepare-caddy).

The session runs in the foreground. **Ctrl-C** removes its route and stops the file server; Caddy and any server you routed keep running. A hostname held by another session or stack is rejected, so give concurrent sessions different hostnames. `devhost stack list` shows only manifest-backed stacks: stop a serve session from its terminal.

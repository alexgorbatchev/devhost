---
title: "Serve a command, files, or a port"
---

`devhost serve` launches a command and gives its HTTP listeners HTTPS URLs, or serves a folder or an already running HTTP server, without a manifest.

## Launch a command

```bash
devhost serve "bun start.ts"
devhost serve --detach -- bun start.ts
devhost serve --name dashboard "bun run dev"
```

A quoted command runs through `/bin/sh -c`; arguments after `--` launch directly. The command inherits the current directory and exported environment. Application-specific dotenv loading stays with the application or shell.

Devhost finds TCP listeners belonging to the command and its descendants, checks for an HTTP response, and prints the HTTPS URLs. Late listeners receive routes and closed listeners lose them. Other protocols remain unrouted and produce a waiting message. Any HTTP status, including a redirect or error, confirms HTTP support. HTTP checks use `HEAD /`; servers that stay silent on that request remain unrouted.

The generated name comes from `--name`, otherwise from the Git repository containing an existing command entrypoint path, then the current directory's Git repository, then its directory name, finally `app`. Repository names use the `origin` repository name when available, otherwise the repository directory name. Entrypoint inference recognizes common script extensions and a path to the executable; options such as `--config` and ambiguous paths spanning repositories fall back to the current directory. Names are lowercased, sanitized, and shortened to fit a hostname label.

One HTTP port receives `https://<name>-<session-id><domainSuffix>`, for example `https://dashboard-a13f0c92.localhost`. Concurrent launches get distinct random IDs. `--name` replaces only the inferred name. Multiple ports receive `https://<name>-<session-id>-<port><domainSuffix>`. When a second port appears later, the first short URL remains an alias for its original port alongside the port-qualified URLs. Published port-qualified URLs stay qualified when another port closes; the short alias is never reassigned to another port.

The command has 30 seconds to open its first HTTP listener; `--startup-timeout 1m` changes that limit. A launch error, early exit, or startup timeout fails the session and cleans up its processes and routes. After readiness, a foreground session exits with the command's exit code. **Ctrl-C** stops the command tree and its routes.

With `--detach`, devhost starts a supervisor on Linux or macOS, waits for the first HTTP route, and prints the session name, URLs, private log path, and stop command. The session survives the calling terminal. Inspect late URLs or stop it from any directory:

```bash
devhost stack list --sessions
devhost stack info --session dashboard-a13f0c92
devhost stop --session dashboard-a13f0c92
```

`stack list --sessions` prints PID, a tab, and session name. `--session` selects a manifest-free session instead of manifest discovery or `DEVHOST_MANIFEST`; an explicit `--manifest` is incompatible. Each command session uses its own log and process ownership. Caddy stays running after the session stops.

## Serve a folder

```bash
devhost serve --domain notes.localhost
devhost serve --dir "./my notes" --domain notes.localhost
```

The first command serves the current directory; `--dir` picks another one, relative to the current directory. Open `https://notes.localhost` once devhost prints the URL.

- A folder serves `index.html`, then `index.md`, then `README.md`, then `readme.md`, and otherwise shows a clickable listing confined to the served folder.
- Files are read on every request, so a reload shows edits and new files.
- Markdown files (`.md`, any case) render as GitHub Flavored Markdown. Lists show bullets, numbers, or task checkboxes. Raw HTML and unsafe links are disabled. A YAML front matter block at the start of the file (between `---` lines) renders as a table above the content, as on GitHub: keys in the header row, values below, nested mappings as nested tables and lists joined with commas. Front matter that is not a valid YAML mapping shows as a YAML code block. **Show source** switches to the raw text and **Show rendered** switches back; the choice is remembered for that hostname.
- A breadcrumb above each listing and Markdown page links to its parent folders; **devhost** returns to the served root.
- An empty folder shows an empty state. With JavaScript enabled, a Markdown page opens directly in the rendered view or your saved source view. With JavaScript disabled, the page shows escaped source text or directory links.
- Files support `GET`, `HEAD`, and byte ranges.
- Files and folders whose names start with `.` are not listed and not served. Symbolic links work only when they point inside the served folder.
- This is a static server: an unknown URL returns 404, with no fallback to a single-page app's `index.html`.

## Serve a folder in a stack

Use `serve` in `devhost.toml` to run the same file server as a managed service:

```toml
name = "project"

[services.design]
serve = "packages/design"
host = "design"
alwaysStart = true
```

Relative directories resolve against the manifest that declares the service, including an included manifest. They stay within the root manifest directory; absolute directories can point elsewhere. The directory must exist. File browsing and symlink access remain confined to that directory.

The service defaults to an automatic port and the loopback bind address. You can set `port` and `bindHost` explicitly, add host aliases or path routes, configure HTTP or TCP health checks, and use dependencies and service selection. `alwaysStart = true` keeps it available when you select other services. Path routes match the original request path; they do not strip a prefix from file paths.

Devhost owns the file server directly. Starting, stopping, restarting, manifest reloads, and worktree switches use the stack's normal service lifecycle. Files are read live, so edits need only a browser reload. `serve` replaces `command`; it rejects `cwd`, child-process `env`, `injectPort`, `lifecycle`, `proxyLocalOrigin`, `watch`, `managed = false`, and process-only health checks. The served directory also supplies the service's project directory for editor and chat tools.

## Route a running server

```bash
devhost serve --port 3000 --domain app.localhost
```

This routes `https://app.localhost` to an HTTP server already listening on `127.0.0.1:3000`. devhost waits until the port accepts connections, then routes it like a stack service, including the devtools toolbar on HTML pages. It never starts, restarts, or stops that server. For a Docker container, publish its port on the host first.

Use a [manifest](../../guides/stack-lifecycle/) for persistent service definitions, dependencies, explicit HTTP health checks, or remote previews.

## Options

| Option              | Meaning                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--domain`, `-d`    | Required for files or an existing port. A hostname without scheme, port, or path that resolves to this machine. Incompatible with command mode. |
| `--dir`             | Folder to serve. Defaults to the current directory.                                                                                             |
| `--port`, `-p`      | Port of a running HTTP server on `127.0.0.1`, from `1` to `65535`. Cannot be combined with `--dir`.                                             |
| `--name`, `-n`      | Command mode: override the inferred app name; the random session ID remains.                                                                    |
| `--detach`          | Command mode: return after the first HTTP route is ready. Defaults to false.                                                                    |
| `--startup-timeout` | Command mode: positive duration to wait for the first HTTP listener. Defaults to `30s`.                                                         |

`devhost serve` ignores any `devhost.toml`, including one named by `DEVHOST_MANIFEST`. Files and port modes write nothing into the served folder; command mode runs the supplied application there. All modes use local routing, even when `config.toml` configures a [relay](../../stacks/remote-previews/). Command hostnames use the machine's top-level `domainSuffix` (default `.localhost`); explicit `--domain` values stay unchanged. To preview through a relay, [use a stack](#serve-a-folder-in-a-stack) under a single-label `host`.

## HTTPS and stopping

`devhost serve` starts the shared Caddy when it is not running. The first time, devhost installs Caddy's local certificate authority, which can ask for your password; see [Route apps over HTTPS](../../guides/managed-caddy/#prepare-caddy).

File and existing-port sessions run in the foreground. **Ctrl-C** removes their routes and stops the file server; Caddy and any external server keep running. A hostname held by another session or stack is rejected, so give these sessions different hostnames. `devhost stack list` shows manifest-backed stacks; `devhost stack list --sessions` shows serve sessions. Use `devhost stop --session <name>` to stop one, including a background replacement from [`devhost stack restart --all`](../../guides/stack-lifecycle/#restart-after-upgrading-devhost). Command replacements preserve their generated session names.

---
title: "Run a stack"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.webp" aria-label="stack lifecycle demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/stack-lifecycle.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

A stack is everything one `devhost.toml` describes, started with one command and stopped with another. This page covers starting a stack in your terminal or detached from it, stopping it, and starting only the part of a stack you need.

## Start a stack

Describe your services in `devhost.toml`:

```toml
name = "hello"

[services.web]
command = ["bun", "run", "web:dev"]
port = 3000
host = "hello"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api-hello"
health = { http = "/healthz" }
```

Then start it from that directory or any directory below it:

```bash
devhost start
```

devhost uses the nearest `devhost.toml` in the current directory or a parent. Pass `--manifest path/to/devhost.toml`, or set `DEVHOST_MANIFEST`, to use another one. The [manifest reference](../../reference/devhost-example/) lists every setting.

On start, devhost:

1. Validates the whole manifest, and stops with a list of problems if anything is wrong.
2. Claims the stack's hostnames and fixed ports, and fails if another stack holds one.
3. Adds the routes in Caddy, so each hostname shows a startup page right away.
4. Starts services one at a time in dependency order, waiting for each health check before the next: `api` first, because `web` depends on it.
5. Switches each hostname from its startup page to the app once the app is healthy.
6. Prints one line per URL, such as `web (primary): https://hello.localhost`. A service without a `host` but with a `port` shows its direct `http://` address.

The shared Caddy must already be running; see [Prepare Caddy](../managed-caddy/#prepare-caddy).

During foreground startup, or after a detached stack is ready, a service that exits or fails its health check does not stop the stack. Its hostname shows the error and recent logs with a **Restart** button; see [Restarts and recovery](../../stacks/recovery/).

## Keep a stack running after the terminal closes

On Linux and macOS, use detached startup for a stack that must outlive a shell or an agent session:

```bash
devhost start --detach
# Or start only the services you need:
devhost start --detach web
```

The command waits until every started service, external ones included, passes its health check and its routes are registered. It then prints the stack's name and PID, one line per URL, and the stack's log file, and exits `0`:

```text
devhost | Started hello (PID 48211).
devhost | https://api-hello.localhost
devhost | https://hello.localhost
devhost | Log: ~/.local/state/devhost/logs/stack-<sha256>.log
```

The stack runs in a session and process group of its own and reads from `/dev/null`, so closing the terminal or ending the calling process group leaves it running. Its output goes to that log, one private file per manifest in the [state directory](../../reference/cli/#files-and-directories), and every detached start of the manifest appends to it. Follow it with `tail -f` on the printed path.

If a started service fails to launch, fails its health check, or exits before the stack is ready, devhost stops the stack and removes its routes and registration. It does the same when startup runs out of time, and when you press Ctrl-C, send `SIGTERM`, or close the terminal while the command waits. The command waits for that cleanup, prints up to the last 30 lines this start wrote to the log, and exits `1`. Its last line names the cause and the full log; [Terminal output](../../reference/output/#detached-start) lists the causes. Shared Caddy and externally managed services keep running. Once startup succeeds, ordinary [service recovery](../../stacks/recovery/) and [idle shutdown](#stop-automatically-when-idle) apply.

Startup has two minutes, plus each started service's health-check `timeout` and 10 seconds; a service with `port = "auto"` gets that four times, once for each port it can try. The wait for cleanup lasts at most a minute plus 20 seconds per started service, and Ctrl-C during that wait ends it sooner (after a Ctrl-C canceled the start, that is the second one). The command then reports the stack's PID as still stopping and exits; the stack finishes its cleanup on its own, and `devhost stack list` shows when it has.

Repeating `--detach` while a stack from the same manifest runs in the same local or remote mode starts nothing, even through a symlink or when that stack was started in the foreground: the command prints `Already running hello (PID 48211).` and the stack's log, when it has one, and exits `0`. It does not change the running service selection. A repeat made while another detached start of the manifest is still starting waits for that start to finish first, and a repeat made while a failed start's stack is still stopping waits for it to stop, then starts a new stack. Other overlaps fail a detached start as they fail a foreground one: a manifest it shares with another stack through `includes`, or a hostname or fixed port another stack holds. The log tail shows which.

For browser access away from the development machine, [enroll the machine](../../stacks/remote-previews/), then use `devhost start --detach`; `[remote]` selects relay routing automatically. Use `--local` to keep a run local or `--remote` to require enrollment explicitly. Remote startup also waits for the relay connection and prints public URLs. Switching between local and remote mode requires stopping the existing stack first.

Use `devhost stop`, `devhost stack info`, `devhost stack list`, `devhost stack find`, and `devhost stack restart` as usual; they too find the stack through any path to its manifest. `--detach` has no short flag: `-d` still means `--debug`.

## Inspect a running stack

From the manifest directory or any subdirectory inside the project, run `devhost stack info` to check the running stack's live service states, URLs, PID, mode (`foreground` or `detached`), and log file:

```bash
devhost stack info
```

The command queries the running stack directly. A crashed service shows as `exited` with its exit code and last output line, even when the stack runs in another terminal or with every toolbar feature turned off. Pass `--manifest path/to/devhost.toml` (or set `DEVHOST_MANIFEST`) to inspect a stack from outside its project. After upgrading from a version that predates this command, [restart the stack](#restart-after-upgrading-devhost) to enable live queries.

Run with `AGENT=1` for machine-readable `devhost:` lines that include absolute manifest and included manifest paths, the control port, log path, creation time, and per-service ports, URLs, timestamps, exit codes, and last error lines. `devhost stack info` exits `0` when every started service is ready and `1` when any started service is not ready or no stack is running; see [Stack info](../../reference/output/#stack-info).

## Service commands and working directories

Commands run directly, not through a shell:

```toml
# Passes the literal text "$PORT" to storybook:
command = ["storybook", "dev", "--port", "$PORT"]

# Runs a shell, which expands $PORT from the environment:
command = ["sh", "-c", "exec storybook dev --port \"$PORT\""]
```

`{{ env.NAME }}` and `{{ services.<name>.port }}` placeholders are filled in before the command runs, so they need no shell. See [Environment variables](../environment-variables/) and [Connect services](../service-references/).

`cwd` sets a service's working directory: an absolute path, or a path relative to the manifest's directory that stays inside it. It defaults to the manifest's directory. devhost checks that the directory exists before starting the service and names `services.<name>.cwd` when it does not.

## Start part of a stack

A large manifest, such as one for a whole monorepo, usually describes more services than one task needs. Name the services you are working on:

```bash
devhost start web admin
```

devhost starts the named services, everything they reach through `dependsOn`, and every service marked `alwaysStart = true` with its own dependencies. Set `alwaysStart` on services every task needs, such as a database. The rest are **not started**: they run no process and hold no hostname or port, so another stack can use them.

With this manifest:

```toml
[services.db]
command = ["bun", "run", "db:dev"]
port = "auto"
alwaysStart = true

[services.api]
command = ["bun", "run", "api:dev"]
port = "auto"
dependsOn = ["db"]

[services.web]
command = ["bun", "run", "web:dev"]
port = "auto"
host = "web-acme"
dependsOn = ["api"]

[services.admin]
command = ["bun", "run", "admin:dev"]
port = "auto"
host = "admin-acme"
dependsOn = ["api"]

[services.docs]
command = ["bun", "run", "docs:dev"]
port = "auto"
host = "docs-acme"
```

| Command                   | Starts                       | Not started           |
| ------------------------- | ---------------------------- | --------------------- |
| `devhost start web`       | `web`, `api`, `db`           | `admin`, `docs`       |
| `devhost start web admin` | `web`, `admin`, `api`, `db`  | `docs`                |
| `devhost start docs`      | `docs`, `db` (`alwaysStart`) | `api`, `web`, `admin` |
| `devhost start`           | everything                   | none                  |

Plain `devhost start` always starts every service. An unknown name fails before anything starts and lists the names the manifest defines. Startup prints the services it left out:

```text
[acme] not started: admin, docs
```

To pick services interactively, list them with `devhost service list`. `--startable` leaves out the `alwaysStart` services, which start anyway:

```bash
devhost start $(devhost service list --startable | fzf --multi)
```

### Named service groups

Give a selection a short name under `[groups]`:

```toml
[groups]
app = ["web"]
backoffice = ["admin"]
```

`devhost start app` starts `web` and its dependencies. Mix groups and services freely: `devhost start app docs`. In a monorepo, each package can define its own group in its [included manifest](../manifest-includes/).

- Group names follow service-name rules (a lowercase letter, then lowercase letters, digits, or hyphens), are unique across all included files, and cannot match a service name.
- A group lists one or more services. Groups cannot contain other groups.
- `devhost service list` lists services, not groups.

### Starting the rest later

With the devtools toolbar, the Services panel shows **Stopped services** with a count. **Start** on one starts it and what it depends on, without touching the running services. If it fails, the error shows in the list and the service stays stopped.

A service that is not started keeps an assigned address, so `{{ services.<name>.port }}` and `DEVHOST_PORT_<NAME>` resolve the same way before and after it starts. Referring to a service does not start it; list it in `dependsOn` for that.

The names you started with last for the whole run: hot reloads and **Restart Stack** keep them, and an edited group's new members join the running selection. To change the selection, stop the stack and start it again.

## Stop a stack

Press **Ctrl-C** in the stack's terminal, or run this from the manifest's directory:

```bash
devhost stop
devhost stop --manifest path/to/devhost.toml
```

devhost prints `Stopping service <name>...` and `Stopped service <name>.` for each service, then `Stack stopped.` once every service and route is cleaned up. If cleanup fails, it names the services instead of claiming success. Ctrl-C exits with code `130`, `SIGTERM` with `143`.

`devhost stop` sends the stack `SIGTERM`, waits up to 15 seconds, and then kills whatever is left. When nothing runs from that manifest, it says so, exits `0`, and points to `devhost stack list` if other stacks are running.

### Stop a stack started elsewhere

`devhost stack list` prints every running stack as its PID, a tab, and its absolute manifest path:

```bash
devhost stack list
# 3596463	/home/me/projects/app/devhost.toml
```

Pass a path to `devhost stop --manifest`, from any directory. With [`fzf`](https://github.com/junegunn/fzf), or any picker that prints the line you choose:

```bash
devhost stop --manifest "$(devhost stack list | fzf | cut -f2)"
devhost stop --manifest "$(devhost stack list | cut -f2 | grep my-project)"
```

To find the stack behind a URL, hostname, stack name, or path, use `devhost stack find`. A URL matches its hostname exactly; anything else matches part of a hostname, stack name, or manifest path, ignoring case. A path to a manifest file, relative to the current directory unless absolute, also finds the stack started from that file through a symlink:

```bash
devhost stack find https://app.localhost
devhost stack find app
devhost stack find ./devhost.toml
```

It prints matches in the same format and prints nothing, successfully, when nothing matches.

### Stop every worktree of a repository

```bash
devhost stop --worktrees
```

This stops every stack whose root manifest is in the current Git repository, including its linked worktrees, and prints each one first. Other repositories and Caddy keep running. Plain `devhost stop` suggests `--worktrees` when it sees other stacks in the same repository.

## Restart after upgrading devhost

After installing a new devhost executable, replace the running supervisors:

```bash
devhost stack restart --all
```

This includes manifest stacks and standalone `serve` sessions in the same state directory. To restart only this project's running stack, use `devhost stack restart`; `--manifest path/to/devhost.toml` selects another project. `--all` cannot be combined with `--manifest` or `DEVHOST_MANIFEST`.

The [experimental Rust CLI](../../development/building/#try-the-rust-port) uses `devhost restart-all` for this global operation on Linux and macOS, including from outside a project. Its `devhost stack restart --all` resolves the nearest root manifest from the current directory and restarts that project's whole stack. The same manifest-option restriction applies.

The command captures every selected process's arguments, working directory, and environment before stopping any stack. It then stops and relaunches each stack with the executable running the restart command. Service selections, flags, and saved worktree choices carry over. Services started later through the UI follow the original launch selection. Manifests and shared configuration are read again from disk.

Replacements run in the background with closed standard input. Each gets a private log under the devhost state directory; the command prints its path and new PID. The original foreground command exits. Use `devhost stop` for a manifest stack, or signal a standalone session's PID, to stop its replacement.

A replacement starts like a foreground stack, even when it replaces a stack started with `--detach`: no command waits for its readiness, so a service that fails its health check goes to [recovery](../../stacks/recovery/) while the rest of the stack keeps running. A detached stack's replacement records its new log path, which `devhost start --detach` then reports.

Shutdown has a 15-second grace period. A stack that is still stopping is reported as a failure and gets no replacement; it is not force-killed. A replacement has 30 seconds to register its control server; registration confirms the supervisor started, while its services may still be starting. A registration timeout leaves the replacement running and prints its PID and log path. Failures return a nonzero exit code while the command attempts the remaining captured stacks. Shared Caddy stays running.

## Stop automatically when idle

An idle timeout stops the stack after a period without activity:

```toml
[devtools]
idleTimeout = "1h"
```

`devhost start --idle-timeout 30m` and `DEVHOST_IDLE_TIMEOUT` set it too; the flag wins over the variable, which wins over the manifest. A saved change to `idleTimeout` applies at once unless the flag or variable sets it.

Each of these counts as activity and restarts the countdown:

- an open page with the devtools toolbar,
- a request through Caddy to one of the stack's hostnames,
- a chat turn in progress, or one waiting for your answer.

Reloading a page closes its connection for a moment; the countdown restarts then, so a reload never triggers a shutdown. devhost logs `Idle timeout enabled: 1h` at startup and `Idle timeout of 1h reached` before it stops the stack.

## Running stacks in the browser

[https://devhost.localhost/](https://devhost.localhost/) lists every stack running on this machine by default. Set `[caddy].stackDirectoryHost` in the shared `config.toml` to choose another hostname; see [Proxy ports and listeners](../shared-managed-caddy-settings/#choose-the-stack-directory-hostname). With a custom `httpsPort`, add the port: `https://devhost.localhost:8443/`.

Stacks appear in a single column of compact cards showing their PID, directory, and services. Service names, statuses, and URLs use aligned table columns across stacks; on narrow screens the status sits below the service name. Configuration labels and values also align across cards. Counts of the listed stacks and URLs appear above the filter. Service URLs are the main links, including every alias and path route; services left out of the selection are marked **Not started**. Sessions from `devhost serve` appear too. Exited processes are excluded even while their parent has not reaped them, and their hostname and fixed-port claims can be reused.

- **Configuration** expands the root manifest path and file list. Expand a file to read the root manifest, each included manifest, or `config.toml` from disk. A rejected edit on disk can differ from what the stack runs.
- **Refresh / filter** reloads the list or filters it by stack, service, URL, or path.
- **Clear filter** restores the full list; an empty search result also offers **Show all stacks**.
- The page accepts local clients by default. Set `[caddy].stackDirectoryAllowRemote = true` in `config.toml` to permit other devices to read it, including its raw configuration files. It remains read-only and works without the devtools toolbar.

Any running stack can serve the page. After the last stack stops cleanly, the page shows an empty list until Caddy stops. If every stack exits without cleaning up, the page says it is unavailable until a stack starts again.

## How devhost stops services

Stopping is best-effort and depends on the platform:

- On Linux, devhost tracks every process a service starts, including orphaned ones.
- On macOS and elsewhere, it finds descendants by walking the process tree, which can miss a process that detached.
- On every platform, after a service with a port stops, devhost watches that port for 2 seconds and stops any process it started that binds it again. A restart therefore takes about 2 seconds longer. Outside Linux this needs `lsof`.

A service that daemonizes or detaches itself cannot be stopped this way; use [daemon mode](../managed-daemon-style-services/). If devhost cannot stop a service during shutdown, it exits non-zero and reports what is still running.

## Related pages

- [Hot reload](../../stacks/hot-reload/): what happens when you save the manifest.
- [Restarts and recovery](../../stacks/recovery/): startup pages, crashed services, and **Restart Stack**.
- [Git worktrees](../../stacks/worktrees/): switch the stack to another checkout.
- [Terminal output](../../reference/output/): log prefixes, colors, and `AGENT=1`.

---
title: "Terminal output"
---

Identify which service produced a message and give scripts predictable output without terminal decoration. devhost writes for people by default and for agents and scripts with `AGENT=1`. Agent mode can include extra diagnostic fields. Exit codes are the same in both modes.

## Stack logs

A running stack prints its own messages and every service's output, each line labeled with who wrote it. devhost's own lines use the manifest's `name`, or `devhost` before the manifest is read. A `devhost serve` session has no manifest, so its name is `serve-` followed by its `--domain` value, such as `serve-notes.localhost`; `devhost stack restart` reports the session by that name.

For people (`AGENT` unset or `0`), names are padded to a shared width and followed by `| `:

```text
api      | listening
hello    | web (primary): https://hello.localhost
web      | a long line continues here
         | with the same separator alignment
```

- Each name gets its own color; a service's stdout and stderr share it. A non-empty `NO_COLOR`, `TERM=dumb`, or redirected output turns colors off.
- Long lines wrap to the terminal width with the name column left blank. When devhost cannot read the terminal's size it uses `COLUMNS`; with no width, lines are not wrapped. Wrapping keeps your tools' own colors and handles wide characters.

For agents (`AGENT=1`, `true`, or `yes`), each line is `name: message`, with no padding, colors, or wrapping:

```text
api: listening
hello: web (primary): https://hello.localhost
```

Your services' output is never changed apart from the label.

## Output for agents

`AGENT=1` changes more than logs:

- **Help** becomes compact `key: value` text listing every command below the one you asked about, and starts with a line telling the agent to read `devhost skill`.
- **Errors** print as one `devhost: ERR:` line with the complete error. For people they print as `devhost | [ERROR]`, often followed by an `[INFO]` hint.
- **Warnings** print as `WARN:` instead of `[WARN]`.
- **Caddy's certificate prompt** is never shown; devhost prints a warning naming `devhost caddy trust` instead.

```console
$ devhost star
devhost | [ERROR] unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
devhost | [INFO] Run "devhost --help" for usage.
$ AGENT=1 devhost star
devhost: ERR: unknown command "star" for "devhost"; did you mean "stack" or "start" or "stop"?
```

Errors, warnings, `devhost stop` progress, and the log tail of a failed `devhost start --detach` go to stderr. Paths under your home directory are shortened to `~/` in devhost's own messages. Output meant for other programs is identical in both modes: `devhost stack list`, `stack find`, `service list`, `--version`, completion scripts, and `devhost caddy print-root-cert`, which also keep absolute paths.

## Caddy's lines

Lines Caddy writes are labeled `caddy` (`caddy | ` or `caddy: `); devhost's own messages about Caddy are labeled `devhost`.

- Successful route changes print nothing; `devhost start --debug` shows them.
- After a command succeeds, devhost shows only Caddy's warnings and errors. After a failure it shows everything else too.
- Security warnings, including unprotected on-demand TLS, are shown even when the command succeeds.
- devhost leaves out lines it reports itself or that no setting of yours can change: Caddy's start confirmation, notes about the Caddyfile devhost generates, and trust-store notices such as `not NSS security databases found` or `define JAVA_HOME environment variable to use the Java trust`, which only mean there is no Firefox or Java trust store to update.

Caddy's full log stays in `<state>/caddy/caddy.runtime.log`; see [Files and directories](../cli/#files-and-directories).

## Detached start

`devhost start --detach` prints its own lines with the `devhost` label, not the manifest's name; the stack's output goes to its log. When the stack is ready, or already running, it writes to stdout and exits `0`:

| Line                                                  | Meaning                                                                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Started hello (PID 48211).`                          | The stack is ready: every started service passed its health check and its routes are registered. One line per URL follows, such as `https://hello.localhost`, in the order the manifest lists the services. |
| `Already running hello (PID 48211).`                  | A stack from the same manifest was already running in the requested local or remote mode, so nothing was started.                                                                                           |
| `Log: ~/.local/state/devhost/logs/stack-<sha256>.log` | The file the stack's output is appended to; see [Files and directories](../cli/#files-and-directories). Left out when the running stack was started in the foreground, which has no log.                    |

With [remote routing](../../stacks/remote-previews/) selected automatically by machine configuration or explicitly with `--remote`, readiness also requires a connected relay, and both a new start and an already-running remote stack print public HTTPS URLs. This does not verify public DNS or gateway authentication. A repeat requesting a different local or remote mode fails and asks you to stop the existing stack first.

A failed start writes to stderr and exits `1`. Its last line names the cause and the full log. When the command launched a stack that then failed or that it stopped, it first prints `Startup log tail:` and up to the last 30 lines this start wrote to the log, as the stack wrote them. The first `[ERROR]` line below is the stack's own, from the log; the last two are the command's:

```console
$ devhost start --detach
devhost | Startup log tail:
api     | listening on :4000
hello   | Waiting for service api to pass its HTTP health check on http://127.0.0.1:4000/healthz (elapsed: 2s; timeout: 3s)...
hello   | Service api did not pass its health check within 3000ms. HTTP health check requires a 2xx response from http://127.0.0.1:4000/healthz. Check the app's startup logs and services.api.health.http. Stopping service api because its startup health check failed; sending SIGTERM (signal 15).
devhost | [ERROR] Service api did not pass its health check within 3000ms. HTTP health check requires a 2xx response from http://127.0.0.1:4000/healthz. Check the app's startup logs and services.api.health.http.
devhost | [ERROR] service api did not become ready
devhost | [INFO] Read the full log in ~/.local/state/devhost/logs/stack-<sha256>.log.
```

With `AGENT=1` the last line holds the cause and the log together:

```text
devhost: ERR: service api did not become ready; full log: ~/.local/state/devhost/logs/stack-<sha256>.log
```

| Cause                                                                                                                   | Meaning                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service api did not become ready`                                                                                      | A started service failed to launch, failed its health check, or exited before the stack was ready. The log tail shows its error.                                                                                                            |
| `the stack exited before it was ready (exit code 1)`                                                                    | The stack stopped before any service failed, for example because another stack holds one of its manifests, hostnames, or fixed ports. The log tail shows why.                                                                               |
| `the stack was not ready within 2m40s`                                                                                  | Startup ran out of time; see [Keep a stack running after the terminal closes](../../guides/stack-lifecycle/#keep-a-stack-running-after-the-terminal-closes) for how long it gets.                                                           |
| `received SIGINT (Ctrl-C) (signal 2) before the stack was ready`                                                        | You pressed Ctrl-C while the command waited. `SIGTERM` and `SIGHUP`, which closing the terminal sends, name themselves the same way.                                                                                                        |
| `another start of this manifest did not finish within …`, `received … while another start of this manifest was running` | The command ran out of time, or got a signal, while it waited for another detached start of the same manifest: one still starting, or a failed one whose stack was still stopping. This start launched no stack, so no log tail is printed. |
| `the stack supervisor could not be launched: …`                                                                         | devhost could not run its own executable in the background. No log tail is printed.                                                                                                                                                         |

When the stack's cleanup takes longer than the command waits for it, or a signal received during that wait ends it (after a signal canceled the start, that takes another one), the cause ends with `; the stack (PID 48211) is still stopping`, and the hint for people adds `Run "devhost stack list" to see when it has stopped.` Starting the manifest again waits until that stack has stopped.

When devhost cannot prepare the start in its state directory, the command fails before it launches anything, so there is no log tail. The cause names the step: `the stack log directory could not be created`, `the start lock could not be opened`, `the running stacks could not be read`, `the failure record of the previous start could not be removed`, `the stack log could not be opened`, or `the stack log could not be read`. People get a hint naming the state directory; with `AGENT=1` the line adds the system's error, such as `the stack log could not be opened: open …/stack-<sha256>.log: permission denied`. `devhost could not find its own executable` also fails before anything is launched; its hint suggests running `devhost start` without `--detach`.

On systems other than Linux and macOS the command fails at once with `devhost start --detach runs on Linux and macOS, not <system>`. For people, an `[INFO]` hint suggests running `devhost start` without `--detach`.

## Stack info

`devhost stack info` queries the running stack's live state from the manifest directory or any subfolder (or `--manifest <path>`). It works for both foreground and detached stacks, even when every devtools feature is disabled.

For people (`AGENT` unset or `0`), it prints a concise summary header, one aligned row per service with its live state and URLs (or `(no route)`), the last output line below an exited or failed service, and the home-shortened log path for detached stacks:

```text
Acme Shop · degraded · PID 8519 · detached · up 12m
web (primary)  ready     https://shop.acme.localhost
api            exited 1  https://shop.acme.localhost/api/
  └ fatal: lost connection to the payments database
worker         ready     (no route)
Log: ~/.local/state/devhost/logs/stack-<sha256>.log
```

For agents (`AGENT=1`, `true`, or `yes`), it prints `devhost:` key-value lines with absolute manifest, included manifest, and log paths, the control port, creation time, and per-service state, primary flag, exit code, state timestamp, port, URLs, and last output line for exited or failed services:

```text
devhost: stack name="Acme Shop" pid=8519 mode=detached ready=false manifest=/abs/devhost.toml manifestFiles=/abs/devhost.toml,/abs/admin/devhost.toml controlPort=41231 log=/abs/stack-<sha256>.log createdAt=2026-11-20T14:01:02Z
devhost: service name=web state=ready primary=true since=2026-11-20T14:01:05Z port=22250 url=https://shop.acme.localhost
devhost: service name=api state=exited exitCode=1 since=2026-11-20T14:01:53Z port=22310 url=https://shop.acme.localhost/api/ last="fatal: lost connection to the payments database"
devhost: service name=worker state=ready since=2026-11-20T14:01:05Z
```

`devhost stack info` exits `0` after startup completes and every started service is `ready`. Live health checks run together with a one-second budget. A check that times out reports its service as `unhealthy` alongside the rest of the stack. Services omitted by a partial start report `not-started` and are excluded from readiness. The command exits `1` while the stack is starting, when a started service is unready, or when it cannot query a running stack for the manifest.

## Messages worth knowing

| Message                                                         | Meaning                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `web (primary): https://app.localhost`                          | A service's URL, printed once it starts. One line per URL.                                                                                  |
| `not started: admin, docs`                                      | Services left out because you named others on `devhost start`.                                                                              |
| `configuration reloaded: devhost.toml, …`                       | A saved manifest edit was applied. See [Hot reload](../../stacks/hot-reload/).                                                              |
| `configuration reload rejected`                                 | A saved edit was invalid; the stack keeps running as it was.                                                                                |
| `Received SIGINT (Ctrl-C) (signal 2); shutting down the stack.` | Printed at once on the first shutdown signal; `SIGTERM` and `SIGHUP` name themselves the same way.                                          |
| `Stopping service web...` / `Stopped service web.`              | Shutdown progress for each service.                                                                                                         |
| `Stack stopped.`                                                | Every service and route was cleaned up. Wait for this line before assuming the stack is gone.                                               |
| `... sending SIGTERM (signal 15)`                               | devhost is stopping a service that failed its health check. A following `exited with code 143` from your tool is that stop.                 |
| `Stopping zombie PID ...` / `Stopped zombie PID ...`            | A process left by an earlier run is being cleaned up. See [Zombie cleanup messages](../../guides/troubleshooting/#zombie-cleanup-messages). |
| `Idle timeout of 1h reached`                                    | The [idle timeout](../../guides/stack-lifecycle/#stop-automatically-when-idle) is stopping the stack.                                       |

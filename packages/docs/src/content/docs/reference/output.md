---
title: "Terminal output"
---

devhost writes for people by default and for agents and scripts when `AGENT=1` is set. Both modes print the same information with the same exit codes; only the layout differs.

## Stack logs

A running stack prints its own messages and every service's output, each line labeled with who wrote it. devhost's own lines use the manifest's `name`, or `devhost` before the manifest is read.

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

Errors, warnings, and `devhost stop` progress go to stderr. Paths under your home directory are shortened to `~/` in devhost's own messages. Output meant for other programs is identical in both modes: `devhost stack list`, `stack find`, `service list`, `--version`, completion scripts, and `devhost caddy print-root-cert`, which also keep absolute paths.

## Caddy's lines

Lines Caddy writes are labeled `caddy` (`caddy | ` or `caddy: `); devhost's own messages about Caddy are labeled `devhost`.

- Successful route changes print nothing; `devhost start --debug` shows them.
- After a command succeeds, devhost shows only Caddy's warnings and errors. After a failure it shows everything else too.
- devhost leaves out lines it reports itself or that no setting of yours can change: Caddy's start confirmation, notes about the Caddyfile devhost generates, and trust-store notices such as `not NSS security databases found` or `define JAVA_HOME environment variable to use the Java trust`, which only mean there is no Firefox or Java trust store to update.

Caddy's full log stays in `<state>/caddy/caddy.runtime.log`; see [Files and directories](../cli/#files-and-directories).

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

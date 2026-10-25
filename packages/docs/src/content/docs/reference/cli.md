---
title: "CLI"
---

Every `devhost` command, flag, and environment variable. Run any command with `--help` for the same information in your terminal; `devhost caddy`, `devhost service`, `devhost stack`, and `devhost completion` print their subcommands when run alone.

## Stacks

| Command                               | Does                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devhost start [service-or-group...]` | Starts the stack of the nearest `devhost.toml`. With names, starts only those services or [groups](../../guides/stack-lifecycle/#named-service-groups), their dependencies, and `alwaysStart` services.                                                                                                                                      |
| `devhost stop`                        | Stops the stack of the nearest `devhost.toml`. Waits 15 seconds, then kills what is left.                                                                                                                                                                                                                                                    |
| `devhost stack list`                  | Prints every running manifest-backed stack: PID, a tab, and the absolute manifest path, sorted by path.                                                                                                                                                                                                                                      |
| `devhost stack find <query>`          | Prints the stacks whose hostname matches a URL exactly, or whose hostname, name, or manifest path contains the query (ignoring case). Same format as `stack list`.                                                                                                                                                                           |
| `devhost stack restart [--all]`       | Restarts this project, or every stack and serve session in the same state directory, using this executable. Preserves launch arguments, working directory, and environment; replacements run in the background with printed private log paths. See [Restart after upgrading](../../guides/stack-lifecycle/#restart-after-upgrading-devhost). |
| `devhost service list`                | Prints the manifest's service names, one per line, sorted.                                                                                                                                                                                                                                                                                   |
| `devhost serve`                       | [Serves a folder or a running local server](../../start/serve/) over HTTPS without a manifest.                                                                                                                                                                                                                                               |

| Flag                              | Commands                                         | Meaning                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--manifest`, `-m <path>`         | `start`, `stop`, `service list`, `stack restart` | The `devhost.toml` to use instead of the nearest one. Also `DEVHOST_MANIFEST`; the flag wins.                                                                                                                                                       |
| `--idle-timeout`, `-i <duration>` | `start`                                          | Stop the stack after this long without activity, such as `30s` or `1h`. Also `DEVHOST_IDLE_TIMEOUT`; the flag wins, and both win over the manifest. See [Stop automatically when idle](../../guides/stack-lifecycle/#stop-automatically-when-idle). |
| `--debug`, `-d`                   | `start`                                          | Show Caddy's output for every route change.                                                                                                                                                                                                         |
| `--worktrees`, `-w`               | `stop`                                           | Stop every stack whose root manifest is in this Git repository, including linked worktrees.                                                                                                                                                         |
| `--all`, `-a`                     | `stack restart`                                  | Restart all manifest stacks and standalone serve sessions in this state directory. Cannot be combined with `--manifest` or `DEVHOST_MANIFEST`.                                                                                                      |
| `--startable`, `-s`               | `service list`                                   | Leave out `alwaysStart` services, which start whether or not you name them.                                                                                                                                                                         |
| `--domain`, `-d <hostname>`       | `serve`                                          | Required. The hostname to serve.                                                                                                                                                                                                                    |
| `--dir <path>`                    | `serve`                                          | Folder to serve; defaults to the current directory.                                                                                                                                                                                                 |
| `--port`, `-p <port>`             | `serve`                                          | Port of a running HTTP server on `127.0.0.1`. Cannot be combined with `--dir`.                                                                                                                                                                      |

## Caddy

| Command                                   | Does                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `devhost caddy download`                  | Downloads the Caddy binary devhost manages. Without it, devhost uses the `caddy` on your `PATH`.                                    |
| `devhost caddy start`                     | Starts the shared Caddy in the background, and installs its certificate authority when the system does not trust it yet.            |
| `devhost caddy stop`                      | Stops the shared Caddy.                                                                                                             |
| `devhost caddy trust`                     | Installs Caddy's certificate authority into the system trust store. Asks for your password, or reports that it is already trusted.  |
| `devhost caddy trust-remote <ssh-target>` | macOS: fetches another machine's Caddy root certificate over SSH, prints its fingerprint, and installs it into the System keychain. |
| `devhost caddy print-root-cert`           | Prints Caddy's root certificate in PEM form.                                                                                        |
| `devhost caddy privileged-ports`          | Linux: lets the managed Caddy bind ports below 1024 without root, using `setcap`. Downloads Caddy first if needed.                  |

See [Route apps over HTTPS](../../guides/managed-caddy/) for how these fit together.

## Other commands

| Command                                          | Does                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devhost --version`, `-v`                        | Prints the version.                                                                                                                                  |
| `devhost skill`                                  | Prints how to install the devhost skill for AI coding agents.                                                                                        |
| `devhost completion bash\|zsh\|fish\|powershell` | Prints a shell completion script. `--no-descriptions` leaves out command descriptions; `devhost completion <shell> --help` says where to install it. |

Load completions for the current shell session:

```bash
source <(devhost completion bash)   # needs the bash-completion package
source <(devhost completion zsh)    # after compinit
devhost completion fish | source
```

## Exit codes

| Code                                        | When                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `0`                                         | Success. `devhost stop` with no stack running, and `devhost stack find` with no match, also exit `0`. |
| `1`, or the exit code of a tool devhost ran | The command failed; the error says why.                                                               |
| `130`                                       | A foreground stack or `devhost serve` stopped by **Ctrl-C**.                                          |
| `143`                                       | A foreground stack or `devhost serve` stopped by `SIGTERM`.                                           |

A stack that cannot stop all of its services exits non-zero and lists what is still running.

## Environment variables

These change how devhost itself behaves. For the variables devhost passes to your services, see [Environment variables](../../guides/environment-variables/).

| Variable                 | Effect                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `AGENT`                  | `1`, `true`, or `yes` switches every command to [output for agents and scripts](../output/#output-for-agents).                 |
| `DEVHOST_MANIFEST`       | Same as `--manifest`. Ignored by `devhost serve`.                                                                              |
| `DEVHOST_IDLE_TIMEOUT`   | Same as `--idle-timeout`.                                                                                                      |
| `DEVHOST_STATE_DIR`      | The state directory. Each state directory has its own Caddy and its own set of stacks.                                         |
| `XDG_STATE_HOME`         | The state directory becomes `$XDG_STATE_HOME/devhost` when `DEVHOST_STATE_DIR` is unset.                                       |
| `DEVHOST_CONFIG_DIR`     | The folder holding `config.toml`.                                                                                              |
| `XDG_CONFIG_HOME`        | `config.toml` is read from `$XDG_CONFIG_HOME/devhost` when `DEVHOST_CONFIG_DIR` is unset.                                      |
| `NO_COLOR`               | Any non-empty value turns off the colors devhost adds. `TERM=dumb` does too.                                                   |
| `COLUMNS`                | Terminal width for wrapping log lines, used when devhost cannot read the terminal's size.                                      |
| `DEVHOST_DEV_SOURCE_DIR` | Development only: the devhost source checkout to serve the toolbar from. See [Build from source](../../development/building/). |

devhost reads only the environment it is started with; it does not load `.env` files.

## Files and directories

| Path                                                 | Holds                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.config/devhost/config.toml`                      | Machine-wide settings, such as [Caddy's ports](../../guides/shared-managed-caddy-settings/). Moved by `DEVHOST_CONFIG_DIR` or `XDG_CONFIG_HOME`. |
| `~/.local/state/devhost/`                            | The state directory: records of running stacks, hostname and port claims, and Caddy's data. Moved by `DEVHOST_STATE_DIR` or `XDG_STATE_HOME`.    |
| `<state>/caddy/caddy.runtime.log`                    | Caddy's log, rotated automatically.                                                                                                              |
| `<state>/caddy/caddy.stdout.log`, `caddy.stderr.log` | Caddy's output from its last start.                                                                                                              |

`config.toml` lives under `~/.config` on macOS too. Stacks with different state directories never see each other.

---
title: "Build from source"
---

Build devhost from a checkout of [the repository](https://github.com/alexgorbatchev/devhost) to try unreleased changes or work on devhost itself.

## Build a binary

```bash
just setup
just devhost compile
./apps/devhost/bin/devhost --version
```

`just setup` installs the workspace dependencies and Go modules and builds the embedded toolbar. `just devhost compile` rebuilds the toolbar and writes a binary for your platform to `apps/devhost/bin/devhost`, stamped with the version in `apps/devhost/metadata.json`.

To run devhost from source without installing it, use `just cli <args>`, or `just run-ai <args>` for agent output. Both run in the directory you call them from. `just run` starts the repository's development stack in the background and waits for it to become ready. Run `just cli stop` from the repository root to stop it.

## Try the Rust port

From a checkout that contains `apps/devhost/rust`, install rustup and use the toolchain pinned in `apps/devhost/rust/rust-toolchain.toml` to run the experimental CLI. The declared minimum Rust version is 1.98; CI also checks Rust 1.98.1:

```bash
just setup
just rust run --help
```

The Rust CLI provides help, `--version`, `skill`, `service list`, managed Caddy commands, local and remote `start` and `stop`, `serve`, and `stack list`, `stack find`, and [`stack info`](../../reference/cli/#stacks). It also supports stack replacement with `stack restart` and global `restart-all` on Linux and macOS; see [Restart after upgrading](../../guides/stack-lifecycle/#restart-after-upgrading-devhost) for the command differences. Manifests can use includes and native directory services. Pass `service list --startable` to omit services marked `alwaysStart`. The command reads `--manifest` first, then `DEVHOST_MANIFEST`, then searches upward from the current directory for `devhost.toml`, stopping at the Git repository boundary.

Build its separate executable at `apps/devhost/rust/target/debug/devhost` with `just rust build`. The Rust run, build, and validation recipes refresh the embedded browser assets, so a fresh checkout needs no manual asset generation after setup. `just rust check` checks formatting, Clippy, and native tests with 90% line and function coverage for first-party Rust sources. Root `just fix` formats the first-party Rust package alongside the other workspaces.

CI runs the Rust checks and executable comparisons on hosted Linux x64, Linux ARM64 and macOS ARM64 alongside the shared repository checks. The comparison recipe is `just rust comparisons <clean-Go-oracle-checkout> <repaired-Go-binary> <optimized-Rust-binary> <new-evidence-directory>`; it requires Rust Anything 3.3.0 and preserves logs, hashes and explicit differences from the unchanged Go reference. The [release runbook](https://github.com/alexgorbatchev/devhost/blob/main/apps/devhost/RELEASE.md) describes the setup and candidate workflow.

Build an optimized native candidate with `just rust build-release`, then run `apps/devhost/rust/target/release/devhost --version`. This embeds the version from `apps/devhost/metadata.json` and the production browser assets. In a GitHub tag build, the tag must match that version. The executable runs independently of the checkout. Debug builds and the protected development override below keep their existing commands; published releases still use Go while Rust acceptance is in progress.

Package a candidate with `just rust build-release-artifacts --targets=linux-x64`, or omit the target filter to build the five existing archive targets. Linux packaging requires Zig and cargo-zigbuild; package `darwin-arm64` on macOS with its SDK. The command writes a new directory under `apps/devhost/dist/rust-candidates/` with versioned archives, compiled Rust dependency licenses, `SHA256SUMS` and source/toolchain provenance. GNU candidates target glibc 2.28; musl candidates are checked for static linking. On the matching host the packager checks extraction, executable permissions, version/help/manifest loading, HTTPS and embedded browser assets with a private CA, global restart, and stop. It does not change system trust. Cross-compilation alone does not establish native acceptance. Candidate packaging does not install or publish anything.

On Linux and macOS, `start --detach` waits for services, routes, and any configured remote connection to become ready, prints the supervisor PID, service URLs, and log path, and leaves the stack running. Repeating the command reports the existing stack; `stop` shuts it down. Startup failures print the attempt's log tail and stop its services.

Use `serve --name notes --detach -- npm run dev` to start a command, discover its HTTP listeners, and publish a named session. Inspect it with `stack info --session <session>`, list sessions with `stack list --sessions`, and stop one with `stop --session <session>`. The [serve guide](../../start/serve/) covers naming, startup timeouts, and port-qualified routes.

Use `serve --domain notes.localhost` to serve the current directory, `--dir` for another directory, or `--port` for an existing local HTTP service. The session starts Caddy when needed and removes its routes on Ctrl+C; Caddy and existing services keep running. Directory indexes, the confined file browser, and Markdown rendering follow the [serve guide](../../start/serve/).

Saved manifest and include changes reload automatically, preserving compatible automatic ports and restarting affected services and dependents. A rejected replacement restores the accepted configuration; fixing the file retries it. Saved machine configuration updates shared Caddy settings; changing the local domain suffix requires stopping and starting the stack. The Rust CLI supports `idleTimeout` and `--idle-timeout`, including HTTP activity through Caddy.

Machine configuration selects [remote previews](../../stacks/remote-previews/) automatically; `--local` uses local routing and `--remote` requires remote configuration. Remote stacks share an authenticated connector, reconnect after relay interruptions, and update their hostnames on manifest reload. Changing remote settings requires stopping and starting the affected stacks. On macOS, `caddy trust-remote` installs another machine's Caddy root certificate as described in the [managed Caddy guide](../../guides/managed-caddy/).

The Rust stack serves the browser toolbar with service start and restart controls, health and log streams, host resource readouts, editor highlights, the configuration editor, and the running-stack directory. Its running agents list includes agents started outside devhost, and the activity page streams new events from agents in the selected checkout without replaying their history. Worktree selection and switching restart the repository's managed services together. The [Control API](../../reference/control-api/) describes these routes.

Chat and annotations use the same browser interface and [Chat API](../../reference/chat-api/) as Go. The Rust stack starts Codex through its app-server protocol and Claude Code through stream-JSON, discovers their native model catalogs, and retains conversations independently of browser connections. Approvals, interruption, PNG/JPEG attachments, workflow instructions, selected-worktree isolation, disk-backed conversation replay, and the saved panel position follow that shared contract. Install and authenticate the native harness you select; the Rust executable does not contain a model client.

Use `completion bash`, `completion zsh`, `completion fish`, or `completion powershell` to print a [shell completion script](../../reference/cli/#other-commands). Each command's help includes installation instructions. `--no-descriptions` omits completion descriptions.

Set `AGENT=1` for agent-oriented help and detailed stack inspection output. Platform verification of the experimental port is still in progress.

## Use a protected development build

Run `just dev-bootstrap` to build and register devhost in `~/.dotfiles`, or pass a different dotfiles project with `just dev-bootstrap /path/to/dotfiles`. The project must declare devhost and the dotfiles CLI on PATH must support `tool dev use`. Dotfiles copies the build into its configured development store, keeps the release payload unchanged, and preserves the development override during updates and cleanup. Run `dotfiles tool dev off devhost` from that project to return to managed releases.

## Iterate on the toolbar

A development build serves the toolbar from its source checkout and rebuilds it when you reload a page, so UI changes show up without rebuilding devhost or restarting the stack.

1. Use a development build. `just run`, `just cli`, `just run-ai`, and `just dev-bootstrap` (which activates the protected development build in dotfiles) all record the checkout they were built from. For any other build, set `DEVHOST_DEV_SOURCE_DIR` to the checkout's root; a relative path resolves from the manifest's directory, and the variable wins over a recorded checkout.
2. Edit files under `packages/devhost-ui/src/devtools/` and reload the page.
3. When those files are newer than the built bundle, devhost rebuilds it, one build at a time, and serves it uncached. Tabs that loaded an earlier build keep working.
4. A failed build shows a `DEVHOST COMPILATION ERROR` banner on the page with the details; the next reload tries again.

Changes to Go code need a new binary: rerun `just dev-bootstrap`, or restart `just run`, which rebuilds on start.

If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` fails and names the path. If a development build's recorded checkout has moved or been deleted, devhost warns at startup and serves the toolbar built into the binary.

A development build also lets chat work on devhost itself; see [Chat about devhost itself](../../guides/annotations/#chat-about-devhost-itself).

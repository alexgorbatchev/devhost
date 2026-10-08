# devhost app contributor notes

Local rules for the `devhost` Go app in `apps/devhost/`.

## Documentation policy

- The public docs under `packages/docs/src/content/docs/` must always be kept up to date. They are where every feature is documented, however small. Update them in the same change whenever you change:
  - CLI usage
  - manifest behavior
  - injected environment variables
  - routing behavior
  - logging behavior
  - devtools behavior
  - limitations, caveats, or failure modes
- After every behavior change, review the docs and `README.md` for statements the change made inaccurate, and correct each one. This applies to the README as well: what it already says must stay true.
- `README.md` is an overview, not a feature list. Do not add a new feature, section, or option to it without asking the user first; there are too many small features for all of them to belong there. Correcting or removing existing README text needs no approval.
- `AGENTS.md` files must be kept up to date after workflow, policy, or contributor-expectation changes.
- `RELEASE.md` must be kept up to date after tag, packaging, or GitHub release workflow changes.
- If the manifest contract changes, also update `devhost.example.toml` and the devhost skill at `internal/skill/devhost/SKILL.md` (and its reference files).
- Update `internal/skill/devhost/SKILL.md` in the same change as any change to a command, argument, option, short alias, type, default, environment variable, output, exit code, or side effect, and set its `last_modified`. `devhost skill` prints that file, so it is the reference agents work from. `TestSkillCoversTheWholeInterface` fails while it omits a command, flag, argument, or environment variable, or leaves a flag's type or non-zero default off the line that names the flag; check what the file says about them against the implementation yourself, because the test compares names and values only.
- Write the skill for someone operating `devhost`: affirmative usage instructions and facts. Keep its frontmatter `description` to when the skill applies. Contributor rules belong in the `AGENTS.md` files.
- If devtools-specific contributor rules change, also update `packages/devhost-ui/AGENTS.md` and the nested files under `packages/devhost-ui/src/devtools/`.
- If the tag-driven binary release flow changes, also update `RELEASE.md` and the relevant shared guidance in the repo-root `AGENTS.md`.
- **CRITICAL:** `packages/docs/sync.ts` regenerates the public docs landing page from `README.md` and the manifest reference from `devhost.example.toml`. After editing either source, you **must** validate `packages/docs` so the GitHub Pages content stays in sync.
- Do not leave docs, README, or AGENTS examples/rules stale after changing implementation details.
- Repo-root `README.md` is a symlink to this workspace README; update `README.md` here, not the root symlink.

## Development workflow

From the repository root, build and replace the installed payload used by the dotfiles-managed `devhost` shim:

```bash
just dev-bootstrap
just dev-bootstrap /path/to/dotfiles
```

The default target is `~/.dotfiles`. The command uses the app's `compile` recipe with a `999.0.0-dev.<short git SHA>` version override, reads the existing `.generated/bin/devhost` shim's literal `TOOL_EXECUTABLE` path, and atomically replaces that installed payload while retaining the shim. Dotfiles must already have installed `devhost`. Temporary files live under the target's `.tmp/`; a later dotfiles update can replace this development build. Plain `just devhost compile` retains the metadata version.

Run the app from source in the current directory with agent-facing output (`AGENT=1`); `just devhost run` is the human-mode equivalent:

```bash
just devhost run-ai --help
```

Run the Go tests:

```bash
just devhost test
```

Build a standalone executable for the current platform:

```bash
just devhost compile
```

Refresh the generated embedded devtools bundle without building the binary:

```bash
just devhost build-devtools-bundle
```

Build the versioned cross-platform release tarballs:

```bash
just devhost build-release-artifacts
```

Format the repo:

```bash
just fix
```

Run the app check suite:

```bash
just devhost check
```

The root `fix` recipe runs `oxfmt --write` for the repo using the shared root config and `gofmt -w` for this app; the pre-commit hook also formats staged files. `just devhost check` refreshes the generated embedded devtools bundle, then runs `just devhost lint` (fails on unformatted Go files, then `go vet ./...`, `go tool predeclared ./...`, and `go mod tidy -diff`) and the Bun script tests and `just devhost test` from this app. `run` and `run-ai` use `[no-cd]` and the `scripts/runFromSource.sh` shim, so relative manifest paths (`--manifest`, `-m`, `DEVHOST_MANIFEST`) and manifest discovery resolve from the directory you call `just` in. The shim runs `go build` on every call and leaves staleness to it, so a change to a Go source, an embedded asset, or the module files is rebuilt and nothing else is; do not add a file-time check or change directory before starting `devhost`. The shim builds to `bin/source/devhost`, without a version stamp (`--version` prints `dev`), and keeps that apart from the `bin/devhost` that `just devhost compile` writes so neither build replaces the other. Compiled binaries go under `bin/`, which is ignored; never write one elsewhere or commit one. The injected UI checks and Storybook coverage now live in `packages/devhost-ui/`. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

`scripts/buildDevtoolsBundle.ts` refreshes the generated injected devtools assets under `internal/devtools/dist/` used by Go `//go:embed`: the static `devtools.js` entry, lazy JavaScript chunks and WOFF2 subsets under `assets/`, `xterm.css`, and precompressed `.gz` representations. The whole directory is intentionally ignored. Production builds must define `process.env.NODE_ENV` as `"production"`; the source loop sets the internal `DEVHOST_DEVTOOLS_DEVELOPMENT=1` build switch for development diagnostics and retains old hashed chunks for active tabs. Production builds remove obsolete artifacts before embedding.

Devtools control requests are token-free for trusted local development; keep browser clients and the bundled Neovim plugin aligned with that contract. `/__devhost__/config.json` serves instance configuration with `no-store`; the static entry fetches it before mounting. Unversioned `inject.js` and `xterm.css` URLs redirect without caching to content-versioned URLs. Production entry URLs, terminal styles, hashed chunks, and fonts use one-year immutable caching; source-mode `inject.js` stays uncached. Gzip negotiation belongs only to asset responses, preserving native WebSocket handling. Keep generated chunk/font URLs and the Go asset route aligned.

The same existing browser build embeds `redux.js` (public host registration), `redux-monitor.js` (genuine upstream inspector), and its emitted `redux-monitor.css`. The separate `/__devhost__/redux` document loads the upstream inspector stylesheet; it never reaches the host document. Preserve the complete build output graph, including emitted chunks/fonts and gzip representations, rather than a fixed entry-file count. Redux modules and styles use the same content-versioned immutable production responses and uncached source rebuilds as other browser assets. Failed source builds return HTTP 503 instead of stale registration, monitor code, or styles; injection retains its compilation-banner behavior. Test actual store instrumentation and monitor transport through the compiled Go routes, not only fixture servers. No Node/desktop runtime is shipped.

`DEVHOST_DEV_SOURCE_DIR` (set to `.` by root `just dev`) points a running stack at a devhost checkout. Each request for `/__devhost__/inject.js` compares `packages/devhost-ui/src/devtools/` against `apps/devhost/internal/devtools/dist/devtools.js` in that checkout and, when sources are newer, runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` before serving the bundle, so a browser reload shows UI changes. All three paths derive from the checkout root in `internal/devtools/dev_source.go`; keep them in sync with `scripts/buildDevtoolsBundle.ts` and the `build-devtools-bundle` recipe, which the rebuild tests in `internal/devtools/dev_source_test.go` run for real through `just`. `devhost start` rejects a path that is not a devhost checkout (`NewDevSourceCheckout`), naming the variable. A build that fails or writes no `devtools.js` renders a `DEVHOST COMPILATION ERROR` banner and is retried on the next reload; builds are serialized, so retries never overlap.

`just devhost build-release-artifacts` refreshes that bundle, cross-compiles the supported Go release targets, embeds the current `metadata.json` version into `devhost --version`, and writes versioned `.tar.gz` archives to `apps/devhost/dist/release/`.

`just devhost compile` refreshes that bundle, embeds the current `metadata.json` version into `devhost --version`, then writes the current-platform executable to `apps/devhost/bin/devhost`.

Native React access is attach-only. `[devtools.browser].endpoint` explicitly names an already running user-owned loopback browser; retain it only in Go configuration. The injected config exposes a fresh instance identity and configured flag, never the endpoint. `internal/nativebrowser/` owns maintained typed CDP connections and target observers; cancellation detaches and joins them without closing browser windows, tabs or profiles. Keep persistent target initialization on its owning context rather than a disposable per-call timeout.

The token-free native browser WebSocket requires the exact current Origin/Host, codec, instance/document binding and live Caddy route authority. `internal/caddy/devtools_origin.go` uses `ReadManagedCaddyGlobalSettings` and actual registration/path ownership; forwarded headers and manifest fallback ports are not authority. Preserve explicit unavailable states, native-session-loss limits and host-root discrimination from the injected React tree. Browser/version/extension detection is not a live Components or Profiler test. Direct browser-control commands/diagnostics remain separate from the native React opener, and Disconnect releases devhost's resources without closing the user's native windows.

## Release workflow

- Follow `RELEASE.md`; it is the authoritative runbook for the tag-driven GitHub Release binary flow.
- Release trigger: push a `v*` tag whose version matches `metadata.json`.
- The publish workflow attaches versioned `.tar.gz` binaries for `darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl` to the matching GitHub Release.

## Done policy

- Done means the required docs are updated (the public docs, relevant `AGENTS.md`, `RELEASE.md`, and `devhost.example.toml` when applicable) and `README.md` has been reviewed for inaccuracies, required validation for the affected scope has passed, and any temporary local processes started for validation are stopped.
- When changes affect the shipped `devhost` executable or its user-visible behavior, run `just devhost compile` successfully before yielding to the user.
- If `just devhost check`, packaging checks, or required documentation updates were skipped, failed, or are blocked, report the app work as incomplete and call out the exact blocker.
- Release work is not done until the tag exists remotely, the publish workflow has reached its expected result, and the matching GitHub Release state is confirmed.

## Internal app layout

- `cmd/devhost/main.go` — shipped CLI entrypoint
- `scripts/runFromSource.sh` — local shell shim that builds and launches the Go runtime for workspace recipes and source-checkout use
- `bin/` — ignored build output: `bin/devhost` from `just devhost compile`, `bin/source/devhost` from the shim
- `internal/app/` — top-level Go CLI dispatch
- `internal/cliout/` — the failure and warning lines devhost prints outside its logs, in the form for people or for agents (`AGENT=1`)
- `internal/cli/` — command definitions (boa on top of cobra) and help screens; help is rendered by `cobra-help-tree/v2`, which documents positional arguments, environment variables, and quickstart examples from the catalog in `internal/cli/help.go` because cobra has no fields for them. Long descriptions print verbatim, so keep their lines at 60 columns or less.
- `internal/skill/` — embeds `devhost/SKILL.md`, the guide `devhost skill` prints. `devhost/` is a complete skill directory (`SKILL.md` plus `references/`) that `npx skills add` installs by its path, so keep Go files out of it: `go:embed` cannot reach outside the module, which is why the skill lives here and not at the repository root. `cobra-help-tree` adds the `skill` command and the alert that opens every agent help screen.
- `internal/manifest/` — manifest discovery, parsing, validation, and defaults
- `internal/services/` — child process orchestration, health checks, port resolution, and cleanup
- `internal/caddy/` — managed Caddy lifecycle, paths, config, and routing
- `internal/caddy/caddytest/`, `internal/nettest/`, `internal/testenv/` — test support: stand-ins for Caddy's admin endpoint, reserved loopback ports, and the test process environment
- `internal/nativebrowser/` — attach-only typed CDP observation and native window access for explicitly configured user-owned browsers
- `internal/devtools/` — Go devtools control servers plus embedded browser assets
- `internal/hostusage/` — samples host CPU, memory, and disk usage for the toolbar readouts (gopsutil; Linux reads sysfs to leave out USB-attached and removable drives)
- `internal/devtools/nvim/devhost-react-highlight.nvim/` — bundled Neovim plugin; follow its nested `AGENTS.md`
- `scripts/buildDevtoolsBundle.ts` — generates the production entry, lazy chunks, fonts, terminal stylesheet, and gzip representations under ignored `internal/devtools/dist/` for `go:embed`

## Manifest configuration and casing rules

- Normalize `host` strings and arrays into one ordered hostname list. Keep one process, port, and document injection server per service. Claim and clean up each hostname independently; publish all service routes with one Caddy reload and restore the entire group on failure. Use the first hostname for single-value service references and metadata.

- **MANDATORY camelCase rule:** All keys across the entire TOML manifest must use standard `camelCase` naming conventions. Never introduce kebab-case (hyphenated), snake_case, or mixed casing for properties in the manifest.
- This rule applies to both top-level tables and nested keys, including (but not limited to) `idleTimeout`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, `managed`, `restartServices`, etc.
- When defining or updating schema validation logic or structs in Go (e.g., `validate.go` or `types.go`), always ensure allowed-keys lists, parsed fields, struct members, and serialization tags explicitly enforce and respect `camelCase`.
- Never submit or merge schema additions that break this naming contract.

## Service supervision boundary

- Single-service restarts retain assigned automatic ports and report collisions with the **Restart stack with new ports** recovery action. Full-stack restart uses the last accepted manifest, refreshes managed auto ports, stops all managed services before relaunching them with rebuilt port templates/environments, retains selected worktrees and control/document listeners, and remains retryable after launch/routing failure. Fixed ports and external processes stay unchanged. Signal only owned listener processes during cleanup; an unrelated listener taking over a stopped service's port must neither be killed nor prevent stack recovery.

- Manifest hot reload owns service changes and include-glob membership. Validate the whole candidate before mutations; reject edits to stack identity, shared Caddy settings, devtools, annotation, worktree enablement, and killZombies as requiring a restart. Serialize reloads, restarts, and worktree refresh/switch operations. Preserve compatible automatic ports and saved checkout selections; compare effective injected environments, restart dependents and affected repository groups, and restore prior services/routes on failure. Track live routes and claims for shutdown instead of capturing startup lists. Keep replacement health pending until routing accepts it.
- Keep signal handling live while reload work runs. Cancel lifecycle health polling and start/status commands on shutdown, join reload work before final cleanup, and skip restoration launches during shutdown. Filter manifest events by tracked files and include membership before debouncing. Preserve recovery blocks for every unaffected service, including services outside Git. Reuse known repository identity when an inactive configured checkout has disappeared, then validate offsets and directories against the selected checkout.
- Request the reload that follows startup with `manifestWatcher.check`, which waits out the same debounce as a save. Do not read the manifest beside the watcher: that read applies a save made while the stack starts, the save's own event applies it again, and a configuration whose launch fails then stops and restores the services twice.
- Worktree discovery uses the existing picker Refresh button and refresh on picker open. Discover additions and inactive deletions without manifest edits. A missing running selection stops that repository's services and watchers, retains its selected path with a recovery error, and blocks new tool launches until explicit checkout recovery; other repositories remain independent.

- Removing the last route must retain that Caddy instance's admin address, bind host, and HTTP/HTTPS ports. Shutdown must not reset to default listeners or reload another instance. Keep the regression in `internal/caddy/route_shutdown_test.go` and exercise the real recording workflow when changing this lifecycle.
- Service test fixtures must support `TMPDIR` inside this checkout: `t.TempDir()` can inherit its Git repository. Verify repository identity or use an isolated Git fixture. Startup-crash tests observe service or repository recovery state and explicitly signal shutdown; a worktree group failure does not emit the ordinary service-exit log message.
- Worktrees are enabled by default; `[worktrees].enabled = false` disables discovery and saved-selection restore. When enabled, keep all services sharing a Git common directory in one selected checkout. Persist selection by manifest path and repository before restarting; preserve configured cwd offsets and the original manifest. Validate the entire target group before stopping, stop in reverse dependency order, and use each daemon's launch cwd for its stop command. Missing selections and group launch failures stay stopped for explicit picker recovery; never silently fall back or leave a partially launched group running. Services outside Git retain normal startup recovery.
- Keep the supervisor, sibling services, routes, and devtools alive after foreground service exits, including startup crashes and successful exits. Retain the exit code and logs for web UI recovery; shutdown remains explicit or driven by the configured idle timeout. Failed restart attempts must reset pending state and remain retryable.
- Publish foreground restart recovery only after replacement health and route refresh succeed. Share route configuration between startup and restart; update document backends without replacing their listeners. Failed route updates must restore prior registrations and configuration, stop the unrouted replacement, preserve retryable recovery, and report rollback failures. Protect runtime manifest snapshots from concurrent health reads during auto-port retries.
- Capture the resolved shared Caddy management binding after startup stale cleanup. Pass that binding to route retirement and use it to fill sparse/default route votes without hiding explicit non-default conflicts. Reload retirement through the pre-mutation live admin endpoint; synchronize removed hosts even when global votes change. Active HTTP voters override captured empty-runtime HTTP fallback. Startup stale cleanup uses the caller's prepared settings and performs no reload.
- Keep `proxyLocalOrigin` translation and Origin rejection scoped to the selected service's Caddy handlers. The document hop retains public Host for forwarding metadata while translating Origin to the app address; asset and WebSocket hops translate both. Preserve the option and assigned address across aliases, restarts, and route rollback. Validate the incoming public Origin before translation, including duplicate header values.
- Treat service cleanup as a generic containment contract with platform-specific backends; do not hardcode Linux-only assumptions into shared orchestration code.
- Linux may use stronger containment primitives (currently child-subreaper setup, descendant tracking, and short post-signal managed-port monitoring). macOS and other platforms are best-effort and may have weaker guarantees.
- Keep user-facing docs honest about those guarantee differences. Do not describe foreground-service shutdown as perfect or identical across platforms.
- Services that intentionally daemonize, detach, or escape the tracked foreground process tree are unsupported in foreground `command` mode unless there is an explicit cooperative lifecycle contract. Use daemon lifecycle mode for those services instead.
- Treat undocumented `DEVHOST_*` environment variables as internal implementation details. Do not document or rely on them as part of the public service contract unless they are intentionally promoted in `README.md` and covered by tests.
- **Auto-Shutdown Idle Timeout:** The stack-level auto-shutdown monitors Caddy proxy access log modification times (which are stack-isolated at `<caddy-paths>/logs/<stack_name>_access.log`) and active control server WebSocket connections. Upon timeout, the supervisor triggers a clean, graceful cascading teardown (sending `SIGTERM` and cleaning up routing configurations). To support both automated tests with very short timeouts (down to 10ms) and larger production settings without CPU overhead, the log poller and check tickers use adaptive polling intervals (scaled to `idleTimeout / 2` with a minimum of 10ms).

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Child process logs must remain prefixed with `[service-name]`.
- Generated managed Caddyfiles must discard the default Caddy runtime logger so background Caddy stderr never leaks into default stack output.
- Do not print successful Caddy reload chatter during default `devhost start` runs; only print it for `devhost start --debug` or explicit `devhost caddy ...` commands.
- Surface Caddy output on failure, and surface successful reload output only for `devhost start --debug` or explicit `devhost caddy ...` commands.
- Report the failure that ends a command with `cliout.WriteFailure`, and format a warning written outside the logs with `cliout.Warning`; do not hand-write a `failed:` or `WARNING:` prefix for either. A person gets `[ERROR]`, an optional `[INFO]` hint, and `[WARN]`; under `AGENT=1` an agent gets `ERR:` with the whole error and `WARN:`. Wrap an error in `cliout.Failure` where the command line is known (`internal/cli`, `internal/app`) to give a person a hint, or a summary when the error repeats itself or names internals. Log lines, warnings inside them included, keep their `[label]` prefix and their text in both modes.
- A test that asserts on a failure or warning line sets `AGENT` itself with `t.Setenv`, because the line depends on it and the test may run under an agent.

## Devtools UI boundary

- The injected UI source now lives in `packages/devhost-ui/`.
- For injected UI work, follow `packages/devhost-ui/AGENTS.md` plus the nested files under `packages/devhost-ui/src/devtools/`.
- Keep Go-side bundle generation and browser-side UI changes in sync when the embedding contract changes.

## Annotation action boundary

- Register terminal session state before calling `startOutput`; terminal launchers start the process without reading its PTY. Start the asynchronous output reader before `wait`, which must join it before publishing process exit so startup and final agent status events reach the queue.
- Annotation agent and command sessions belong to the stack, independently of browser connections. Keep running processes alive across reloads, closed tabs, and browser closure, including before the first terminal attachment and while an agent is idle between annotations. Retain terminal output for reconnection; apply disconnected-terminal cleanup only after annotation process exit. Explicit termination and stack shutdown still close sessions.
- Built-in agent adapters are `pi`, `claude-code`, `opencode`, and `codex`. Codex hooks capture stdout and run detached, so status commands must address the session's PTY through `DEVHOST_CODEX_STATUS_TTY`, an internal variable populated before launch.
- For Codex adapter changes, also run `DEVHOST_TEST_CODEX=1 go test ./internal/devtools -run TestCodex -count=1` from `apps/devhost/` with Codex CLI on PATH. The opt-in runtime test uses an isolated Codex home and blocks the prompt before inference; its hook-trust bypass is test-only. Production sessions require `/hooks` trust review.
- Top-level `[agent]` manifest configuration is removed. Annotation submission must be configured through `[annotation]` and `[[annotation.actions]]` only.
- The annotation manifest supports exactly two action kinds: `agent` and `command`.
- Use `kind = "command"` for non-agent side effects such as creating Jira tickets, invoking a project-local CLI, or kicking off other local automation from an annotation.
- `devhost` does not ship built-in Jira or generic webhook adapters for annotation submission; integrations like ticket creation must be implemented by the configured command reading `DEVHOST_ANNOTATION_FILE` or `DEVHOST_ANNOTATION_PROMPT_FILE`.
- Durable annotation queues are supported for `agent` actions only. `command` actions always start standalone terminal sessions and do not participate in the queue.

## Control server and test networking rules

- Never close a websocket client while holding the control server lock: a close waits for that client's in-flight write, which can stall on a dead connection. Drop the client from server state under the lock, release it, then close.
- End a browser connection the server closes on purpose with `closeWith` and a close code, never with bare `close`: the page reopens every connection that ends without `1000` (normal closure). Use `1001` (going away) when the stack stops, so pages reconnect to the next run, and `1000` when what the connection served is over, such as an ended terminal session. Bare `close` is for a connection that is already broken or that the browser is closing.
- A client attaching to a terminal session, the log stream, or the annotation queues must receive its snapshot before any broadcast. Each attach path takes the client's write lock before the client becomes reachable for exactly that reason; keep the order when changing it. The queue attach also registers inside `annotationQueueStore.withSnapshot`, because queue changes are published under the store lock.
- Health has no snapshot message: `publishHealth` records the health sent last and sends it as one step under `healthMu`, and an attach goes through it, so the health read for a new client also reaches the earlier clients it is news to. Do not set `lastPublishedHealth` anywhere else.
- Resource usage follows the health pattern: `publishResourceUsage` reads the sampler, records the message sent last, and sends it as one step under `resourcesMu`; an attach goes through it. `[devtools.resources]` resolves to `hostusage.Intervals`, where a zero interval is a readout that is off; with all three off the sampler does not start and `/__devhost__/ws/resources` is not served. The readouts do not count toward `hasEnabledDevtools`: they show in the toolbar other devtools features bring, and never inject the overlay by themselves. `Stop` joins the sampler after closing its clients.
- Write to a browser connection only through `websocketClient.write` or `writeJSONMessagesLocked`. Both set a write deadline (`WebsocketWriteTimeout`, ten seconds by default), so a page that stops reading cannot block whoever publishes to it. A write that misses the deadline leaves the connection unusable: drop the client, as every caller does on a write error.
- Resolve an annotation session's action when the session is created and keep its label on the session; the session list returns that label to the browser.
- A test that hands a port number to devhost or to a child process, or needs an address that refuses connections, takes the port from `nettest.ReservePort(t)` or `nettest.ReservePorts(t, n)` (`internal/nettest`). Do not close a listener and expect its port to stay unused: another test or process can claim it first.
- `internal/nettest` reserves through `github.com/hashicorp/consul/sdk/freeport`: the ports lie outside the range the kernel assigns to `:0` listeners, and each one returns to the pool when the test ends. It calls `freeport.Take`, not `freeport.GetOne` or `freeport.GetN`, which write two lines to stderr for every reservation. Call freeport only through `internal/nettest`.
- A test that needs a Caddy admin endpoint uses `caddytest.StartAdminServer(t)` (`internal/caddy/caddytest`), or `caddytest.UnusedAdminAddress(t)` for a Caddy that is not running. Both clean up when the test ends.
- Do not make a test beat a timer. Use an unreachable timeout while a test attaches or inspects, a short one only where the test waits for the timer to fire, and read scheduled state directly instead of sleeping to prove that nothing happened.
- Git and the shell report physical paths, and tests compare them with paths built from `t.TempDir()`. On macOS the temporary directory sits behind the `/var` symbolic link, so a package with such tests calls `testenv.UsePhysicalTempDir()` from `TestMain`, as `internal/services` and `internal/devtools` do. Reproduce a failure of this kind on Linux by running the tests with `TMPDIR` set to a symbolic link.
- Route changes render the Caddyfile for `runtime.GOOS`, and macOS omits `default_bind` for the default bind host. A Caddy test fixture that route code later rewrites, or an expectation compared with what it wrote, renders for `runtime.GOOS` too; a literal operating system belongs only in tests of the rendering itself.

## Go naming rule

- Name error variables `err`, never `error`. A local `error` hides the built-in `error` type for every function literal declared after it in that scope, so a later `func() (T, error)` fails to compile. `just devhost lint` runs `go tool predeclared ./...` (a `tool` directive in `go.mod`), which rejects any declaration that shadows a built-in identifier.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.

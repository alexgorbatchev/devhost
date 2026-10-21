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
- If the manifest contract changes, also update `devhost.example.toml` and the devhost skill at `skills/devhost/SKILL.md` (and its reference files).
- Update `skills/devhost/SKILL.md` in the same change as any change to a command, argument, option, short alias, type, default, environment variable, output, exit code, or side effect, and set its `last_modified`. `TestSkillCoversTheWholeInterface` fails while it omits a command, flag, argument, or environment variable, or leaves a flag's type or non-zero default off the line that names the flag; check what the file says about them against the implementation yourself, because the test compares names and values only.
- Write the skill for someone operating `devhost`: affirmative usage instructions and facts. Keep its frontmatter `description` to when the skill applies. Contributor rules belong in the `AGENTS.md` files. `SKILL.md` and its reference files carry no negative instructions: `TestSkillGivesNoNegativeInstructions` fails on `do not`, `don't`, `never`, `must not`, `should not`, `avoid`, and `refrain`. Say what to do, or state what devhost does or rejects.
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

Preview startup timeout and recovery pages from the repository root with `just devhost demo-recovery`. The separate `demos/recovery/devhost.toml` deliberately leaves its automatic port closed and times out after ten seconds. Set `DEVHOST_RECOVERY` through the root `.envrc` / `.envrc.local`, reload direnv, and open that hostname manually. Restart repeats the deliberate failure; Ctrl-C stops the demo stack.

With `DEVHOST_DEV_SOURCE_DIR` configured (`just run` sets it), the control server exposes `/__devhost__/pages/` on root-routed domains. This standalone page gallery shares the real 404, recovery, backend-unavailable, and file renderers. Preview snapshots stay non-ready, use sample logs and worktrees, and reject restart/worktree mutations without calling live stack callbacks. File examples are read from `demos/pages/files/` in the selected checkout. The gallery is absent outside development mode; restart the source stack after editing embedded templates or styles.

Run the Go tests:

```bash
just devhost test
```

The recipe runs `go test -count=1 ./...`: the suite exercises live processes, ports, and kernel state, so each invocation runs the tests afresh. Retain this flag. On Linux, process containment polls `/proc`; caching its millions of filesystem observations creates a large input log that Go must validate on later runs. The flag disables test-result caching while retaining the build cache.

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

The root `fix` recipe runs `oxfmt --write` for the repo using the shared root config and `gofmt -w` for this app; the pre-commit hook also formats staged files. `just devhost check` refreshes the generated embedded devtools bundle, then runs `just devhost lint` (fails on unformatted Go files, then `go vet ./...`, `go tool predeclared ./...`, `go tool logpolicy ./...`, and `go mod tidy -diff`) and the Bun script tests and `just devhost test` from this app. `run` and `run-ai` use `[no-cd]` and the `scripts/runFromSource.sh` shim, so relative manifest paths (`--manifest`, `-m`, `DEVHOST_MANIFEST`) and manifest discovery resolve from the directory you call `just` in. The shim runs `go build` on every call and leaves staleness to it, so a change to a Go source, an embedded asset, or the module files is rebuilt and nothing else is; do not add a file-time check or change directory before starting `devhost`. The shim builds to `bin/source/devhost`, without a version stamp (`--version` prints `dev`), and keeps that apart from the `bin/devhost` that `just devhost compile` writes so neither build replaces the other. Compiled binaries go under `bin/`, which is ignored; never write one elsewhere or commit one. The injected UI checks and Storybook coverage now live in `packages/devhost-ui/`. Shared `oxfmt` / `oxlint` enforcement runs from the repo root.

`scripts/buildDevtoolsBundle.ts` refreshes the generated injected devtools assets under `internal/devtools/dist/` used by Go `//go:embed`: the static `devtools.js` entry, lazy JavaScript chunks and WOFF2 subsets under `assets/`, and precompressed `.gz` representations. The whole directory is intentionally ignored. Production builds must define `process.env.NODE_ENV` as `"production"`; the source loop sets the internal `DEVHOST_DEVTOOLS_DEVELOPMENT=1` build switch for development diagnostics and retains old hashed chunks for active tabs. Production builds remove obsolete artifacts before embedding.

The same build command bundles `internal/statuspage/status.css` with `packages/design/tokens.css` into ignored `internal/statuspage/dist/status.css` for Go embedding. Standalone 404, recovery, unavailable-backend, directory, and Markdown documents consume that stylesheet and the shared system-theme script. Keep token values in the design package. Recovery and file pages inline the CSS; the managed proxy serves its 404 stylesheet beside the page.

The builder resolves the browser main and Redux registration through the UI package's public exports, using that package's own resolution context. Keep the served entrypoint list explicit: additional component-library exports are available for composition, and enter the browser asset graph when imported by a served entrypoint. The Redux monitor remains a separate internal browser entry beside its public registration module.

Devtools control requests are token-free for trusted local development; native chat mutations and WebSocket attachments require an Origin matching the request authority. `/__devhost__/config.json` serves instance configuration with `no-store`; the static entry fetches it before mounting. Unversioned `inject.js` URLs redirect without caching to content-versioned URLs. Production entry URLs, hashed chunks, and fonts use one-year immutable caching; source-mode `inject.js` stays uncached. Gzip negotiation belongs only to asset responses, preserving native WebSocket handling. Keep generated chunk/font URLs and the Go asset route aligned.

The same existing browser build embeds `redux.js` (public host registration), `redux-monitor.js` (genuine upstream inspector), and its emitted `redux-monitor.css`. The separate `/__devhost__/redux` document loads the upstream inspector stylesheet; it never reaches the host document. Preserve the complete build output graph, including emitted chunks/fonts and gzip representations, rather than a fixed entry-file count. Redux modules and styles use the same content-versioned immutable production responses and uncached source rebuilds as other browser assets. Failed source builds return HTTP 503 instead of stale registration, monitor code, or styles; injection retains its compilation-banner behavior. Test actual store instrumentation and monitor transport through the compiled Go routes, not only fixture servers. No Node/desktop runtime is shipped.

`DEVHOST_DEV_SOURCE_DIR` (set to `.` by root `just run`) points a running stack at a devhost checkout. Each request for `/__devhost__/inject.js` compares `packages/devhost-ui/src/devtools/` against `apps/devhost/internal/devtools/dist/devtools.js` in that checkout and, when sources are newer, runs `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` before serving the bundle, so a browser reload shows UI changes. All three paths derive from the checkout root in `internal/devtools/dev_source.go`; keep them in sync with `scripts/buildDevtoolsBundle.ts` and the `build-devtools-bundle` recipe, which the rebuild tests in `internal/devtools/dev_source_test.go` run for real through `just`. `devhost start` rejects a path that is not a devhost checkout (`NewDevSourceCheckout`), naming the variable. A build that fails or writes no `devtools.js` renders a `DEVHOST COMPILATION ERROR` banner and is retried on the next reload; builds are serialized, so retries never overlap.

`just devhost build-release-artifacts` refreshes that bundle, cross-compiles the supported Go release targets, embeds the current `metadata.json` version into `devhost --version`, and writes versioned `.tar.gz` archives to `apps/devhost/dist/release/`.

`just devhost compile` refreshes that bundle, embeds the current `metadata.json` version into `devhost --version`, then writes the current-platform executable to `apps/devhost/bin/devhost`.

Native React access is attach-only. `[devtools.browser].endpoint` explicitly names an already running user-owned loopback browser; retain it only in Go configuration. The injected config exposes a fresh instance identity and configured flag, never the endpoint. `internal/nativebrowser/` owns maintained typed CDP connections and target observers; cancellation detaches and joins them without closing browser windows, tabs or profiles. Keep persistent target initialization on its owning context rather than a disposable per-call timeout.

The token-free native browser WebSocket passes the control guard, then requires the codec, a request origin that is a live Caddy route, and an instance/document binding on that origin. `requestDocumentOrigin` takes the scheme from the `X-Forwarded-Proto` Caddy sets, else `http`, and the Host; `internal/caddy/devtools_origin.go` decides whether that origin is a route, from `ReadAppliedManagedCaddySettings` (the listeners Caddy runs) and actual registration/path ownership. Forwarded headers and manifest fallback ports are not authority. Preserve explicit unavailable states, native-session-loss limits and host-root discrimination from the injected React tree. Browser/version/extension detection is not a live Components or Profiler test. Direct browser-control commands/diagnostics remain separate from the native React opener, and Disconnect releases devhost's resources without closing the user's native windows.

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
- `internal/cliout/` — human stack and service log presentation and the failure and warning lines devhost prints outside its logs, in the form for people or for agents (`AGENT=1`)
- `internal/cli/` — command definitions (boa on top of cobra) and help screens; help is rendered by `cobra-help-tree/v2`, which documents positional arguments, environment variables, and quickstart examples from the catalog in `internal/cli/help.go` because cobra has no fields for them. Long descriptions print verbatim, so keep their lines at 60 columns or less.
- `internal/skill/` — carries the skill instructions and skill URL that `devhost skill` prints. The canonical AI agent skill lives at `skills/devhost/` at the repository root so `npx skills add alexgorbatchev/devhost` discovers it as a standard skill. `cobra-help-tree` adds the `skill` command and the alert that opens every agent help screen.
- `internal/manifest/` — manifest discovery, parsing, validation, and defaults
- `internal/config/` — the devhost config file (`config.toml`) every stack on the machine shares: its path resolution and validation
- `internal/choices/` — words the allowed values of a setting for validation issues, shared by the manifest and config validation
- `internal/files/` — manifest-free static serving and safe GFM rendering; the embedded GitHub Markdown CSS retains its upstream version/source and MIT license
- `internal/services/` — child process orchestration, health checks, port resolution, and cleanup
- `internal/caddy/` — managed Caddy lifecycle, paths, config, and routing
- `internal/caddy/caddytest/`, `internal/nettest/`, `internal/testenv/` — test support: stand-ins for Caddy's admin endpoint, reserved loopback ports, and the test process environment
- `internal/procid/` — the start identity that tells a process from a later one with the same PID, and the Linux `/proc/<pid>/stat` reader the service containment shares
- `internal/nativebrowser/` — attach-only typed CDP observation and native window access for explicitly configured user-owned browsers
- `internal/devtools/` — Go devtools control servers plus embedded browser assets
- `internal/hostusage/` — samples host CPU, memory, and disk usage for the toolbar readouts (gopsutil; Linux reads sysfs to leave out USB-attached and removable drives)
- `scripts/buildDevtoolsBundle.ts` — generates the production entry, lazy chunks, fonts, and gzip representations under ignored `internal/devtools/dist/` for `go:embed`

## Manifest configuration and casing rules

- Normalize `host` strings and arrays into one ordered hostname list. Keep one process, port, and document injection server per service. Claim and clean up each hostname independently; publish all service routes with one Caddy reload and restore the entire group on failure. Use the first hostname for single-value service references and metadata.

- Resolve every service port before evaluating health URL templates. Timing-only health tables inherit TCP readiness on fixed or automatic ports; explicit probes retain their kind and timing across port retries and reloads. Build direct HTTP URLs from connectable bind addresses, validate resolved health targets as loopback HTTP/HTTPS, and keep explicit numeric TCP targets fixed.

- **MANDATORY camelCase rule:** All keys across the entire TOML manifest must use standard `camelCase` naming conventions. Never introduce kebab-case (hyphenated), snake_case, or mixed casing for properties in the manifest.
- This rule applies to both top-level tables and nested keys, including (but not limited to) `idleTimeout`, `externalToolbars`, `bindHost`, `httpPort`, `httpsPort`, `adminAddress`, `defaultAction`, `injectPort`, `dependsOn`, `primary`, `managed`, `restartServices`, etc.
- When defining or updating schema validation logic or structs in Go (e.g., `validate.go` or `types.go`), always ensure allowed-keys lists, parsed fields, struct members, and serialization tags explicitly enforce and respect `camelCase`.
- Never submit or merge schema additions that break this naming contract.

## Service supervision boundary

- Stack registration atomically checks root and included manifest ownership under the shared stack-record filesystem lock. Preserve the loaded input files through validation and reserve new inputs before reload mutations; retain the previous inputs on failure and release removed inputs only after success. Registered live owners take precedence over `killZombies` recovery.

- Every stack registers itself with `caddy.RegisterStack` before it claims anything and unregisters last in its cleanup, so `devhost stop` and `devhost stack list` know a stack that holds no hostname or port. A stack record, hostname claim, fixed port claim, or route registration names its owner by PID and start identity (`ownerStartIdentity`, from `internal/procid`). Decide whether an owner is still running with `routeMutationIsOwnerAlive`, never by PID alone: a PID is reused, and the answer decides which process `killZombies` and `devhost stop` signal. A record without an identity comes from an older devhost and is checked by PID. `internal/caddy` owns the record formats; other packages read owners through `caddy.ReadLiveStackOwners` and do not parse the files. Tests that need a running stack's records start a process that makes real claims, as `startStackOwner` in `internal/services` does.

- Startup and reload share one fresh `caddy.ZombieCleanup` per claim pass across fixed ports, hosts, and route registrations. It caches success or failure per PID and start identity, and confirms exit before reclaiming a claim or logging `Stopped zombie PID ...`. Exit confirmation recognizes an unreaped OS zombie as exited; the old process's parent may not reap it. Keep the real-process and failure regressions in `internal/caddy/zombie_cleanup_test.go`.

- Single-service restarts retain assigned automatic ports and report collisions with the **Restart Stack** recovery action. Full-stack restart uses the last accepted manifest, refreshes managed auto ports, stops all managed services before relaunching them with rebuilt port templates/environments, retains selected worktrees and control/document listeners, and remains retryable after launch/routing failure. Fixed ports and external processes stay unchanged. Signal only owned listener processes during cleanup; an unrelated listener taking over a stopped service's port must neither be killed nor prevent stack recovery.

- Manifest hot reload owns service changes and include-glob membership. Validate the whole candidate before mutations; every setting reloads, so there is no reload boundary. The control server runs for the whole stack and takes devtools settings through `UpdateSettings` after routing accepts a reload; document servers check `ShouldInject` per request; `idleWatch` restarts on an `idleTimeout` change. Serialize reloads, restarts, and worktree refresh/switch operations. Preserve compatible automatic ports and saved checkout selections; compare effective injected environments, restart dependents and affected repository groups, and restore prior services/routes on failure. Track live routes and claims for shutdown instead of capturing startup lists. Keep replacement health pending until routing accepts it.
- Keep signal handling live while reload work runs. Cancel lifecycle health polling and start/status commands on shutdown, join reload work before final cleanup, and skip restoration launches during shutdown. Filter manifest events by tracked files and include membership before debouncing. Preserve recovery blocks for every unaffected service, including services outside Git. Reuse known repository identity when an inactive configured checkout has disappeared, then validate the selected checkout's configuration and service directories.
- Request the reload that follows startup with `manifestWatcher.check`, which waits out the same debounce as a save. Do not read the manifest beside the watcher: that read applies a save made while the stack starts, the save's own event applies it again, and a configuration whose launch fails then stops and restores the services twice.
- `devhost start <service...>` accepts service names and group names from `[groups]`. A selection runs the named services, group members, `alwaysStart` services, and their `dependsOn` chains (`startedServiceNames` in `internal/services/selection.go`). Groups merge from includes; validate their service references after the complete merge, reject duplicate group names and service-name collisions, and retain requested group names for membership changes on reload. `ResolvedManifest.Services` holds only the started services, so claims, routes, watches, worktree groups, and health cover nothing else; `ResolvedManifest.Stopped` holds the rest with resolved addresses. Read `Stopped` wherever a started service can name another one, as templates and `CreateInjectedServiceEnvironment` do, and keep a stopped automatic port across reloads: an address that changes when a service starts restarts every service that references it. Starting a stopped service goes through `applyConfiguration` with a longer list of requested names, so it gets the claim, launch, routing, and rollback steps of a reload. The dependency order always lists every service; skip the names that are not in `Services`. Reloads and stack restarts pass the current requested names on.
- A service that joins a repository group must not restart its siblings: `expandReloadGroups` spreads a change through a repository only from services the previous manifest already ran.
- Worktree discovery uses the existing picker Refresh button and refresh on picker open. Discover additions and inactive deletions without manifest edits. A missing running selection stops that repository's services and watchers, retains its selected path with a recovery error, and blocks new tool launches until explicit checkout recovery; other repositories remain independent.

- Removing the last route must retain that Caddy instance's admin address, bind host, and HTTP/HTTPS ports. Shutdown must not reset to default listeners or reload another instance. Keep the regression in `internal/caddy/route_shutdown_test.go` and exercise the real recording workflow when changing this lifecycle.
- Service test fixtures must support `TMPDIR` inside this checkout: `t.TempDir()` can inherit its Git repository. Verify repository identity or use an isolated Git fixture. Startup-crash tests observe service or repository recovery state and explicitly signal shutdown; a worktree group failure does not emit the ordinary service-exit log message.
- Worktrees are enabled by default; `[worktrees].enabled = false` disables discovery and saved-selection restore. When enabled, keep all services sharing a Git common directory in one selected checkout. Persist one active stack selection per original manifest path before restarting. Load the target checkout's manifest at the repository-relative path and resolve its includes, service set, directories, and routes. Validate before stopping the entire managed stack in reverse dependency order; start in dependency order and use each daemon's launch cwd for its stop command. Keep the ownership path, the original root manifest path, stable; the stack takes the target manifest's settings, including its name. Turning worktrees on during a reload forgets the saved selection (`forgetWorktreeSelection`) so the running checkout stays; a disk reload that turns them off while `selectionAwayFromRoot` reports another checkout switches back to the configured checkout through `switchWorktreeLocked` instead of applying the edit. Watch the selected manifest after success. Restore the previous stack and selection after switch failure. Missing saved selections remain stopped for explicit recovery; never silently fall back or leave a partially launched group running. Services outside Git participate in full-stack switching.
- Keep the supervisor, sibling services, routes, and devtools alive after foreground service exits, including startup crashes and successful exits. Retain the exit code and logs for web UI recovery; shutdown remains explicit or driven by the configured idle timeout. Failed restart attempts must reset pending state and remain retryable.
- Register selected routes before launching children. Serve standalone startup/recovery documents for root routes, aliases, and path routes independently of toolbar enablement; retain service launch/health failures and logs for explicit recovery. Keep documents pending until health and routing succeed, preserve the original browser URL, and never launch a browser. Recovery control requests keep the public Origin and pass the same `crossOriginProtection` as control requests; their Host is the service's, so the route-host rule does not apply. Apply `proxyLocalOrigin` translation only to app traffic. Assets and WebSockets keep their direct routes. Shutdown signals must cancel startup health waits; retain the in-flight child in runtime ownership for centralized shutdown progress and verified cleanup.
- Publish foreground restart recovery only after replacement health and route refresh succeed. Share route configuration between startup and restart; update document backends without replacing their listeners. Failed route updates must restore prior registrations and configuration, stop the unrouted replacement, preserve retryable recovery, and report rollback failures. Protect runtime manifest snapshots from concurrent health reads during auto-port retries.
- The shared Caddy listeners (`adminAddress`, `bindHost`, `http`, `httpPort`, `httpsPort`) come only from the devhost config file that `internal/config` reads (`config.toml` in `DEVHOST_CONFIG_DIR`, `XDG_CONFIG_HOME/devhost`, or `~/.config/devhost`); manifests reject a `[caddy]` table and route registrations carry no listener settings. `<state>/caddy/applied.json` records the settings Caddy runs: route changes render for them and reload through their admin address, and only `caddy.ApplyManagedCaddySettings` (stack startup and a saved config file) or a managed Caddy start changes them; stop removes the record. Every route mutation and settings change holds the `routes.lock` file lock in the Caddy directory, so concurrent stacks never render with different settings; never take it twice in one call chain. Startup stale cleanup performs no reload. Tests point `StartStackOptions.ConfigPath` or `DEVHOST_CONFIG_DIR` at a config file of their own, and services tests start stacks through `startTestStack`, which writes one from the manifest's Caddy settings. `testenv.IsolateHome`, called from `TestMain` in every package that starts stacks or runs the CLI, keeps each test process away from the machine's config file and state directory: it points `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `DEVHOST_CONFIG_DIR`, and `DEVHOST_STATE_DIR` into a new directory, so an explicit `StartStackOptions.Environment` that names none of them falls back there too. Its config file names the unreachable admin `127.0.0.1:1`, so a test without its own Caddy fails instead of reloading the machine's shared Caddy (`TestStackWithoutAConfigCannotReachTheMachinesCaddy`). A helper process started from the test binary keeps the directories its parent test gave it.
- Keep `proxyLocalOrigin` translation and Origin rejection scoped to the selected service's Caddy handlers. The document hop retains public Host for forwarding metadata while translating Origin to the app address; asset and WebSocket hops translate both. Preserve the option and assigned address across aliases, restarts, and route rollback. Validate the incoming public Origin before translation, including duplicate header values.
- Treat service cleanup as a generic containment contract with platform-specific backends; do not hardcode Linux-only assumptions into shared orchestration code.
- Linux may use stronger containment primitives (currently child-subreaper setup). Descendant tracking and the post-signal managed-port watch (`lateListenerMonitorDuration`, 2 seconds after each stop) run on every platform; listeners are read from `/proc` on Linux and through `lsof` elsewhere, where a missing `lsof` detects none. macOS and other platforms are best-effort and may have weaker guarantees.
- Keep user-facing docs honest about those guarantee differences. Do not describe foreground-service shutdown as perfect or identical across platforms.
- Services that intentionally daemonize, detach, or escape the tracked foreground process tree are unsupported in foreground `command` mode unless there is an explicit cooperative lifecycle contract. Use daemon lifecycle mode for those services instead.
- Treat undocumented `DEVHOST_*` environment variables as internal implementation details. Do not document or rely on them as part of the public service contract unless they are intentionally promoted in `README.md` and covered by tests.
- **Auto-Shutdown Idle Timeout:** The stack-level auto-shutdown monitors Caddy proxy access log modification times (stack-isolated at `caddy.AccessLogPath`, `<caddy-paths>/logs/stack-<manifest path hash>_access.log`, named by `stackAccessLogName` from the root manifest path so a rename keeps it; a manifest-free session uses its name) and active control server WebSocket connections. Upon timeout, the supervisor triggers a clean, graceful cascading teardown (sending `SIGTERM` and cleaning up routing configurations). To support both automated tests with very short timeouts (down to 10ms) and larger production settings without CPU overhead, the log poller and check tickers use adaptive polling intervals (scaled to `idleTimeout / 2` with a minimum of 10ms).

## Logging rules

- All devhost-owned logs must go through the injected logger utility.
- Devhost-owned foreground lines must use the injected logger prefix.
- Manifest logs must use the manifest `name` as the prefix label.
- Pre-manifest logs must fall back to the `devhost` label.
- Retained child diagnostics and browser log records keep `[service-name]` prefixes. Format foreground stack and service output at the CLI writer boundary: human mode uses padded `name | ` prefixes with distinct terminal colors and aligned continuation lines when the width is known; agent mode uses compact `name: ` prefixes without padding, added colors, or wrapping. Include the manifest's logger label in the shared layout before startup, share it between stdout and stderr, and respect `NO_COLOR` and `TERM=dumb`.
- Stack shutdown names the received signal before stopping services, logs each managed service's stopping and successful cleanup once with the manifest prefix, then `Stack stopped.` only after service and routing cleanup succeeds. Keep child diagnostics visible and preserve signal exit codes.
- Startup health errors retain the checked target and actionable configuration hints in logs and recovery state. Explain health-check termination before signaling a foreground service, and name the repository and failing member before startup failure stops its group. Report a detected TCP loopback mismatch once per startup attempt while continuing to check the configured target.
- Generated managed Caddyfiles retain runtime logs in `caddy.runtime.log` using Caddy's native rotating file writer. Capture `caddy start` stdout/stderr in per-instance `caddy.stdout.log` and `caddy.stderr.log`, replaced on each start, so inherited background output handles never leak into the terminal or keep command-output pipes open. Surface only the current startup's runtime diagnostics.
- Route displayed Caddy lifecycle, setup, and reload output through the injected logger and shared CLI layout. Lines Caddy writes use the `caddy` label (`caddy | ` / `caddy: `) and go through `writeCaddyOutput` in `internal/caddy/output.go`; devhost's own messages about Caddy use the `devhost` label. Register `caddy` in each layout that can show Caddy output. Known failures provide a summary and recovery command; human admin-availability errors omit raw transport details, which remain available in agent mode.
- Screen Caddy output before showing it. After a successful command show only Caddy's warnings, errors, and unrecognized lines; after a failure show the rest too. Lines devhost reports itself or that no user setting changes belong in `screenedCaddyMessages`, each with the reason it is left out. Replace a known case with a devhost message that says what it means; do not show raw Caddy lines a reader has no context for.
- Devhost owns local CA trust. The managed Caddyfile sets `skip_install_trust`: Caddy otherwise installs an untrusted root on every configuration load, so each route reload would run `sudo` again from the background process, where nobody can answer it. After devhost starts Caddy, it checks the root with `ReadRootCertificateTrust` and runs `caddy trust` once in the foreground, with `SUDO_PROMPT` carrying the `caddy` prefix. It warns with `UntrustedRootCertificateWarning` instead when it cannot ask (agent mode or no terminal) and when installation fails; a stack that joins a running Caddy warns once. Keep the native adapt regression in `internal/caddy/trust_test.go`.
- Do not print successful Caddy reload chatter during default `devhost start` runs; only print it for `devhost start --debug` or explicit `devhost caddy ...` commands.
- Surface Caddy output on failure, and surface successful reload output only for `devhost start --debug` or explicit `devhost caddy ...` commands.
- Report the failure that ends a command with `cliout.WriteFailure`, and format a warning written outside the logs with `cliout.Warning`; do not hand-write a `failed:` or `WARNING:` prefix for either. A person gets `[ERROR]`, an optional `[INFO]` hint, and `[WARN]`; under `AGENT=1` an agent gets `ERR:` with the whole error and `WARN:`. Wrap an error in `cliout.Failure` where the command line is known (`internal/cli`, `internal/app`) to give a person a hint, or a summary when the error repeats itself or names internals. Devhost-owned foreground logs use `name: ` prefixes in agent mode; foreground stack logs share the human terminal layout with child logs, including warnings within them.
- A test that asserts on a failure or warning line sets `AGENT` itself with `t.Setenv`, because the line depends on it and the test may run under an agent.

## Devtools UI boundary

- Standalone recovery documents and the managed Caddy 404 page share the embedded stylesheet in `internal/statuspage/`. Keep their common typography, themes, card layout, and responsive spacing there; recovery controls stay in `internal/devtools/recovery_page.html`.
- The injected UI source now lives in `packages/devhost-ui/`.
- For injected UI work, follow `packages/devhost-ui/AGENTS.md` plus the nested files under `packages/devhost-ui/src/devtools/`.
- Keep Go-side bundle generation and browser-side UI changes in sync when the embedding contract changes.

## Native chat boundary

- Use installed Codex app-server and Claude Code stream-json protocols with the configured CLI authentication, settings, environment, and selected checkout. Do not inject approval, sandbox, or system-prompt overrides. Omitted models preserve native configured defaults; discover selectable models from each native catalog.
- Native chat sessions belong to the stack across page reloads and closed tabs. Keep in-flight turns alive, retain exact native events for replay, and expose native session IDs for resume. Explicit session deletion and stack shutdown cancel and join owned process groups.
- Relay native approval and user-input requests without approving them automatically. Accept a response only for a currently pending native request ID; publish pendingRequestIds with snapshots and state so replay cannot resurrect resolved requests.
- Validate PNG/JPEG data URL attachments and bound encoded payloads to 8 MiB before forwarding native image inputs. Never accept browser filesystem paths or remote attachment URLs.
- Run `DEVHOST_TEST_INSTALLED_HARNESSES=1 go test -race ./internal/devtools -run TestChat -count=1` from `apps/devhost/` when changing native client protocols. Installed-client startup and discovery tests do not send inference requests.
- `[devtools.chat].enabled` and `[devtools.annotations].enabled` independently configure native chat and the context selector. The former annotation actions/adapters and terminal/Vim launch configuration are rejected. External non-Vim IDE links and React source/highlight metadata remain available.
- The chat routes are registered for the whole stack and answer 404 while `ChatEnabled` is off (`whileChatEnabled`), so a reload turns chat on or off without a restart; sessions already running keep running and keep their sockets. Chat requests that change a session, and the session socket, also need an `Origin` (`requireChatPage`): the control guard has refused a foreign one, and a client with none is not a page.

## Control server and test networking rules

- Every control request passes `guardControlRequests` (`internal/devtools/request_guard.go`). Unsafe methods go through the standard `http.CrossOriginProtection`; websocket upgrades use the gorilla upgrader's default origin check, so never give an upgrader a `CheckOrigin` that accepts every origin. Both kinds, and every `/__devhost__/config/` request, must also name a Host that is a loopback name or a route this stack owns (`OwnsDocumentURL`), which refuses a page whose own name was rebound to the control port. Requests with a body must be `application/json`. A local tool that sends no browser headers passes, except on the chat routes above.
- The config editor writes only the paths `ListConfigFiles` returns, only for a client whose address and every `X-Forwarded-For` entry are loopback, and only content that passes `CheckConfigFile`: the reader overlay plus `resolveReloadCandidate` and `validateServiceWorkingDirectories`, which a reload also runs. The write starts no reload of its own; the file watcher applies it, and `HealthResponse.Configuration` counts finished reloads per source so the page can tell when the reload after its save is done.
- Never close a websocket client while holding the control server lock: a close waits for that client's in-flight write, which can stall on a dead connection. Drop the client from server state under the lock, release it, then close.
- End a browser connection the server closes on purpose with `closeWith` and a close code, never with bare `close`: the page reopens every connection that ends without `1000` (normal closure). Use `1001` (going away) when the stack stops, so pages reconnect to the next run, and `1000` when what the connection served is over, such as a deleted chat session. Bare `close` is for a connection that is already broken or that the browser is closing.
- A client attaching to a chat session or the log stream must receive its snapshot before any broadcast. Take the client write lock before registering it for live publication; chat attachment and publication share the session lock.
- Health has no snapshot message: `publishHealth` records the health sent last and sends it as one step under `healthMu`, and an attach goes through it, so the health read for a new client also reaches the earlier clients it is news to. Do not set `lastPublishedHealth` anywhere else.
- Resource usage follows the health pattern: `publishResourceUsage` reads the sampler, records the message sent last, and sends it as one step under `resourcesMu`; an attach goes through it. `[devtools.resources]` resolves to `hostusage.Intervals`, where a zero interval is a readout that is off; with all three off no sampler runs and `/__devhost__/ws/resources` answers 404. `UpdateSettings` restarts the sampler when the intervals change and, when they all turn off, closes the open resource streams with `1000`, since what they served is over. The readouts do not count toward `hasEnabledDevtools`: they show in the toolbar other devtools features bring, and never inject the overlay by themselves. `Stop` joins the sampler after closing its clients.
- Write to a browser connection only through `websocketClient.write` or `writeJSONMessagesLocked`. Both set a write deadline (`WebsocketWriteTimeout`, ten seconds by default), so a page that stops reading cannot block whoever publishes to it. A write that misses the deadline leaves the connection unusable: drop the client, as every caller does on a write error.
- A test that hands a port number to devhost or to a child process, or needs an address that refuses connections, takes the port from `nettest.ReservePort(t)` or `nettest.ReservePorts(t, n)` (`internal/nettest`). Do not close a listener and expect its port to stay unused: another test or process can claim it first.
- `internal/nettest` reserves through `github.com/hashicorp/consul/sdk/freeport`: the ports lie outside the range the kernel assigns to `:0` listeners, and each one returns to the pool when the test ends. It calls `freeport.Take`, not `freeport.GetOne` or `freeport.GetN`, which write two lines to stderr for every reservation. Call freeport only through `internal/nettest`.
- A test that needs a Caddy admin endpoint uses `caddytest.StartAdminServer(t)` (`internal/caddy/caddytest`), or `caddytest.UnusedAdminAddress(t)` for a Caddy that is not running. Both clean up when the test ends.
- Do not make a test beat a timer. Use an unreachable timeout while a test attaches or inspects, a short one only where the test waits for the timer to fire, and read scheduled state directly instead of sleeping to prove that nothing happened.
- Git and the shell report physical paths, and tests compare them with paths built from `t.TempDir()`. On macOS the temporary directory sits behind the `/var` symbolic link, so a package with such tests calls `testenv.UsePhysicalTempDir()` from `TestMain`, as `internal/services` and `internal/devtools` do. Reproduce a failure of this kind on Linux by running the tests with `TMPDIR` set to a symbolic link.
- Managed Caddy defaults to `bindHost = "0.0.0.0"` (all IPv4/IPv6 interfaces), with `http = false`; admin and service bind defaults remain on loopback. Route changes render the Caddyfile for `runtime.GOOS`, and macOS retains its omitted `default_bind` behavior for explicit `127.0.0.1`. A Caddy test fixture that route code later rewrites, or an expectation compared with what it wrote, renders for `runtime.GOOS` too; a literal operating system belongs only in tests of the rendering itself.

## Go naming rule

- Name error variables `err`, never `error`. A local `error` hides the built-in `error` type for every function literal declared after it in that scope, so a later `func() (T, error)` fails to compile. `just devhost lint` runs `go tool predeclared ./...` (a `tool` directive in `go.mod`), which rejects any declaration that shadows a built-in identifier.

## CLI output boundary

- Route terminal diagnostics through `internal/cliout`: `WriteLog` returns write errors, `Log` is best-effort, and `WriteFailure` / `WriteWarning` apply the shared label, severity, and home-path formatting. Reuse the stack's `ServiceOutputWriters` layout. Keep filesystem paths absolute internally.
- Child process text goes through `WriteChildLine` with the shared `Prefix`; retained records keep their canonical brackets. Machine-readable command lists and certificate bytes go through `WriteData` without diagnostic formatting. Never use these byte-preserving APIs to bypass diagnostic formatting.
- `just devhost lint-logging` runs the type-aware `go tool logpolicy ./...` analyzer. It is also mandatory in `just devhost lint`, `just devhost check`, and root `just check`. The analyzer rejects direct terminal/generic-writer output, standard logging imports, output function aliases, and hand-built log/severity prefixes outside `cliout`; tests, HTTP bodies, buffers, and file writes have separate contracts. Keep analyzer regression cases under `internal/logpolicy/testdata/`.

## Shared tooling boundary

- Repo-root `package.json`, `oxfmt.config.ts`, and `oxlint.config.ts` own the shared TypeScript AI policy tooling.
- Do not reintroduce workspace-local copies of `@alexgorbatchev/typescript-ai-policy`, `oxfmt`, `oxlint`, or the shared lint/format configs here unless the workspace must intentionally diverge.

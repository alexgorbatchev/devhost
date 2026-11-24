---
created_on: 2026-11-20 19:52
last_modified: 2026-11-24 06:31
status: current
---

# Go baseline for the Rust port

Use this reference to compare Rust features with the Go implementation and account for Go changes that land during the port. The Go CLI and its existing release remain the reference implementation. Both implementations use the same public documentation and browser assets.

## Initial baseline

| Reference                       | Tag or ref    | Full Git SHA                               |
| ------------------------------- | ------------- | ------------------------------------------ |
| Published Go release at kickoff | `v0.0.14`     | `f7f89fd1d3adc8f0ed64e013843d0efbbd293713` |
| Go main at kickoff              | `origin/main` | `02de2dd3783e8abb1564c34ee067f93e064d05aa` |

The kickoff backlog includes manifest watch paths relative to service working directories, macOS missing-process handling, and the Markdown view at first paint. The range also clarifies serve session and local-routing documentation, changes the repository's `just run` to use the existing detached startup option, and adjusts the demo recorder's window sizing.

There are no verified Rust features at kickoff. Record a separate tested Go SHA for each feature as comparison evidence becomes available.

## Feature verification

For a whole-port pass, start with the [Go-derived feature matrix](rust-port-feature-matrix.md). Its machine-readable inventory accounts for every production Go file, public documentation page, example manifest, README and distributed skill at the reviewed reference. Run its integrity check before accepting comparisons; a passing inventory does not establish behavioral parity.

Use the CLI and output references, the distributed skill, the Go implementation and tests, and the browser control and chat protocol references to identify behavior affected by a slice. Compare the Go and Rust executables on matching inputs with separate configuration, state, ports, temporary directories, and subprocess ownership. Compare the relevant exit codes, output streams, state changes, protocol messages, and cleanup. Normalize variable values such as process IDs and temporary paths only where their exact values are outside the contract. Run platform-dependent comparisons on the applicable platform.

Record the feature, full Go SHA, full Rust SHA, platform, checks and results in the feature's task record. If the Go commit advances before a feature lands, review the intervening changes before accepting the evidence. Compare against a newer Go revision whenever an intervening change affects the feature.

## Record and replay with Rust Anything

Install [Rust Anything v3.3.0](https://github.com/erkamyaman/rust-anything/releases/tag/v3.3.0) from its release archive. Verify the archive against its published SHA-256 and put `rust-anything` on the agent client's `PATH`. From the port worktree, open the `devhost-rust-parity` skill. The worktree declares `rust-anything mcp` in the Codex, Claude Code, and Antigravity project config files. Approve the project server if the client prompts. The CLI works without an agent session.

In a checkout at the Go SHA under test, run `just cli --version` to build the Go oracle at `apps/devhost/bin/source/devhost`. From the Rust worktree, build the Rust binary and point the recording at the absolute path of that Go executable. Keep recordings in a separate scratch directory per slice. This smoke case checks the entire service list and the startable filter.

```sh
just rust build
mkdir -p .state/rust-anything/service-list
rust-anything app record .state/rust-anything/service-list \
  --inputs "$PWD/apps/devhost/rust/tests/service-list.jsonl" --no-traps \
  --name devhost -- /absolute/path/to/go-checkout/apps/devhost/bin/source/devhost
rust-anything app replay .state/rust-anything/service-list \
  --build "$PWD/apps/devhost/rust/target/debug/devhost"
```

Keep case inputs small and focused on the active ticket. Inspect the replay report under the recording directory's `rust/app-cases/`. Add cases for the new behavior and use `app replay --case` for targeted reruns. Use the same isolated state for recordings and replays that touch files or services. Keep generated source out of the existing Rust crate.

## Native HTTPS health fixture

The shared `stack_lifecycle` HTTPS test uses an HTTP/2-only loopback server and verifies certificate trust, successful health responses and rejected status codes against each executable. Linux uses a private CA file through `SSL_CERT_FILE`. Go on macOS uses Security.framework instead, so that platform needs a root already trusted by the test user.

On disposable GitHub-hosted macOS runners, source and candidate jobs run `bash test-support/macosHealthTrust.sh prepare`. It generates a unique one-day CA and a separate server certificate for `127.0.0.1`, adds only that CA to the admin trust store, and exports `DEVHOST_HEALTH_TRUST_DIR` through `GITHUB_ENV`. An unconditional cleanup step runs root's `security delete-certificate -t` against that exact fingerprint in the system keychain, removing its user and admin trust settings and certificate before its private files. Current macOS admin trust authorization can request an interactive password even for root when removing the last trust entry. Cleanup saves that authorization rule, temporarily requires `is-root`, and restores the original rule on success, failure or a handled signal. Every cleanup Security command has a 15-second limit, leaving restoration time within the two-minute step deadline. Cleanup errors fail the job; partially completed cleanup retains its own state for a retry. The script refuses other hosts and preserves all pre-existing certificates and trust settings.

For local macOS validation, provision a certificate explicitly on an isolated test user or disposable machine. Set `DEVHOST_HEALTH_TRUST_DIR` to a private directory containing `root.pem`, `server.pem` and `server.key`; the server certificate must be valid for IP `127.0.0.1`, allow TLS server authentication, and chain to the root trusted by that user. Run the normal Rust test or comparison recipe with that variable. Remove only the fixture's own certificate and trust after its final consumer. The test fails with a prerequisite diagnostic when this directory is missing; it never skips HTTPS verification or edits the local trust store itself.

## Native remote-preview tests

The remote transport integration suite runs a native Chisel 1.12.0 relay and
isolated managed Caddy instances. It uses `.cache/test-dependencies/chisel-v1.12.0`
when available and otherwise builds the pinned Chisel version with Go. Install Go
before running this suite; the test fixture serializes dependency provisioning.
It never connects to a production relay or installs a CA in the machine trust
store.

```sh
just rust test --test remote_transport
```

Set `DEVHOST_REMOTE_TEST_BINARY` to the absolute path of the Go oracle to run the
same CLI scenarios against Go. Native checks cover enrollment, shared connectors,
route reloads, reconnection, origin and forwarding headers, WebSocket traffic,
verified backend TLS, slow uploads, keepalives, detached startup, and cleanup.

Makiko 0.2.5 is vendored with generic server global-request support because its
released API cannot answer the relay's keepalives. The [dependency patch
notes](../../../apps/devhost/rust/vendor/makiko/DEVHOST-PATCH.md) describe the
extension and the condition for returning to a registry release.

## Native chat tests

`just rust test --lib devtools::chat::` exercises the native Codex app-server
and Claude stream-JSON boundaries with local protocol peers, including model
discovery, ordered sends, approvals while a send awaits confirmation, exact
native request IDs, turn-steering races, queued and unconfirmed delivery,
disk-backed replay, image validation, private activity logs, panel persistence,
and process termination. These peers perform no model inference and use
`python3` from `PATH`, as do the shared native stack fixtures.

`just rust test --test stack_commands chat::` runs the shared HTTP/WebSocket
scenario through an isolated native stack. Set `DEVHOST_STACK_TEST_BINARY` to
the absolute Go oracle executable to compare model discovery, annotation image
delivery, reconnect replay, conversation closure, and stack cleanup against Go.

## Native stack-command tests

`just rust test --test stack_commands processes::` also compares cooperative and
TERM-ignoring children, including a child in its own session, through the selected
CLI's actual stop command. It verifies signal delivery, bounded escalation,
supervisor exit, descendant death, and an unrelated surviving sentinel. Synthetic
stale stack, hostname, port and route records use the sentinel's PID with a wrong
process-start identity to verify that inspection, stop and restart leave it alive.
Shutdown signaling reads a current process tree before the parent can exit;
background polling retains its shared snapshot.

The same suite holds a failing service behind a file handshake until its healthy
dependency is listening and routed. Detached startup then fails and must stop
the dependency, release its listener and owner records, remove its route, and
leave the shared Caddy running. The console shows at most 30 retained log lines;
the full log preserves all 40 emitted lines and the failure marker is removed.

The lifecycle suite changes the watched machine configuration while a file route
is live. Invalid ports and a changed local suffix must preserve the working
route. A valid HTTP-port update and its reversal must move the listener while
preserving the Caddy and supervisor processes. The same assertions run against
the unchanged Go oracle, repaired Go, and optimized Rust.

Cross-stack reload cases reject another stack's hostname and fixed port while
both original workers and routes remain live. After a successful removal is
announced, the removed worker must be dead and a third stack must be able to
reuse its hostname and port. The original stack's retained service and the
unmodified second stack must stay available throughout.

`just rust test --test stack_commands` checks live owner lookup, manifest identity,
foreground and detached supervisor replacement, launch environment and directory
preservation, private restart logs, and replacement of file-serving sessions.
Set `DEVHOST_STACK_TEST_BINARY` to the absolute Go oracle executable to compare
the same scenarios. Both implementations now use `restart-all` for global
replacement and `stack restart --all` for the current project. The suite checks
both scopes, including manifest-free file and command sessions. Use a Go revision that preserves registration timestamps across
unchanged reloads; older versions can refuse a valid global restart while their
initial manifest check rewrites a registration.
An unexpected launch-capture failure must leave every live owner running and remove
partial restart logs. The shared fixture verifies this with a stack, a file-serving
session and a registered process that is not a devhost command.

Successful short-flag lifecycle cases run from outside the project in human and
agent modes. They compare explicit manifest and idle-timeout flags against invalid
environment values, Boolean short flags, service filtering, selected-service
routes, stack information and stopping the explicitly selected manifest.

The standalone file cases serve explicit and default directories beside malformed
manifests, including an invalid explicit manifest override. They compare short
domain and port flags, local-only owner registration, two simultaneous file
sessions, duplicate-host rejection, and stopping one session while the other and
Caddy remain live. The external-port case withdraws only the session's route on
stop, then checks that the independently owned backend still serves its response
directly.

The command-session cases launch a real HTTP server and an unsupported TCP listener,
wait for HTTP readiness, add and close listeners, verify stable short aliases and
port-qualified names, inspect and stop named sessions, replace the supervisor, and
check failed-start cleanup. `command-serve.jsonl` compares validation, missing-session
errors and short flags with Rust Anything.
The named-session fixture also compares direct argv and a quoted shell command
with spaces, empty arguments, literal shell variables and quotes. Live name cases
cover cwd, local repository, origin remote and entrypoint repository inference,
empty sanitized labels, length truncation and random session identifiers.

The stack-command suite also runs on macOS. Process ownership there uses the
kernel's microsecond start timestamp in the same decimal format as Go; launch
capture uses `sysinfo` for arguments, environment, and working directory. Native
process snapshots track descendants, and listener discovery uses `lsof`, matching
the Go platform dependency. Cross-target compilation checks these code paths but
does not replace native macOS execution before platform acceptance.

`just rust test-affected <base>` selects this Cargo package when its sources,
fixtures, embedded UI/design assets, or shared test inputs change. `just rust
check` runs its formatting, Clippy, and 90% line/function coverage gates. Coverage
uses line-table debug information in a separate instrumented target, preserving
the normal development target and its incremental state.

## Native worktree tests

`just rust test --lib worktree` exercises real Git repositories, linked
checkouts, submodules, detached and locked checkouts, default branch discovery,
external owning manifests, private saved selections, and request validation.

`just rust test --test stack_lifecycle runtime::worktrees` uses isolated native
Caddy instances and real services to check whole-stack switching, saved
selection restore, selected-manifest reload, occupied checkout ownership,
rollback, unavailable checkout recovery, and disabling worktrees. Failed
restoration leaves the repository stopped; restarting one member retries its
whole group. These fixtures own and join their services before removing their
temporary directories.

The shared `stack_commands` worktree fixture runs against each comparison
executable. It checks switching to a locked detached checkout and default-branch
discovery with absent, agreeing and conflicting remote HEAD references. Real
submodule checkouts exercise owning-manifest fallback and checkout-local manifest
precedence. Invalid saved selections reject startup before claiming ownership;
a valid selection whose checkout disappeared leaves every group member stopped
until an explicit recovery. Competing-owner requests validate repository,
checkout and owner identity, then stop that owner before a separate switch.
Failed startup and failed restoration leave the whole group stopped; restarting
one member retries every member. Family-wide stop preserves an independent Git
repository. These cases run alongside saved-selection restoration and disabling
worktrees. A Git worktree lock protects a checkout from pruning; it does not make
a valid checkout unavailable.

## Native control tests

`just rust test --lib devtools::` checks configuration file discovery, schema,
validation, version conflicts, atomic saves, local-access guards, responsive
status reads during pending mutations, and health, logs, resources, and editor
cursor WebSockets. Stream tests check configuration changes and shutdown close
codes as well as initial messages.

`just rust test --test stack_commands control::` compares the same live CLI
fixtures across executables. Service and whole-stack restarts must each launch
the worker once and retain the supervisor. Config-editor checks discover include
files and move Caddy's HTTP listener through a machine-config save; rejected
settings preserve the accepted listener and disk content. Resource frames check
byte units and percentage relationships. Live enablement changes remove disabled
fields, close existing sockets normally when sampling is disabled, reject new
attachments, and allow memory-only re-enablement. These cases use the supported
250 ms minimum interval; they do not establish sampling cadence.

`just rust test --test devtools_assets_injection` checks native document
injection and recovery-page proxying. The recovery callback owns its own Tokio
runtime, matching the blocking boundary used by stack supervision.

Record `apps/devhost/rust/tests/stack-info.jsonl` with the Rust Anything workflow
above to compare command help, manifest errors, and missing-stack diagnostics.
`just rust test --test stack_commands info::` checks readiness exit codes in both
output modes, included and symlinked manifest selection, live snapshot overrides,
control-server failures, and failure-context formatting against an isolated
loopback server.
Use isolated live stacks for readiness, service-start, restart, configuration
save, and browser acceptance comparisons. Check written configuration on disk
as well as the browser's save result.

`just rust test --test stack_commands recovery::` compares foreground startup
health timeouts, explicit recovery and failed-recovery retries, crash status
without automatic respawning, concurrent starts of an unselected service, and
routed traffic renewing idle shutdown. Negative durations are supplied as
separate CLI arguments. Reads and retained routes remain responsive during
pending health checks; every fixture stops its services and releases ownership.

`just rust test --test files_live` checks native file-server shutdown and restart,
including a child paused between fork and exec with an inherited listener.
Port reservations shut down their sockets before close, and file-server shutdown
releases the listening socket across inherited descriptors. Close-on-exec alone
does not release those copies while a child is still preparing to execute.

## Native agent activity tests

`just rust test --lib devtools::` checks shared discovery caching,
partial scan failures, checkout and subagent filtering, attention ordering,
request guards, worktree selection, bounded event projection, history suppression,
and joined watcher shutdown. Activity clients own separate temporary cursor,
session, and database checkpoint files; shutdown joins each watcher before those
files are removed.

`just rust test --test stack_commands agents::` starts an isolated native stack
and checks discovery and activity HTTP/WebSocket contracts against real process
identity and temporary harness storage. Set `DEVHOST_STACK_TEST_BINARY` to the Go
oracle executable to run the same scenarios against Go.

## Native completion and argument tests

`just rust test --test cli` checks completion registration for Bash, Zsh, Fish,
and PowerShell, installation help, description control, output modes, invalid
arguments, Boolean values, repeated flags, and manifest precedence. It sources
the Bash script in a real shell and queries command, subcommand, and flag
candidates. Record `apps/devhost/rust/tests/cli-precedence.jsonl` with Rust Anything
to compare manifest selection and Boolean flags with Go.

Rust uses `clap_complete` to generate scripts from its native clap command tree.
Compare candidates and shell registration behavior; script bytes, Cobra's
internal completion request commands, and parser diagnostic wording are
framework-specific. Preserve command names, short flags, exit status, output
streams, and help guidance. Check the generated scripts in the native shells
when validating supported platforms.

## Catch up with Go main

From the port worktree, refresh local Git objects and run the drift report. It reads the [reviewed Go SHA](../../../apps/devhost/rust/reviewed-go-sha), queries live Go main and the latest published GitHub release, and lists the untriaged commit SHAs and changed paths. The report itself leaves the checkout and baseline untouched.

```sh
git fetch origin main --tags
cargo run --locked --manifest-path apps/devhost/rust/Cargo.toml --bin go-drift
```

Exit status 2 means history needs reconciliation before advancing the baseline. Exit status 1 means the report could not run. Inspect the full diff for each new commit, including docs and tests. Update the affected parity tickets or file a catch-up ticket for behavior already ported, recording the full Go SHA and expected behavior. Record tooling-only changes as reviewed when they do not affect parity. Advance `reviewed-go-sha` after classifying the range. Advance feature verification SHAs only after comparing behavior at the new baseline.

## Owned dependency candidates

| Go dependency        | Existing public Rust repository                                                | Observed revision                          |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `cobra-help-tree/v4` | [cli-command-kit-rust](https://github.com/alexgorbatchev/cli-command-kit-rust) | `dead4a60e08c7a84bc77ef329b220bfecd57627b` |
| `agent-watcher`      | [agent-watcher-rust](https://github.com/alexgorbatchev/agent-watcher-rust)     | `f5cf3667bb55cc2bb2b01d4079b92511b9f28005` |
| `agent-parser`       | [agent-parser-rust](https://github.com/alexgorbatchev/agent-parser-rust)       | `2c013b856c26ec215120a2c39973e16381c645dc` |

The CLI kit and parser revisions identify the public source inspected at kickoff.
The watcher revision supplies cached read-only discovery, normalized live state,
session filtering, and first-scan history suppression. It establishes transcript
cursors before announcing initial live sessions, preserving events written during
lifecycle delivery. The watcher pins the listed parser revision. Verify the APIs
and behavior against the Go consumer before selecting Rust dependency versions.
Track missing reusable behavior in its owning dependency repository and consume
the published revision after verification. Keep Devhost-specific integration in
this repository.

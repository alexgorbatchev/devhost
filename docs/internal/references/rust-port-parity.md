---
created_on: 2026-11-20 19:52
last_modified: 2026-11-22 20:25
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

## Native stack-command tests

`just rust test --test stack_commands` checks live owner lookup, manifest identity,
foreground and detached supervisor replacement, launch environment and directory
preservation, private restart logs, and replacement of file-serving sessions.
Set `DEVHOST_STACK_TEST_BINARY` to the absolute Go oracle executable to compare
the same scenarios. The comparison maps Rust's global `restart-all` to Go's older
`stack restart --all` spelling and excludes the explicitly changed project-scoped
`--all` scenario. Use a Go revision that preserves registration timestamps across
unchanged reloads; older versions can refuse a valid global restart while their
initial manifest check rewrites a registration.

`just rust test-affected <base>` selects this Cargo package when its sources,
fixtures, embedded UI/design assets, or shared test inputs change. `just rust
check` runs its formatting, Clippy, and 90% line/function coverage gates. Coverage
uses line-table debug information in a separate instrumented target, preserving
the normal development target and its incremental state.

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
| `agent-watcher`      | [agent-watcher-rust](https://github.com/alexgorbatchev/agent-watcher-rust)     | `9c7532c9950c6fd188374e8ff7266480c558ab7c` |
| `agent-parser`       | [agent-parser-rust](https://github.com/alexgorbatchev/agent-parser-rust)       | `2c013b856c26ec215120a2c39973e16381c645dc` |

The revisions identify the public source inspected at kickoff. The watcher already pins the listed parser revision. Verify the APIs and behavior against the Go consumer before selecting Rust dependency versions. Track missing reusable behavior in its owning dependency repository and consume the published revision after verification. Keep Devhost-specific integration in this repository.

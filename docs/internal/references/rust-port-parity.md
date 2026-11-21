---
created_on: 2026-11-20 19:52
last_modified: 2026-11-20 19:52
status: current
---

# Go baseline for the Rust port

Use this reference to compare Rust features with the Go implementation and account for Go changes that land during the port. The Go CLI and its existing release remain the reference implementation. Both implementations use the same public documentation and browser assets.

## Initial baseline

| Reference                       | Tag or ref    | Full Git SHA                               |
| ------------------------------- | ------------- | ------------------------------------------ |
| Published Go release at kickoff | `v0.0.14`     | `f7f89fd1d3adc8f0ed64e013843d0efbbd293713` |
| Go main reviewed through        | `origin/main` | `02de2dd3783e8abb1564c34ee067f93e064d05aa` |

The kickoff backlog includes manifest watch paths relative to service working directories, macOS missing-process handling, and the Markdown view at first paint. The range also clarifies serve session and local-routing documentation, changes the repository's `just run` to use the existing detached startup option, and adjusts the demo recorder's window sizing.

There are no verified Rust features at kickoff. Record a separate tested Go SHA for each feature as comparison evidence becomes available.

## Feature verification

Use the CLI and output references, the distributed skill, the Go implementation and tests, and the browser control and chat protocol references to identify behavior affected by a slice. Compare the Go and Rust executables on matching inputs with separate configuration, state, ports, temporary directories, and subprocess ownership. Compare the relevant exit codes, output streams, state changes, protocol messages, and cleanup. Normalize variable values such as process IDs and temporary paths only where their exact values are outside the contract. Run platform-dependent comparisons on the applicable platform.

Record the feature, full Go SHA, full Rust SHA, platform, checks and results in the feature's task record. If the Go commit advances before a feature lands, review the intervening changes before accepting the evidence. Compare against a newer Go revision whenever an intervening change affects the feature.

## Catch up with Go main

From the port worktree, fetch Go main and check the GitHub releases list for a new published CLI release. A Git tag alone does not establish that a release was published.

```sh
git fetch origin main
git rev-parse origin/main
reviewed_go=02de2dd3783e8abb1564c34ee067f93e064d05aa
git merge-base --is-ancestor "$reviewed_go" origin/main
git log --reverse --format='%H %s' "$reviewed_go..origin/main"
```

Set `reviewed_go` to the current reviewed SHA from the table. If the ancestry check fails, find the common ancestor and reconcile the changed history before moving the baseline. Inspect the full diff for each new commit, including docs and tests. Update the affected parity tickets or file a catch-up ticket for behavior already ported, recording the full Go SHA and expected behavior. Record tooling-only changes as reviewed when they do not affect parity. Advance the reviewed SHA after classifying the range. Advance feature verification SHAs only after comparing behavior at the new baseline.

## Owned dependency candidates

| Go dependency        | Existing public Rust repository                                                | Observed revision                          |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `cobra-help-tree/v4` | [cli-command-kit-rust](https://github.com/alexgorbatchev/cli-command-kit-rust) | `dead4a60e08c7a84bc77ef329b220bfecd57627b` |
| `agent-watcher`      | [agent-watcher-rust](https://github.com/alexgorbatchev/agent-watcher-rust)     | `9c7532c9950c6fd188374e8ff7266480c558ab7c` |
| `agent-parser`       | [agent-parser-rust](https://github.com/alexgorbatchev/agent-parser-rust)       | `2c013b856c26ec215120a2c39973e16381c645dc` |

The revisions identify the public source inspected at kickoff. The watcher already pins the listed parser revision. Verify the APIs and behavior against the Go consumer before selecting Rust dependency versions. Track missing reusable behavior in its owning dependency repository and consume the published revision after verification. Keep Devhost-specific integration in this repository.

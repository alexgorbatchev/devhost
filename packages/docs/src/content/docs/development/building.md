---
title: "Build from source"
---

Build devhost from a checkout of [the repository](https://github.com/alexgorbatchev/devhost) to try unreleased changes or work on devhost itself.

## Build a binary

Install rustup (the repository pins its Rust toolchain in `apps/devhost/rust-toolchain.toml`, minimum supported Rust 1.98), Bun, and `just`, then build an optimized native binary:

```bash
just setup
just devhost build-release
./apps/devhost/target/release/devhost --version
```

`just setup` installs the workspace dependencies, fetches Cargo crates, and builds the embedded toolbar and status pages. `just devhost build-release` rebuilds production browser assets and writes an optimized binary for your platform to `apps/devhost/target/release/devhost`, stamped with the version in `apps/devhost/metadata.json`. In a GitHub tag build, the tag must match that version. The executable runs independently of the checkout. Run `just devhost compile` to also copy it to `apps/devhost/bin/devhost`.

To run devhost from source without installing it, use `just cli <args>`, or `just run-ai <args>` for agent output (both forward to `just devhost run` and `just devhost run-ai` and run in the directory you call them from). `just run` starts the repository's development stack in the background and waits for it to become ready. Run `just cli stop` from the repository root to stop it.

## Rust workspace and packaging

Build a debug executable at `apps/devhost/target/debug/devhost` with `just devhost build`. The run, build, and validation recipes refresh the embedded browser assets, so a fresh checkout needs no manual asset generation after setup. `just devhost check` checks formatting, strict Clippy, script tests, and native Rust tests; `just devhost coverage` enforces 90% line and function coverage for first-party Rust sources. Root `just fix` formats the first-party Rust package alongside the other workspaces.

CI runs the shared repository checks and native Rust checks across hosted Linux x64 (including MSRV Rust 1.98.1 and 90% coverage), Linux ARM64, macOS ARM64, and macOS Intel. The [release runbook](https://github.com/alexgorbatchev/devhost/blob/main/apps/devhost/RELEASE.md) describes packaging and release verification.

The shared HTTPS health test on macOS needs an explicitly trusted local test certificate. Hosted CI creates a unique CA on each disposable macOS runner VM, which is destroyed after the job. Contributor machines are never changed automatically; follow the [native HTTPS fixture procedure](https://github.com/alexgorbatchev/devhost/blob/main/docs/internal/references/macos-https-health-fixture.md) to supply a trusted certificate before running that test locally.

Package release archives locally with `just devhost build-release-artifacts --targets=linux-x64`, or omit the target filter to build all five archive targets. Linux packaging requires Zig and `cargo-zigbuild`; package `darwin-arm64` on macOS with its SDK. The command writes a new directory under `apps/devhost/dist/rust-candidates/` (or the path passed to `--output`) with versioned archives, compiled Rust dependency licenses (`THIRD_PARTY_LICENSES.txt`), `SHA256SUMS`, and source/toolchain provenance. GNU archives target glibc 2.28; musl archives are checked for static linking. On the matching host the packager checks extraction, executable permissions, version/help/manifest loading, HTTPS and embedded browser assets with a private CA, global restart, and stop without changing system trust.

Set `AGENT=1` for agent-oriented help and detailed stack inspection output.

## Use a protected development build

Run `just dev-bootstrap` to build and register devhost in `~/.dotfiles`, or pass a different dotfiles project with `just dev-bootstrap /path/to/dotfiles`. The project must declare devhost and the dotfiles CLI on PATH must support `tool dev use`. Dotfiles copies the build into its configured development store, keeps the release payload unchanged, and preserves the development override during updates and cleanup. Run `dotfiles tool dev off devhost` from that project to return to managed releases.

## Iterate on the toolbar

A development build serves the toolbar from its source checkout and rebuilds it when you reload a page, so UI changes show up without rebuilding devhost or restarting the stack.

1. Use a development build. `just run`, `just cli`, `just run-ai`, `just devhost run`, `just devhost run-ai`, and `just dev-bootstrap` (which activates the protected development build in dotfiles) all record the checkout they were built from. For any other build, set `DEVHOST_DEV_SOURCE_DIR` to the checkout's root; a relative path resolves from the manifest's directory, and the variable wins over a recorded checkout.
2. Edit files under `packages/devhost-ui/src/devtools/` and reload the page.
3. When those files are newer than the built bundle, devhost rebuilds it, one build at a time, and serves it uncached. Tabs that loaded an earlier build keep working.
4. A failed build shows a `DEVHOST COMPILATION ERROR` banner on the page with the details; the next reload tries again.

Changes to Rust code need a new binary: rerun `just dev-bootstrap`, or restart `just run`, which rebuilds on start.

If `DEVHOST_DEV_SOURCE_DIR` does not point at a devhost checkout, `devhost start` fails and names the path. If a development build's recorded checkout has moved or been deleted, devhost warns at startup and serves the toolbar built into the binary.

A development build also lets chat work on devhost itself; see [Chat about devhost itself](../../guides/annotations/#chat-about-devhost-itself).

---
created_on: 2026-11-24 13:25
last_modified: 2026-11-24 13:25
status: current
---

# Prepared Rust production cutover switch

This document specifies the exact, reviewable changes required to switch the active production build, protected development override, and GitHub Release publisher from Go to Rust once all readiness gates pass and production cutover is separately approved.

Until that approval is granted, the checked-in Go build (`just devhost compile`), protected development override (`just dev-bootstrap`), and release workflow (`.github/workflows/publish.yml`) remain active and unchanged.

## Exact changes to apply on approved cutover

### 1. `.github/workflows/publish.yml`

Replace the single Linux Go cross-compile job with a matrix that runs the shared repository checks and native Rust checks, builds all five archives through `just rust build-release-artifacts`, verifies checksums/licenses/provenance, uploads the five archives plus `SHA256SUMS`, and keeps the existing downstream `docs` job unchanged:

1. **Preflight & validation job (`verify`)**:
   - Keep `fetch-depth: 0`, Bun (`package.json`), Go (`apps/devhost/go.mod`), Rust (`apps/devhost/rust/rust-toolchain.toml` with `rustfmt`, `clippy`, and `llvm-tools-preview` components), and Just setup.
   - Keep tag derivation (`RELEASE_VERSION="${GITHUB_REF_NAME#v}"`) and `apps/devhost/metadata.json` equality check.
   - Install dependencies (`bun install --frozen-lockfile`), Playwright Chromium (`just ui install-browser`), Linux test tools (`ffmpeg`, `unzip`, `xvfb`), `cargo-llvm-cov`, and native `caddy` and `chisel` binaries required by `just rust check`.
   - Run `just check` and `just rust check` (which includes formatting, strict Clippy, and the 90% first-party coverage floor).
   - Run `bun apps/devhost/scripts/verifyRustParity.ts` (until the Go runtime is retired in a later cleanup).
2. **Native packaging matrix (`package`, `needs: verify`)**:
   - `ubuntu-latest` (`linux-x64`, `linux-x64-musl`, `linux-arm64`, `linux-arm64-musl`, or split native `ubuntu-24.04-arm` for native ARM64 smoke): install Zig + `cargo-zigbuild`, Rust targets, and native `caddy` (used by `verifyRustReleaseRuntime.ts`), then run `just rust build-release-artifacts --targets=<slice> --output=apps/devhost/dist/release-<slice>`.
   - `macos-latest` (`darwin-arm64`): install native `caddy`, then run `just rust build-release-artifacts --targets=darwin-arm64 --output=apps/devhost/dist/release-darwin-arm64`.
   - Each job uploads its verified `.tar.gz` archives, `SHA256SUMS`, and `provenance.json` as workflow artifacts.
3. **Publish job (`publish`, `needs: [verify, package]`)**:
   - Download all five archive artifacts, merge and verify `SHA256SUMS` (`sha256sum -c`), assert all five archive suffixes (`darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`) are present and every archive contains `devhost`, `README.md`, `LICENSE`, and `THIRD_PARTY_LICENSES.txt`.
   - Create or reuse the GitHub Release (`gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes --latest`) and upload the five `.tar.gz` archives and `SHA256SUMS` with `--clobber`.
4. **Docs job (`docs`, `needs: publish`)**:
   - Unchanged: calls `./.github/workflows/docs.yml` on the release tag so GitHub Pages deploys only after the release assets exist.

### 2. Root `justfile` and `apps/devhost/scripts/devBootstrap.ts`

Switch `dev-bootstrap` to build the Rust executable with the stamped development version and source checkout directory:

```just
# Build and register a protected devhost development override
dev-bootstrap $dotfiles_dir=(env_var("HOME") / ".dotfiles"):
    just devhost build-devtools-bundle
    base="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || echo v0.0.0)" && \
      revision="$(git rev-parse --short HEAD)" && \
      DEVHOST_BUILD_VERSION="999.0.0-dev--${base#v}+$revision" \
      DEVHOST_BUILD_SOURCE_DIRECTORY="{{ justfile_directory() }}" \
      cargo build --manifest-path apps/devhost/rust/Cargo.toml --release --locked --bin devhost
    bun run ./apps/devhost/scripts/devBootstrap.ts
```

Note: `just rust build-release` (`apps/devhost/scripts/buildRustRelease.ts`) intentionally overwrites `DEVHOST_BUILD_VERSION` with `metadata.json` and clears `DEVHOST_BUILD_SOURCE_DIRECTORY` so production release binaries never carry checkout stamps. `dev-bootstrap` therefore invokes `cargo build --release --locked --bin devhost` directly after `just devhost build-devtools-bundle`.

Update `apps/devhost/scripts/devBootstrap.ts` line 58 default binary path from `../bin/devhost` to `../rust/target/release/devhost` (preserving the same `--version` probe and `dotfiles tool dev use devhost` registration contract).

### 3. `apps/devhost/justfile` and root `cli` / `run-ai` / `run`

Once cutover is approved:

- Point `apps/devhost/justfile` `compile` at `just rust build-release` (copying/hardlinking to `apps/devhost/bin/devhost` if callers expect that path) and `build-release-artifacts` at `just rust build-release-artifacts`.
- Point root `cli`, `run-ai`, and `run` at the Rust source entrypoint (`just rust run`, `just rust run-ai`).

### 4. Public docs & contributor docs to update in the cutover commit

- `apps/devhost/RELEASE.md`: promote the Rust candidate section to the active Release section and retain the Go rollback runbook for at least one release cycle.
- `packages/docs/src/content/docs/development/building.md`: make `just rust build-release` / `just rust run` the primary build instructions and remove the "experimental port" framing.
- `packages/docs/src/content/docs/development/release-pipeline.md`: update the "Binaries" section to describe the Rust matrix, Zig/musl packaging, `THIRD_PARTY_LICENSES.txt`, and `SHA256SUMS`.
- `packages/docs/src/content/docs/start/install.md`: note `SHA256SUMS` verification alongside the existing five-archive download command (archive names and install path remain unchanged).
- `skills/devhost/SKILL.md`: remove "experimental Rust CLI" qualifiers once Rust is the sole shipped binary.
- `AGENTS.md` and `apps/devhost/AGENTS.md`: update build/release entrypoint references.
- `apps/devhost/README.md`: no new sections required; verify install URLs and feature claims remain accurate.

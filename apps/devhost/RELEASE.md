---
created_on: 2026-04-15 13:04
last_modified: 2026-11-25 13:37
status: current
---

# `apps/devhost` binary release runbook

## Target

- Workflow: `.github/workflows/publish.yml`
- Release trigger: push a Git tag matching `v*`

## Preconditions

- Preferred release path: push a Git tag such as `v0.0.21` and let GitHub Actions build and verify the release binaries.
- Run local preflight from the repository root.
- `apps/devhost/metadata.json` version (and `apps/devhost/Cargo.toml` package version) must already match the tag version after stripping the leading `v`.
- GitHub Actions must be enabled for the repository.
- GitHub Releases must be enabled, because the workflow uploads versioned binary archives to the matching tag release.
- Historical Go reference: the final Go release (`v0.0.20`) is archived at the `golang` Git tag.

### Required local preflight

```sh
bun install --frozen-lockfile
just ui install-browser
just check
just devhost coverage
just devhost build-release
```

The preflight is not optional. The publish workflow repeats `just check` and `just devhost coverage` (90% first-party line and function coverage) before packaging and attaching binaries to the GitHub Release.

Native media and headed-browser tests require FFmpeg (including `ffprobe`), unzip, and Xvfb on Linux. The hosted release runner installs these tools alongside pinned `caddy`, `chisel`, and `cargo-llvm-cov` before verification.

## Local standalone executable

To build an optimized native executable for the current platform:

```sh
just devhost build-release
./apps/devhost/target/release/devhost --version
```

This refreshes production browser assets under `apps/devhost/dist/devtools/` and `apps/devhost/dist/statuspage/` and runs a locked Cargo release build (`opt-level = 3`, thin LTO, one codegen unit, stripped debug info, unwinding preserved, checkout/Cargo paths remapped) embedding the `apps/devhost/metadata.json` version into `devhost --version`. A GitHub tag build rejects a mismatched tag. The generated binary is the same runtime that ships in the release archives.

To also copy the release binary to `./apps/devhost/bin/devhost` (which `.envrc` and demo scripts read), run `just devhost compile`.

To use a local development build through a configured dotfiles project, run from the repository root:

```sh
just dev-bootstrap
```

This builds the current checkout (`cargo build --manifest-path apps/devhost/Cargo.toml --release --locked --bin devhost` with checkout and `999.0.0-dev--<release>+<short git SHA>` stamps) and registers a protected development copy with dotfiles, preserving the managed release payload. See [Use a protected development build](../../packages/docs/src/content/docs/development/building.md#use-a-protected-development-build) for prerequisites, selecting a different dotfiles project, and returning to managed releases. Plain `just devhost build-release` and tagged release builds omit the checkout stamp and retain the metadata version.

## Release packaging and cross-platform validation

Pass `--target <installed Rust triple>` to `just devhost build-release` to select another target. `--cross` selects `cargo zigbuild` and requires `cargo-zigbuild`, Zig, and the target's platform prerequisites. Cargo's configured target directory determines the output location. A packaged release binary uses embedded assets and requires no source checkout.

### Release archives

```sh
just devhost build-release-artifacts --targets=linux-x64,linux-x64-musl
```

Omit `--targets` for all five archive targets:

- `devhost-v<version>-darwin-arm64.tar.gz`
- `devhost-v<version>-linux-x64.tar.gz`
- `devhost-v<version>-linux-arm64.tar.gz`
- `devhost-v<version>-linux-x64-musl.tar.gz`
- `devhost-v<version>-linux-arm64-musl.tar.gz`

Build `darwin-arm64` on a native macOS host with Xcode command-line tools; Linux targets require installed Rust targets, Zig, and `cargo-zigbuild`. GNU builds pin the glibc 2.28 ABI through the Zig target suffix. musl archives must have no ELF interpreter or dynamic dependencies. macOS inspection verifies arm64 Mach-O, system libraries, a minimum deployment target no newer than macOS 11, and the linker's ad-hoc signature.

Output is a new directory under `apps/devhost/dist/rust-candidates/`, or the new directory passed with `--output`. An existing output directory is rejected. A failed build publishes no partial directory. Each archive contains `devhost-v<version>-<platform>/devhost`, `README.md`, `LICENSE`, and `THIRD_PARTY_LICENSES.txt` for Cargo-reported compiled packages, including Git, vendored, and build-time dependencies. Missing license texts fail packaging. Narrowly pinned license overrides are documented in `apps/devhost/licenses/README.md`.

`SHA256SUMS` covers all requested archives. `provenance.json` records the Git revision, source-file digest and dirty state, toolchain, binary/archive hashes, actual executable format and dependency requirements, and matching-host acceptance results. Extraction checks compare executable bytes, permissions, and layout. On a matching native host the extracted binary must report the metadata version, display help, load a manifest, serve HTTPS and embedded browser assets with an isolated fixture CA, replace its session through `restart`, and stop cleanly without changing system trust.

Dispatch the `CI` workflow with `candidates=true` to build and verify all five unpublished archives on hosted Linux x64, Linux ARM64, and macOS ARM64.

## Release

### 1. Update the package version

- Set `apps/devhost/metadata.json` `version` (and `apps/devhost/Cargo.toml` `version`) to the release version.
- Keep the tag format `v<version>`. Example: package version `0.0.22` pairs with Git tag `v0.0.22`.

### 2. Create and push the release tag

```sh
git tag "v0.0.22"
git push origin "v0.0.22"
```

Replace `0.0.22` with the real release version.

### 3. Let GitHub Actions build and publish the release assets

The `Publish release binaries` workflow does the following:

1. **`verify` (`ubuntu-24.04`)**: checks out the tag, installs Bun, Just, the pinned Rust toolchain from `apps/devhost/rust-toolchain.toml`, pinned Caddy/Chisel release binaries, `cargo-llvm-cov`, Playwright Chromium, FFmpeg, unzip, and Xvfb, verifies `apps/devhost/metadata.json` matches the tag version, and runs `just check` and `just devhost coverage`.
2. **`package` (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`)**: builds and verifies all five release archives through `just devhost build-release-artifacts` (glibc 2.28 GNU, static musl, macOS Mach-O checks, `THIRD_PARTY_LICENSES.txt`, `SHA256SUMS`, provenance, and matching-host runtime smoke).
3. **`publish` (`ubuntu-24.04`)**: downloads all five archives, merges and checks `SHA256SUMS`, verifies every archive's exact four-file layout, creates the GitHub Release, and uploads the five archives and `SHA256SUMS`.
4. **`docs`**: builds the documentation site from the tag and deploys it to GitHub Pages through `.github/workflows/docs.yml`.

The documentation site is deployed only here, so it describes the released version. The `github-pages` environment must allow deployments from `v*` tags.

## Verify the release

### 4. Verify the workflow result

- The `Publish release binaries` GitHub Actions run for the tag must succeed (`verify`, all three `package` jobs, `publish`, and `docs`).

### 5. Post-release probes

```sh
gh release view v0.0.22 --json assets
```

Replace `0.0.22` with the released version:

1. Confirm all five `.tar.gz` archives (`darwin-arm64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`) and `SHA256SUMS` exist.
2. Download the host archive and `SHA256SUMS`, verify with `sha256sum -c --ignore-missing SHA256SUMS` on Linux (or `shasum -a 256 --check --ignore-missing SHA256SUMS` on macOS), and confirm the archive contains `devhost`, `README.md`, `LICENSE`, and `THIRD_PARTY_LICENSES.txt`.
3. Run the extracted executable in an isolated `DEVHOST_CONFIG_DIR` and `DEVHOST_STATE_DIR` (ephemeral Caddy ports) to verify `--version`, `--help`, `caddy start`, `start --detach`, HTTPS routing and `/__devhost__/config.json` + `/__devhost__/inject.js`, `restart`, `stop`, and `caddy stop`.
4. Confirm GitHub Pages serves the released version's documentation.

The repository also has a release named `Demo media` on the tag `media`. It holds the documentation site's guide videos, is not a devhost version, and is never the latest release; leave it out of version checks. `docs/internal/references/demo-recording.md` describes it.

### Operator actions and required permissions

- **Tagging and GitHub Release publication**: requires Git push access and GitHub Releases write permission (`gh auth status`).
- **System binary installation (`/usr/local/bin/devhost`)**: requires `sudo` (or write access to a user-owned `PATH` directory).
- **Linux low ports (`devhost caddy privileged-ports`)**: requires `sudo` (`setcap cap_net_bind_service=+ep`) whenever the managed Caddy binary is replaced.
- **System CA trust (`devhost caddy trust` / `trust-remote`)**: requires an interactive terminal and local admin/keychain authorization; never run implicitly by automation.
- **Protected development override (`dotfiles tool dev use` / `off`)**: requires write access to the selected dotfiles project and its development store; no `sudo` is required.

## Stop immediately if

- the tag does not start with `v`
- the tag version and `apps/devhost/metadata.json` version do not match
- `just check` or `just devhost coverage` fails
- `just devhost build-release-artifacts` fails
- the publish workflow fails
- GitHub Release state does not match the tag you pushed

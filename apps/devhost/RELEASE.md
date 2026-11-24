---
created_on: 2026-04-15 13:04
last_modified: 2026-11-23 21:36
status: current
---

# `apps/devhost` binary release runbook

## Target

- Workflow: `.github/workflows/publish.yml`
- Release trigger: push a Git tag matching `v*`

## Preconditions

- Preferred release path: push a Git tag such as `v0.0.2` and let GitHub Actions build the release binaries.
- Run local preflight from the repository root.
- `apps/devhost/metadata.json` version must already match the tag version after stripping the leading `v`.
- GitHub Actions must be enabled for the repository.
- GitHub Releases must be enabled, because the workflow uploads versioned binary archives to the matching tag release.

### Required local preflight

```sh
bun install --frozen-lockfile
just ui install-browser
just check
just devhost build-release-artifacts
```

The preflight is not optional. The publish workflow repeats the same validations before attaching binaries to the GitHub Release.

Native media and headed-browser tests require FFmpeg (including `ffprobe`), unzip, and Xvfb on Linux. The hosted release runner installs these tools before `just check`, matching hosted CI.

`just check` includes the Go logging-boundary analyzer (`go tool logpolicy ./...`) through `just devhost lint`. Resolve its findings through `internal/cliout` before release; `just devhost lint-logging` runs that check alone.

## Local standalone executable

To build a native executable for the current platform:

```sh
just devhost compile
./apps/devhost/bin/devhost --version
```

This first refreshes the embedded injected devtools assets under `internal/devtools/dist/`, then runs `go build` with linker flags that embed the current `apps/devhost/metadata.json` version into `devhost --version`.
The asset build explicitly selects production mode and embeds the static entry, lazy terminal chunks, separate font subsets, terminal stylesheet, and precompressed gzip representations. Obsolete generated assets are removed from production builds. Instance configuration is served separately and is not baked into the static entry.
The generated binary is the same Go runtime that ships in the release archives.

To use a local development build through a configured dotfiles project, run from the repository root:

```sh
just dev-bootstrap
```

This builds the current checkout and registers a protected development copy with dotfiles, preserving the managed release payload. See [Use a protected development build](../../packages/docs/src/content/docs/development/building.md#use-a-protected-development-build) for prerequisites, selecting a different dotfiles project, and returning to managed releases. The build reports `999.0.0-dev--<release>+<short git SHA>` (`<release>` is the nearest reachable `vX.Y.Z` tag without its `v`, or `0.0.0`); plain `just devhost compile` and release builds retain the metadata version.

## Optimized Rust candidate

From a prepared checkout, build a separate native candidate:

```sh
just rust build-release
./apps/devhost/rust/target/release/devhost --version
```

This refreshes production browser assets and runs a locked Cargo release build. The authoritative version is `apps/devhost/metadata.json`; a GitHub tag build rejects a different tag. The release profile uses optimization level 3, thin LTO, one codegen unit, and stripped debug information. It preserves unwinding for lifecycle cleanup and remaps checkout and Cargo source paths in diagnostics. Normal development builds preserve their debug and incremental defaults.

Pass `--target <installed Rust triple>` to select another target. `--cross` selects `cargo zigbuild` and requires cargo-zigbuild, Zig, and the target's platform prerequisites. Cargo's configured target directory determines the output location. A packaged candidate uses embedded assets and requires no source checkout.

This command leaves the Go release publisher and the protected Go development override selected. Rust candidates require their separate parity, packaging, and native acceptance before production cutover.

### Candidate archives

```sh
just rust build-release-artifacts --targets=linux-x64,linux-x64-musl
```

Omit `--targets` for all five existing archive targets. Build `darwin-arm64` on a native macOS host with Xcode command-line tools; Linux targets require installed Rust targets, Zig and cargo-zigbuild. GNU builds pin the glibc 2.28 ABI through the Zig target suffix. musl archives must have no ELF interpreter or dynamic dependencies. macOS inspection verifies arm64 Mach-O, system libraries, a minimum deployment target no newer than macOS 11, and the linker's ad-hoc signature. The existing download-and-`install` distribution contract does not promise Developer ID signing or notarization; this candidate command adds neither a new signing policy nor a quarantine bypass.

Output is a new directory under `apps/devhost/dist/rust-candidates/`, or the new directory passed with `--output`. An existing output is rejected. A failed build publishes no partial candidate directory. Each archive preserves `devhost-v<version>-<platform>/devhost`, `README.md` and `LICENSE`, and adds `THIRD_PARTY_LICENSES.txt` for Cargo-reported compiled packages, including Git, vendored and build-time dependencies. Missing license texts fail packaging. The narrowly pinned license overrides are documented in `rust/licenses/README.md`.

`SHA256SUMS` covers all requested archives. `provenance.json` records the Git revision, source-file digest and dirty state, toolchain, binary/archive hashes, actual executable format and dependency requirements, and matching-host acceptance results. A dirty candidate is diagnostic evidence; final cutover must use a recorded clean revision. Extraction checks compare executable bytes, permissions and layout. On a matching native host the extracted binary must report the metadata version, display help, load a manifest, serve HTTPS and embedded browser assets with an isolated fixture CA, replace its session through `restart-all`, and stop cleanly. This does not modify the system trust store. Broader native acceptance still covers platform trust behavior; a cross-built archive is not native runtime evidence.

Dispatch the `CI` workflow on the candidate branch with `rustCandidates=true` to build all five archives on hosted Linux x64, Linux ARM64 and macOS ARM64. The jobs cache dependencies and build tools, exercise the extracted native executables, and retain unpublished archives and receipts for seven days. The normal repository check remains required; these jobs neither tag nor publish a release.

## Local release artifacts

To build the full set of versioned release tarballs locally:

```sh
just devhost build-release-artifacts
```

That writes these archives to `apps/devhost/dist/release/`:

- `devhost-v0.0.2-darwin-arm64.tar.gz`
- `devhost-v0.0.2-linux-x64.tar.gz`
- `devhost-v0.0.2-linux-arm64.tar.gz`
- `devhost-v0.0.2-linux-x64-musl.tar.gz`
- `devhost-v0.0.2-linux-arm64-musl.tar.gz`

Replace `0.0.2` with the real package version.

Each archive holds the `devhost` binary, `README.md`, and the repository `LICENSE`. The build stops before compiling when one of the two documents is missing.

The release builder cross-compiles with `CGO_ENABLED=0`. The `linux-*-musl` archives therefore ship the same static Linux binaries as the matching non-musl Linux targets, packaged under distinct archive names for download clarity.
Each archived `devhost` binary also reports that same metadata version through `devhost --version`.

## Release

### 1. Update the package version

- Set `apps/devhost/metadata.json` `version` to the release version.
- Keep the tag format `v<version>`. Example: package version `0.0.2` pairs with Git tag `v0.0.2`.

### 2. Create and push the release tag

```sh
git tag "v0.0.2"
git push origin "v0.0.2"
```

Replace `0.0.2` with the real release version.

### 3. Let GitHub Actions build and publish the release assets

The `Publish release binaries` workflow does the following:

- checks out the full repository history
- installs the Bun version pinned in `package.json` and Go from `apps/devhost/go.mod`
- derives `RELEASE_VERSION` from the tag name
- verifies `apps/devhost/metadata.json` matches the tag version
- installs dependencies with `bun install --frozen-lockfile`
- installs Playwright Chromium with `just ui install-browser`
- installs FFmpeg, unzip, and Xvfb for native media and headed-browser tests
- runs `just check`
- builds versioned release archives with `just devhost build-release-artifacts`
- creates a GitHub Release for the tag if one does not already exist
- uploads `apps/devhost/dist/release/*.tar.gz` to that GitHub Release with clobber enabled for reruns
- after that job succeeds, builds the documentation site from the tag and deploys it to GitHub Pages through `.github/workflows/docs.yml`

The documentation site is deployed only here, so it describes the released version. The `github-pages` environment must allow deployments from `v*` tags.

## Verify the release

### 4. Verify the workflow result

- The `Publish release binaries` GitHub Actions run for the tag must succeed.
- The `Verify package`, `Build release artifacts`, `Create GitHub Release`, and `Upload GitHub Release assets` steps must succeed.
- The `docs` job must succeed, and the documentation site must show the released documentation.

### 5. Verify npm and GitHub release state

```sh
gh release view v0.0.2 --json assets
```

Replace `0.0.2` with the released version. The GitHub release assets must include the five expected `.tar.gz` archives for the matching tag.

The repository also has a release named `Demo media` on the tag `media`. It holds the documentation site's guide videos, is not a devhost version, and is never the latest release; leave it out of version checks. `docs/internal/references/demo-recording.md` describes it.

## Stop immediately if

- the tag does not start with `v`
- the tag version and `apps/devhost/metadata.json` version do not match
- `just check` fails
- `just devhost build-release-artifacts` fails
- the publish workflow fails
- GitHub Release state does not match the tag you pushed

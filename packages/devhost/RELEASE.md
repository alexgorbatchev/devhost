# `packages/devhost` binary release runbook

## Target

- Package name: `@alexgorbatchev/devhost`
- Workflow: `.github/workflows/publish.yml`
- Release trigger: push a Git tag matching `v*`

## Preconditions

- Preferred release path: push a Git tag such as `v0.0.2` and let GitHub Actions build the release binaries.
- Run local preflight from the repository root.
- `packages/devhost/package.json` version must already match the tag version after stripping the leading `v`.
- GitHub Actions must be enabled for the repository.
- GitHub Releases must be enabled, because the workflow uploads versioned binary archives to the matching tag release.

### Required local preflight

```sh
bun install --frozen-lockfile
bun run install-browser
bun run check
bun run --cwd packages/devhost build:release-artifacts
```

The preflight is not optional. The publish workflow repeats the same validations before attaching binaries to the GitHub Release.

## Local standalone executable

To build a native executable for the current platform:

```sh
bun run --cwd packages/devhost compile
./packages/devhost/dist/devhost --help
```

This first refreshes the embedded injected devtools bundle, then runs `go build -trimpath -o ./dist/devhost ./cmd/devhost`.
The generated binary is the same Go runtime that ships in the release archives.

## Local release artifacts

To build the full set of versioned release tarballs locally:

```sh
bun run --cwd packages/devhost build:release-artifacts
```

That writes these archives to `packages/devhost/dist/release/`:

- `devhost-v0.0.2-darwin-arm64.tar.gz`
- `devhost-v0.0.2-linux-x64.tar.gz`
- `devhost-v0.0.2-linux-arm64.tar.gz`
- `devhost-v0.0.2-linux-x64-musl.tar.gz`
- `devhost-v0.0.2-linux-arm64-musl.tar.gz`

Replace `0.0.2` with the real package version.

The release builder cross-compiles with `CGO_ENABLED=0`. The `linux-*-musl` archives therefore ship the same static Linux binaries as the matching non-musl Linux targets, packaged under distinct archive names for download clarity.

## Release

### 1. Update the package version

- Set `packages/devhost/package.json` `version` to the release version.
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
- installs Bun `1.3.11` and Go from `packages/devhost/go.mod`
- derives `RELEASE_VERSION` from the tag name
- verifies `packages/devhost/package.json` matches the tag version
- installs dependencies with `bun install --frozen-lockfile`
- installs Playwright Chromium with `bun run install-browser`
- runs `bun run check`
- builds versioned release archives with `bun run --cwd packages/devhost build:release-artifacts`
- creates a GitHub Release for the tag if one does not already exist
- uploads `packages/devhost/dist/release/*.tar.gz` to that GitHub Release with clobber enabled for reruns

## Verify the release

### 4. Verify the workflow result

- The `Publish release binaries` GitHub Actions run for the tag must succeed.
- The `Verify package`, `Build release artifacts`, `Create GitHub Release`, and `Upload GitHub Release assets` steps must succeed.

### 5. Verify npm and GitHub release state

```sh
gh release view v0.0.2 --json assets
```

Replace `0.0.2` with the released version. The GitHub release assets must include the five expected `.tar.gz` archives for the matching tag.

## Stop immediately if

- the tag does not start with `v`
- the tag version and `packages/devhost/package.json` version do not match
- `bun run check` fails
- `bun run --cwd packages/devhost build:release-artifacts` fails
- the publish workflow fails
- GitHub Release state does not match the tag you pushed

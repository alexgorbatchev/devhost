# `packages/devhost` npm release runbook

## Target

- Package name: `@alexgorbatchev/devhost`
- Registry: `https://registry.npmjs.org/`
- Workflow: `.github/workflows/publish.yml`
- Release trigger: push a Git tag matching `v*`

## Preconditions

- Preferred release path: push a Git tag such as `v0.0.2`. Do not manually run `npm publish` unless the release procedure itself is being intentionally changed.
- Run local preflight from the repository root.
- `packages/devhost/package.json` version must already match the tag version after stripping the leading `v`.
- GitHub Actions must be enabled for the repository.
- npm trusted publishing must remain configured for this repository, because the workflow publishes with `npm publish --provenance --access public`.
- GitHub Releases must be enabled, because the workflow uploads versioned binary archives to the matching tag release.

### Required local preflight

```sh
bun install --frozen-lockfile
bun run install-browser
bun run check
(
  cd packages/devhost
  npm pack --dry-run
)
bun run --cwd packages/devhost build:release-artifacts
```

The preflight is not optional. The publish workflow repeats the same validations before `npm publish`.

## Local standalone executable

To build a single-file executable for the current platform without changing the npm release flow:

```sh
bun run --cwd packages/devhost compile
./packages/devhost/dist/devhost --help
```

This first refreshes the embedded injected devtools bundle, then wraps Bun's standalone executable support via `bun build --compile --minify ./bin/devhost.ts --outfile ./dist/devhost`.
The generated binary is a local packaging artifact. The release workflow publishes npm separately and uploads versioned `.tar.gz` archives to the matching GitHub Release.

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

### 3. Let GitHub Actions publish

The `Publish package and binaries` workflow does the following:

- checks out the full repository history
- installs Bun `1.3.11` and Node.js `24`
- derives `RELEASE_VERSION` from the tag name
- verifies `packages/devhost/package.json` matches the tag version
- installs dependencies with `bun install --frozen-lockfile`
- installs Playwright Chromium with `bun run install-browser`
- runs `bun run check`
- runs `npm pack --dry-run` from `packages/devhost`
- builds versioned release archives with `bun run --cwd packages/devhost build:release-artifacts`
- checks whether `@alexgorbatchev/devhost@<version>` already exists on npm
- runs `npm publish --provenance --access public` from `packages/devhost` when the version is new
- creates a GitHub Release for the tag if one does not already exist
- uploads `packages/devhost/dist/release/*.tar.gz` to that GitHub Release with clobber enabled for reruns

If the package version already exists on npm, the workflow skips `npm publish` instead of overwriting the release.

## Verify the release

### 4. Verify the workflow result

- The `Publish package and binaries` GitHub Actions run for the tag must succeed.
- The `Verify package`, `Build release artifacts`, `Create GitHub Release`, and `Upload GitHub Release assets` steps must succeed. `Publish package` may be intentionally skipped when the npm version already exists.

### 5. Verify npm and GitHub release state

```sh
npm view @alexgorbatchev/devhost@0.0.2 version
gh release view v0.0.2 --json assets
```

Replace `0.0.2` with the released version. The npm command must return the version, and the GitHub release assets must include the five expected `.tar.gz` archives for the matching tag.

## Stop immediately if

- the tag does not start with `v`
- the tag version and `packages/devhost/package.json` version do not match
- `bun run check` fails
- `npm pack --dry-run` fails
- `bun run --cwd packages/devhost build:release-artifacts` fails
- the publish workflow fails
- npm or GitHub Release state does not match the tag you pushed

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

### Required local preflight

```sh
bun install --frozen-lockfile
bun run --cwd packages/devhost storybook:install-browser
bun run check
(
  cd packages/devhost
  npm pack --dry-run
)
```

The preflight is not optional. The publish workflow repeats the same validations before `npm publish`.

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

The `Publish to npm` workflow does the following:

- checks out the full repository history
- installs Bun `1.3.11` and Node.js `24`
- derives `RELEASE_VERSION` from the tag name
- verifies `packages/devhost/package.json` matches the tag version
- installs dependencies with `bun install --frozen-lockfile`
- installs Playwright Chromium with `bun run --cwd packages/devhost storybook:install-browser`
- runs `bun run check`
- runs `npm pack --dry-run` from `packages/devhost`
- checks whether `@alexgorbatchev/devhost@<version>` already exists on npm
- runs `npm publish --provenance --access public` from `packages/devhost` when the version is new
- creates a GitHub Release for the tag if one does not already exist

If the package version already exists on npm, the workflow skips `npm publish` instead of overwriting the release.

## Verify the release

### 4. Verify the workflow result

- The `Publish to npm` GitHub Actions run for the tag must succeed.
- The `Verify package`, `Publish package`, and `Create GitHub Release` steps must either succeed or be intentionally skipped because the version already exists on npm.

### 5. Verify npm and GitHub release state

```sh
npm view @alexgorbatchev/devhost@0.0.2 version
gh release view v0.0.2
```

Replace `0.0.2` with the released version. The npm command must return the version, and the GitHub release must exist for the matching tag.

## Stop immediately if

- the tag does not start with `v`
- the tag version and `packages/devhost/package.json` version do not match
- `bun run check` fails
- `npm pack --dry-run` fails
- the publish workflow fails
- npm or GitHub Release state does not match the tag you pushed

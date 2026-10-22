---
created_on: 2026-06-03 12:45
last_modified: 2026-10-21 16:48
status: current
---

# On-demand asset development loop

This reference describes how contributors load the injected UI from a devhost source checkout without rebuilding the Go binary for every UI edit.

## Configuration

The source checkout comes from `DEVHOST_DEV_SOURCE_DIR` when it is set, and otherwise from the checkout a development build records. The stack resolves relative variable paths against the manifest directory. `NewDevSourceCheckout` requires `packages/devhost-ui/src/devtools/` and `apps/devhost/justfile`; an invalid variable fails startup instead of silently selecting embedded assets. The contributor setting has no CLI option.

Development builds record their checkout root in `internal/devbuild.sourceDirectory` through `-ldflags -X`: root `just dev-bootstrap` passes `build-source-directory` to the app's `compile` recipe, and `scripts/runFromSource.sh` stamps the repository root. Plain `just devhost compile` and release artifacts leave it empty. The bootstrapped binary runs every project's stack, so a recorded checkout that has moved or been deleted produces a startup warning and embedded assets instead of a failure.

The same checkout is the `devhost` chat target: `/__devhost__/config.json` reports its root as `devhostSourceRootPath`, and chat started with that target runs in it (see `packages/docs/src/content/docs/architecture/chat.md`).

All source paths, output paths, and build commands come from that checkout. Generated assets live under `apps/devhost/internal/devtools/dist/`. The build uses `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` with `DEVHOST_DEVTOOLS_DEVELOPMENT=1` and the control server's cancellation context.

## Request and rebuild behavior

Requests for `/__devhost__/inject.js` compare the compiled entry's modification time against files under `packages/devhost-ui/src/devtools/`. The walk skips hidden paths and `*.test.ts`, `*.test.tsx`, `*.spec.ts`, and `*.spec.tsx`. A missing or older output triggers the build. A server-local mutex serializes checks and builds so concurrent requests cannot start overlapping compilers in that server.

The Redux registration, monitor script, and monitor stylesheet also participate in this check through `serveReduxAsset`, since registration can load before injection. Hashed JavaScript chunks and WOFF2 fonts under `/__devhost__/assets/` are read from the selected asset directory. The development build retains old hashed chunks for tabs that still use them. The UI stylesheet is included by the browser bundle; there is no terminal stylesheet endpoint.

The source loop reads assets from disk. It does not fall back to embedded code when the configured checkout fails: an entry build/read failure returns executable JavaScript displaying the compilation error; a Redux asset failure returns HTTP 503; a missing hashed asset returns HTTP 404. A successful compiler that writes no requested output is reported as a compilation failure and retried on the next request.

Without a configured source checkout, `assets.go` embeds `dist/` with `//go:embed`. Production entry assets use content-versioned responses, and hashed chunks/fonts use immutable caching. Source entry responses and instance configuration use `no-store`.

There are no filesystem watchers or automatic browser reloads. Refresh the page to request a rebuild after editing UI source.

## Validation

- `internal/devtools/dev_source_test.go` exercises the real `just` invocation with a fixture checkout: missing/stale output, fresh output, compilation errors, missing output after a successful build, and invalid checkouts.
- `internal/devtools/redux_assets_test.go` covers source rebuild failure and recovery for Redux assets.
- `internal/services/dev_source_test.go` covers environment-path resolution, invalid startup configuration, the recorded checkout, and its precedence and missing-checkout warning.
- `cmd/devhost/shim_test.go` builds a fixture through the real shim and checks that it records the repository root in the real `internal/devbuild` variable.
- `internal/devtools/chat_target_test.go` covers the `devhost` chat target and `devhostSourceRootPath`.
- Run `just check` for the repository gates or `just devhost test` for Go tests.

For a manual check, run root `just run`, edit a UI source file, and refresh the routed page. The root development stack runs through the source shim, which records this checkout.

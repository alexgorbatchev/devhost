---
created_on: 2026-06-03 12:45
last_modified: 2026-11-24 19:55
status: current
---

# On-demand asset development loop

This reference describes how contributors load the injected UI from a devhost source checkout without rebuilding the Rust binary for every UI edit.

## Configuration

The source checkout comes from `DEVHOST_DEV_SOURCE_DIR` when it is set, and otherwise from the checkout a development build records. The stack resolves relative variable paths against the manifest directory. `DevSourceCheckout::new` requires `packages/devhost-ui/src/devtools/` and `apps/devhost/justfile`; an invalid variable fails startup instead of silently selecting embedded assets. The contributor setting has no CLI option.

Development builds record their checkout root through compile-time `DEVHOST_BUILD_SOURCE_DIRECTORY`: root `just dev-bootstrap`, `just devhost run`, and `just devhost run-ai` set it. Plain `just devhost build-release`, `just devhost compile`, and release artifacts leave it empty. The bootstrapped binary runs every project's stack, so a recorded checkout that has moved or been deleted produces a startup warning and embedded assets instead of a failure.

The same checkout is the `devhost` chat target: `/__devhost__/config.json` reports its root as `devhostSourceRootPath`, and chat started with that target runs in it.

All source paths, output paths, and build commands come from that checkout. Generated assets live under `apps/devhost/dist/devtools/`. The build uses `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` with `DEVHOST_DEVTOOLS_DEVELOPMENT=1`.

## Request and rebuild behavior

Requests for `/__devhost__/inject.js` compare the compiled entry's modification time against files under `packages/devhost-ui/src/devtools/`. The walk skips hidden paths and `*.test.ts`, `*.test.tsx`, `*.spec.ts`, and `*.spec.tsx`. A missing or older output triggers the build. A server-local mutex serializes checks and builds so concurrent requests cannot start overlapping compilers in that server.

The Redux registration, monitor script, and monitor stylesheet also participate in this check, since registration can load before injection. Hashed JavaScript chunks and WOFF2 fonts under `/__devhost__/assets/` are read from the selected asset directory. The development build retains old hashed chunks for tabs that still use them. The UI stylesheet is included by the browser bundle; there is no terminal stylesheet endpoint.

The source loop reads assets from disk. It does not fall back to embedded code when the configured checkout fails: an entry build/read failure returns executable JavaScript displaying the compilation error; a Redux asset failure returns HTTP 503; a missing hashed asset returns HTTP 404. A successful compiler that writes no requested output is reported as a compilation failure and retried on the next request.

Without a configured source checkout, `apps/devhost/src/devtools/assets.rs` embeds `apps/devhost/dist/devtools/` with `include_dir!`. Production entry assets use content-versioned responses, and hashed chunks/fonts use immutable caching. Source entry responses and instance configuration use `no-store`.

There are no filesystem watchers or automatic browser reloads. Refresh the page to request a rebuild after editing UI source.

## Validation

- `apps/devhost/tests/devtools_assets_injection.rs` and `apps/devhost/tests/stack_commands/documents/source.rs` exercise the real `just` invocation with fixture checkouts: missing/stale output, fresh output, compilation errors, missing output after a successful build, invalid checkouts, and stamped fallback behavior.
- Run `just check` for the repository gates or `just devhost test` for Rust tests.

For a manual check, run root `just run`, edit a UI source file, and refresh the routed page. The root development stack runs through `just devhost run`, which records this checkout.

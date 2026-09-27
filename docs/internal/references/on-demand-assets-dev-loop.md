---
created_on: 2026-06-03 12:45
last_modified: 2026-09-27 09:22
status: current
---

# On-Demand Dynamic Asset Dev Loop

This is the maintained internal reference for the implemented on-demand dynamic asset dev loop contract.
It records the current architecture for dynamic, on-demand frontend bundle compilation and dynamic stylesheet serving used by `devhost` during local development.

## Implementation Record

The implementation landed through these changes:

- [feat(devtools): implement on-demand dynamic asset dev loop]
- [chore(root): add DEVHOST_DEV_ASSETS_DIR to dev script]
- [feat(devtools): log notice when on-demand asset loop is active]

## 1. Objective and non-goals

### Objective

This design eliminates binary rebuilds and process restarts for developers making changes to the devtools UI workspace (`packages/devhost-ui`). It enables:

1. **On-Demand Disk Asset Serving:** The Go `devhost` daemon serves frontend files (`devtools.js` and `xterm.css`) dynamically on-demand from a configured local directory when requested by the browser overlay.
2. **On-Demand Asset Rebuilding (Manual-Trigger Browser Refresh):** When the browser requests `/__devhost__/inject.js`, the Go backend compares the modification times of the source files in `packages/devhost-ui/src/devtools/` of the configured devhost checkout against that checkout's compiled `apps/devhost/internal/devtools/dist/devtools.js`. If any source file is newer (indicating changes were made), the Go server automatically spawns a child process to rebuild the assets (`just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle`), waiting for it to finish successfully before serving the fresh bundle. This completely eliminates manual build terminal commands and file watchers—recompilation is elegantly triggered only when the developer manually refreshes the browser page.

### Non-goals

- **No in-Go file watchers:** The asset loader will perform simple, on-demand reads from disk whenever a browser requests them. It will not run file watchers to push updates or hot-reload assets.
- **No browser auto-reloads:** Auto-refreshing the browser tabs is outside the scope of this backend feature.

---

## 2. Current codebase baseline

1. **Devtools Asset Embedding:**
   - Static files `devtools.js` and `xterm.css` are embedded in `apps/devhost/internal/devtools/assets.go` using standard Go `//go:embed`.
   - The HTTP server in `apps/devhost/internal/devtools/server.go` loads these strings on initialization via `readBundledDevtoolsScript()` and `readXtermStylesheet()`, serving them directly from memory on requests to `/___devhost___/inject.js` and `/___devhost___/xterm.css`.

---

## 3. Non-negotiable constraints

- **Fail Fast On A Bad Checkout:** `NewDevSourceCheckout` requires the checkout's `packages/devhost-ui/src/devtools/` directory and `apps/devhost/justfile`; `devhost start` exits with an error naming `DEVHOST_DEV_SOURCE_DIR` otherwise, instead of serving embedded assets on every request.
- **Robust Fallback:** If reading a built asset fails at request time, the server falls back to serving the compile-time embedded assets instead of returning broken pages.
- **Zero Impact on Production:** Serving assets from disk must not change production bundle generation or embedded asset logic. It must be opt-in via a development-only environment variable.
- **Relative Path Resolution:** A relative source checkout path must be resolved relative to the manifest directory (`ManifestDirectoryPath`) before file checks are performed to ensure consistency across execution directories.

---

## 4. Exact architecture choice

- Retrieve the devhost source checkout root strictly from the `DEVHOST_DEV_SOURCE_DIR` environment variable. To keep the public command-line interface clean and free of contributor-only utilities, **no CLI option must be exposed for it**.
- Derive every path from that checkout root (`internal/devtools/dev_source.go`): sources in `packages/devhost-ui/src/devtools/`, served assets in `apps/devhost/internal/devtools/dist/`, and the build recipe in `apps/devhost/justfile`. Nothing is derived from the stack's manifest directory, so the loop works for any manifest, not only one at the devhost repo root.
- Pass the resolved path down to the devtools `ControlServer` setup. On incoming HTTP requests to `/__devhost__/inject.js` or `/__devhost__/xterm.css`, check if a source checkout is configured.
- **On-Demand Compiling Check:** If the source checkout is configured, the server must compare the modification time (`ModTime`) of the checkout's compiled `devtools.js` file against the modification times of all source files recursively inside the checkout's `packages/devhost-ui/src/devtools/` directory.
  - **Walking Exclusion Filter:** The recursive walk must ignore files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, and any files/folders starting with `.`.
  - **Concurrency Serialization Guard:** To prevent parallel compilation processes ("build storms") when multiple requests or page reloads arrive concurrently, Go must synchronize build executions. The server must use a synchronization primitive (such as `sync.Mutex` combined with a state tracker, or a single-flight channel mechanism) so that exactly one compiler process is spawned at any given time. Concurrent incoming requests must block, wait for the active build to complete, and then serve the newly built file.
  - **Subprocess Execution:** Go must spawn `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` as a child process using `exec.CommandContext` with the server's context to ensure subprocess cleanup on server shutdown.
  - **Compilation Failure Handling:** If compilation fails (exit code is non-zero), the Go server must wrap the raw compiler stderr log into a valid executable JavaScript block (e.g., `console.error(...)` or an injected visual error banner injected into the DOM overlay) and return it with the JavaScript content-type. This ensures the browser does not fail with unhandled syntax errors.
  - **Build That Writes No Bundle:** If compilation exits successfully (`0`) but `devtools.js` is still missing, the server logs the problem on `stderr` and serves the same `DEVHOST COMPILATION ERROR` banner as a failed build, naming the missing file. The next request rebuilds again; builds are serialized by the build lock, so this retries once per page load and never overlaps. Rebuilding is never disabled for the rest of the run.
  - Once compilation completes, the server reads the freshly built files and returns them.
  - If no source files are newer than the compiled asset, Go skips compilation entirely and serves the existing on-disk file in under a millisecond.
- If the filesystem reads or compilation checks fail, the server must seamlessly fall back to serving the embedded Go bundle strings to prevent rendering a broken page.

---

## 5. Data model / schema

No persistent databases or schemas are added or altered.

---

## 6. Types and contracts

The option is read purely from the environment (`DEVHOST_DEV_SOURCE_DIR`); no public types change. Internally, `devSourceCheckout` (`internal/devtools/dev_source.go`) holds the source directory, assets directory, and justfile path derived from the checkout root, and builds the rebuild command.

---

## 7. Exact file plan

### Modify

- `apps/devhost/internal/devtools/server.go`
  - Accepts `DevSourceDir` inside config options and builds a `devSourceCheckout` from it (`internal/devtools/dev_source.go`).
  - Performs on-demand filesystem checks and compilations with fallback inside HTTP handlers `handleInjectedScript` and `handleXtermStylesheet`.
- `apps/devhost/internal/services/stack.go`
  - Resolves `DEVHOST_DEV_SOURCE_DIR` to an absolute path with `resolveDevSourceDirectory` (`internal/services/dev_source.go`), relative to the manifest directory, and passes it down to `devtools.StartControlServerOptions`.

---

## 8. Runtime behavior

### Asset Request Resolution

1. On request arrival for `/__devhost__/inject.js` or `/__devhost__/xterm.css`:
2. If `DevSourceDir` is not empty, resolve the requested filename under the checkout's `apps/devhost/internal/devtools/dist/` folder.
3. If requesting `/__devhost__/inject.js`, perform the on-demand compiling check:
   - Walk the checkout's `packages/devhost-ui/src/devtools/` directory recursively.
   - **Exclusion Filter:** Exclude files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, and any files/folders with a leading dot.
   - If any qualifying source file's `ModTime` is newer than `devtools.js`'s `ModTime` (or if `devtools.js` is missing):
     - **Concurrency Check:** If a build is already in progress, wait for the existing build to complete.
     - **Spawn Process:** If no build is in progress, acquire the compilation lock, log a compile start message, and spawn `just --justfile <checkout>/apps/devhost/justfile build-devtools-bundle` using `exec.CommandContext`.
     - Block the request and wait for the process to exit.
     - **On Build Failure:** If the compilation process exits with a non-zero code, log the build stderr, release the lock, and format the error as a valid JavaScript file containing a prominent warning (e.g., `console.error("DEVHOST COMPILATION ERROR:\n" + errorMessage)` and an overlay-injection script) so that the error is visible to the developer without crashing the script engine.
     - **Post-Build Validation:** If the compilation process exits with `0` but `devtools.js` is still missing from the disk, log it on `stderr`, release the lock, and serve the compilation error banner naming the missing file; the next request retries the build.
     - **On Success:** If compilation is successful, release the lock.
4. Read the file content from disk.
5. If successful, write the content with appropriate mime type headers (`application/javascript` or `text/css`).
6. If reading the asset fails (e.g., permission denied), log a warning on `stderr` and serve the embedded resource string in memory.

---

## 9. Validation rules

- **Relative Resolution Context:** A relative `DEVHOST_DEV_SOURCE_DIR` (e.g. `.` as set by root `just dev`) is converted to an absolute path using the active manifest's `ManifestDirectoryPath` as the parent directory, during stack bootstrap.
- **Errors as Warnings:** Disk reading failures, subprocess spawning failures (e.g., missing `just` in `PATH`), or permission errors must never crash or block requests; the server must log a stderr warning and fall back instantly to serve embedded code.

---

## 10. Exact API surface

No new HTTP routes or WS channels are added. The existing routes serve dynamic content:

- `GET /__devhost__/inject.js`: Dynamic asset read or embedded fallback.
- `GET /__devhost__/xterm.css`: Dynamic stylesheet read or embedded fallback.

---

## 11. Implementation order

1. **Config Path Resolution:** Resolve `DEVHOST_DEV_SOURCE_DIR` to an absolute checkout path in `stack.go` and pass it to devtools start options.
2. **Dynamic Asset Handler:** Implement disk checking, on-demand `just` rebuilds, and fallback loading in `server.go`.
3. **E2E verification:** Set `DEVHOST_DEV_SOURCE_DIR` (or run root `just dev`), make changes in `packages/devhost-ui`, refresh the browser, and confirm assets are compiled and reloaded on the fly.

---

## 12. Testing plan

### Automated Unit Tests

- `internal/devtools/dev_source_test.go`: builds a throwaway checkout whose `apps/devhost/justfile` recipe writes a marker bundle and runs the real `just`, covering rebuild of a missing or stale bundle, serving a fresh bundle without rebuilding, the compilation error banner, the checkout `xterm.css`, retrying a build that writes no bundle, and rejecting incomplete checkouts.
- `internal/services/dev_source_test.go`: covers `DEVHOST_DEV_SOURCE_DIR` resolution and the startup error that names the variable.

### Manual Verification

- Run root `just dev`, which sets `DEVHOST_DEV_SOURCE_DIR=.`.
- Edit a TSX UI file in `packages/devhost-ui/src/devtools/components/App.tsx`.
- Reload the browser tab. Confirm that `devhost` immediately compiles the assets and serves the updated UI on the fly without any manual build commands.

---

## 13. Out-of-scope / rejection list

- **No filesystem watchers inside Go:** The backend will not run file watchers to push updates or hot-reload assets.
- **No automatic browser reloading:** Handled by standard user/IDE browser interactions.

---

## 14. Validation Requirements

- Run full repo checks via `just check`.
- Run Go unit tests via `just devhost test`.

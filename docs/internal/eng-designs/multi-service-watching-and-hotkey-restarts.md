---
created_on: Wed Jun 03 2026
last_modified: Wed Jun 03 2026
status: current
---

# Design Document: Multi-Service File Watching & Hotkey-Driven Parallel Restarts

## Table of Contents

- [1. Objective and non-goals](#1-objective-and-non-goals)
- [2. Current codebase baseline](#2-current-codebase-baseline)
- [3. Non-negotiable constraints](#3-non-negotiable-constraints)
- [4. Exact architecture choice](#4-exact-architecture-choice)
- [5. Data model / schema](#5-data-model--schema)
- [6. Types and contracts](#6-types-and-contracts)
- [7. Exact file plan](#7-exact-file-plan)
- [8. Runtime behavior](#8-runtime-behavior)
- [9. Validation rules](#9-validation-rules)
- [10. Exact API surface](#10-exact-api-surface)
- [11. Implementation order](#11-implementation-order)
- [12. Testing plan](#12-testing-plan)
- [13. Out-of-scope / rejection list](#13-out-of-scope--rejection-list)
- [14. Definition of done](#14-definition-of-done)

---

## 1. Objective and non-goals

### Objective

This design aims to eliminate manual, repetitive clicks and context-switching overhead for developers and AI agents managing multiple services. It introduces:

1. **Multi-Service File-Watching (`watch = [...]` in Manifest):** Allow developers to list watch directories/files per service. The Go backend watches these paths and flags services as "dirty" when writes or changes occur.
2. **Prominent UI Restart Indicator:** Style individual service restart buttons prominently (e.g. red highlight / danger theme) inside the devtools status panel UI when the service is dirty.
3. **Hotkey-Driven Multi-Service Restarts (`Alt+Shift+R`):** Register a global configurable keyboard shortcut that:
   - Restarts the dirty service if **exactly one** service is dirty.
   - Restarts all dirty services **respecting manifest dependencies** if multiple services are dirty (sequencing them according to the dependency graph and waiting for health checks).
   - Restarts the **primary service** if no services are dirty.

### Non-goals

- **No Automatic Restarts:** The file watcher will only transition services to the `dirty: true` state; it will not trigger automatic process restarts on file writes, avoiding file-change storm issues.
- **No Git/VCS awareness:** The watcher does not inspect git commits or files ignored by `.gitignore`; it monitors specified files/folders raw.

---

## 2. Current codebase baseline

1. **Service Structs & Manifest Validation:**
   - In `apps/devhost/internal/manifest/types.go`, `ValidatedService` holds configuration parameters. It has no awareness of a `Watch` path array.
   - `apps/devhost/internal/manifest/validate.go` validates known keys per service under the `services` block and does not allow `"watch"`.

2. **Health Resolution:**
   - `apps/devhost/internal/services/stack.go` orchestrates service lifecycles. `collectServicesHealth` compiles `devtools.ServiceHealth` with `Managed`, `Name`, `Status`, and `URL`, but does not support `Dirty`.
   - `RestartService(serviceName)` in `stack.go` handles restarting individual services manually on request.

3. **Injected status UI:**
   - `packages/devhost-ui/src/devtools/features/serviceStatusPanel/components/ServiceStatusPanel.tsx` renders static `<Button>` icons with `variant="secondary"` to trigger restarts, requiring mouse interaction for every reload.

---

## 3. Non-negotiable constraints

- **Watch Paths Resolution:** All configured watch paths must be evaluated relative to the manifest directory (`ManifestDirectoryPath`).
- **No Resource Bloat (Mandatory Directory Exclusions):** File watching must be highly efficient, recursive, and lightweight. The directory walker (`filepath.WalkDir`) must check the directory name and immediately return `filepath.SkipDir` upon encountering any of the following folders to avoid traversing massive subtrees: `.git`, `node_modules`, `vendor`, `.next`, `.tmp`, `dist`, `target`, `.workspaces`, `.shadow`, `.agents`, and `build`.
- **Graceful File-Descriptor Fallback:** If registering paths triggers an fsnotify limit warning (e.g., `syscall.ENOSPC` or `syscall.EMFILE` / "no space left on device" due to inotify limits), the application must catch this error, log a detailed troubleshooting warning to `stderr` with specific instructions (e.g., "To increase watch limits, run: `sudo sysctl -w fs.inotify.max_user_watches=524288`"), and continue running gracefully rather than panicking or crashing.
- **Event Debouncing:** Fsnotify events must be debounced per-service (e.g., 200ms) to ensure file-write storms do not result in high-frequency websocket floods.
- **Shadow DOM Compliance:** Global key event listeners in the injected overlay must be attached to the document level using `event.composedPath()[0] || event.target` to safely bypass Shadow DOM retargeting.
- **Graceful Lifecycle Resets:** Any service restart (manual, programmatic, or keyboard-shortcut driven) must immediately reset that service's dirty status back to `false` at the **start** of the teardown sequence.
- **Debounce Timer Cancellation on Restart:** To completely eliminate the watch-compile race, the service restart routine must actively cancel and flush any pending/running debounce timers for that service. This prevents a queued file change event from _before_ the restart from firing _after_ the reset, which would otherwise falsely re-mark the service as dirty.

---

## 4. Exact architecture choice

### Go Backend (Fsnotify Watcher)

- Add a dependency on `github.com/fsnotify/fsnotify` to track filesystems natively.
- Walk directories recursively on startup for any service containing a `"watch"` array in the manifest. Register these paths under the service's fsnotify watcher thread. Use `filepath.WalkDir` and skip nested excluded directories entirely via `filepath.SkipDir` to protect system resources.
- Introduce a thread-safe RWMutex-protected `DirtyTracker` structure mapping service names to `dirty` state values.
- When an fsnotify write, create, delete, or rename event is fired, update the state of that service to `dirty: true` and trigger a throttled `PublishHealthResponse()`.
- On handling a `RestartService` request, immediately set that service's state in `DirtyTracker` to `false` at the **very start** of the teardown sequence before process termination and rebuild.
- **Service Restarting State Tracking:** The `ServiceHealth` payload must include a `restarting` boolean property. In Go, the `collectServicesHealth()` routine must map this to the thread-safe `startedService.isRestartingValue()` field on each managed service. This is set to `true` at the start of the teardown and set back to `false` when the service restarts and health-checks successfully.
- **Debounce Timer Cancellation:** Each service's debounce routine is backed by a `*time.Timer`. The restart coordinator must track these timers per service. On restart, the coordinator must call `timer.Stop()` on the service's active timer to drain/cancel any pending event from before the restart, ensuring the `dirty` state is not falsely set to `true` by a late-firing event.

### Frontend Injected UI & Shortcut Integration

- Extend `ServiceHealth` in types and contracts with `dirty?: boolean` and `restarting?: boolean` fields.
- Check `service.dirty` inside `ServiceStatusPanel.tsx`. If `true` and the service is not currently restarting, set the restart button's variant to `"danger"` (destructive/red theme).
- Check `service.restarting` inside `ServiceStatusPanel.tsx`. If `true`:
  - The restart button must be **disabled** to prevent duplicate concurrent restart actions.
  - The `RotateCwIcon` inside the button must have the Tailwind `animate-spin` class applied to display a smooth, continuous spinning animation during active restarts, stopping automatically when `restarting` is updated to `false`.
- **Structured Error Handling on Failure:** The frontend restart trigger (both button click and hotkey) must handle non-200 HTTP response codes cleanly. On failure, it must parse the structured JSON response, extract the exact error details per service, and display them in the status panel header via the `errorMessage` state (e.g. `Failed to restart service <name>: <error>`).
- Add a configurable global keyboard shortcut (defaulting to `"alt+shift+r"`) defined in `devtools.shortcuts` manifest:
  ```toml
  [devtools.shortcuts]
  restartServices = "alt+shift+r"
  ```
- Inject this configuration string into `IInjectedDevtoolsConfig` as `restartServicesShortcut`.
- **Layout-Independent Parsing & Matching Algorithm:** To ensure macOS Option-Shift and other international keyboard layout mutations do not break the hotkey, the frontend must parse the configuration string and match events using physical `event.code` instead of character-based `event.key`:
  1. Split the lowercase config string (e.g. `"alt+shift+r"`) by `+` to extract the components.
  2. Map modifier strings to boolean event fields: `"alt"` -> `event.altKey`, `"shift"` -> `event.shiftKey`, `"ctrl"` -> `event.ctrlKey`, `"meta"`/`"cmd"` -> `event.metaKey`.
  3. Map the single-character base key (e.g. `"r"`) to its physical code format:
     - Letters `"a"-"z"` map to `"Key" + char.toUpperCase()` (e.g., `"r"` maps to `"KeyR"`).
     - Digits `"0"-"9"` map to `"Digit" + char` (e.g., `"1"` maps to `"Digit1"`).
  4. In the document keydown listener, match modifiers exactly (active modifier fields must match required modifiers, and unconfigured modifier fields must be false) and assert that `event.code` matches the target physical code.
- Implement a global document-level keydown handler. When the hotkey is matched, evaluate current services:
  - Count how many services are `dirty`.
  - If count is `1`, POST a restart request to `/__devhost__/restart-service` containing the single dirty service name in `serviceNames: [name]`.
  - If count is `> 1`, POST a single restart request to `/__devhost__/restart-service` containing all dirty service names in `serviceNames: [...]`.
  - If count is `0`, POST a restart request to `/__devhost__/restart-service` containing the `primaryService` name in `serviceNames: [primaryName]`.

---

## 5. Data model / schema

No database tables. The TOML manifest allows an optional `watch` list per service, and an optional `devtools.shortcuts` table:

```toml
[devtools.shortcuts]
restartServices = "alt+shift+r"

[services.web]
command = ["bun", "run", "dev"]
watch = ["src/", "package.json"]
```

---

## 6. Types and contracts

### Dirty Tracker Struct (Go)

```go
package services

import (
	"sync"
)

type DirtyTracker struct {
	mu      sync.RWMutex
	isDirty map[string]bool
}

func NewDirtyTracker() *DirtyTracker {
	return &DirtyTracker{
		isDirty: make(map[string]bool),
	}
}

func (d *DirtyTracker) SetDirty(serviceName string, dirty bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.isDirty[serviceName] = dirty
}

func (d *DirtyTracker) IsDirty(serviceName string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.isDirty[serviceName]
}
```

### ServiceHealth TypeScript Contract

```typescript
export type ServiceHealth = {
  managed: boolean;
  name: string;
  status: boolean;
  url?: string;
  dirty?: boolean; // Indicates file changes have been detected
  restarting?: boolean; // Indicates service is actively in process of restarting
};
```

### Devtools Configuration Contract

```typescript
export interface IInjectedDevtoolsConfig {
  // ...
  restartServicesShortcut?: string; // Configured hotkey combination
}
```

### Manifest Schema Extension (Go)

```go
type DevtoolsConfig struct {
	Editor           DevtoolsEditorConfig
	ExternalToolbars DevtoolsToggleConfig
	Minimap          DevtoolsMinimapConfig
	Status           DevtoolsStatusConfig
	Shortcuts        DevtoolsShortcutsConfig // New table
}

type DevtoolsShortcutsConfig struct {
	RestartServices string `descr:"Global keyboard shortcut for restarting services." name:"restart-services"`
}

type ValidatedService struct {
	// ...
	Watch []string
}
```

---

## 7. Exact file plan

### Add

- `apps/devhost/internal/services/watch.go`
  - Handles the recursive directory fsnotify registration, event tracking, and debouncing.

### Modify

- `apps/devhost/internal/manifest/types.go`
  - Adds `Watch` field to `ValidatedService`, and `Shortcuts` fields to `DevtoolsConfig`.
- `apps/devhost/internal/manifest/validate.go`
  - Allows and parses `"watch"` in `validateService()`, and `"shortcuts"` in `validateDevtools()`.
- `apps/devhost/internal/devtools/server.go`
  - Includes `Dirty` and `Restarting` in `ServiceHealth` struct and serializes `RestartServices` shortcut inside injected configuration variables.
- `apps/devhost/internal/services/stack.go`
  - Hooks up the `watch.go` watchers inside `StartStack()`.
  - Integrates `Dirty` and `Restarting` states into `collectServicesHealth()`.
  - Resets the dirty state on service restarts.
- `packages/devhost-ui/src/devtools/shared/types.ts`
  - Adds `dirty` field.
- `packages/devhost-ui/src/devtools/shared/readInjectedDevtoolsConfig.ts`
  - Resolves `restartServicesShortcut` from global config.
- `packages/devhost-ui/src/devtools/features/serviceStatusPanel/components/ServiceStatusPanel.tsx`
  - Colors the restart buttons red if `service.dirty` is true.
- `packages/devhost-ui/src/devtools/components/App.tsx`
  - Registers the global document-level key listener for the restart hotkey.

---

## 8. Runtime behavior

### Recursive Directory Watching

1. **Startup Walk:** For each service watch path, if it is a directory, walk its subdirectories and add each directory node to fsnotify.
2. **Dynamic Creation:** If a new directory is created inside a watched folder, dynamically add it to the fsnotify watcher path array.
3. **Debounced Notification:** Debounce file changes per service with a 200ms timer before calling `PublishHealthResponse()`.

### Hotkey Detection and Restart Routing

1. **Retargeting Bypass:** Extract the true event target inside the Shadow DOM using `event.composedPath()[0] || event.target`.
2. **Text Input Lockout:** Explicitly bypass the hotkey if the resolved target is a text input, textarea, select, contenteditable, or resides inside an interactive terminal emulator:
   ```typescript
   const target = (event.composedPath()?.[0] || event.target) as HTMLElement;
   if (target) {
     const tagName = target.tagName?.toLowerCase();
     const isInput =
       tagName === "input" ||
       tagName === "textarea" ||
       tagName === "select" ||
       target.isContentEditable ||
       target.closest?.(".xterm") !== null ||
       target.closest?.("[contenteditable]") !== null;
     if (isInput) return;
   }
   ```
3. **Hardware-Independent Key Matching:** Parse configured shortcuts dynamically and match them using layout-independent event codes:

   ```typescript
   export function parseAndMatchShortcut(shortcut: string, event: KeyboardEvent): boolean {
     const parts = shortcut.toLowerCase().split("+");
     let targetCode = "";
     let reqAlt = false;
     let reqShift = false;
     let reqCtrl = false;
     let reqMeta = false;

     for (const part of parts) {
       if (part === "alt") reqAlt = true;
       else if (part === "shift") reqShift = true;
       else if (part === "ctrl") reqCtrl = true;
       else if (part === "meta" || part === "cmd") reqMeta = true;
       else if (/^[a-z]$/.test(part)) targetCode = "Key" + part.toUpperCase();
       else if (/^[0-9]$/.test(part)) targetCode = "Digit" + part;
     }

     return (
       event.code === targetCode &&
       event.altKey === reqAlt &&
       event.shiftKey === reqShift &&
       event.ctrlKey === reqCtrl &&
       event.metaKey === reqMeta
     );
   }
   ```

   This is immune to macOS Option-Shift modifications (which mutate `event.key` to special characters like `‰`) and other layout mutations.

4. **Dispatch Routing & Dependency Sequencing:**
   - The frontend sends a single `POST` request containing the array of target service names to `/___devhost___/restart-service`.
   - The Go backend receives the request. Before executing any restarts, it sorts the requested list based on their positions in the pre-defined stack `serviceOrder` (which is already topologically sorted to satisfy all `dependsOn` declarations).
   - The backend restarts the sorted services sequentially in that order. For each service restarted, the backend waits for its health check to pass successfully _before_ terminating/restarting the next dependent service in the sorted list. This guarantees absolute system stability and prevents connection crashes.

---

## 9. Validation rules

- **Shortcut Key syntax:** Shortcuts must be written in lowercase space-free joined combinations (e.g., `"alt+shift+r"`, `"ctrl+shift+k"`). Invalid syntax defaults back to `"alt+shift+r"`.
- **Absolute Watch Paths:** Any configured watch path that resolves outside the `ManifestDirectoryPath` parent tree must trigger a startup validation warning but not block launching.

---

## 10. Exact API surface

### WebSocket Health Stream

The WebSocket health stream (`/__devhost__/ws/health`) includes `dirty` properties:

```json
{
  "services": [
    {
      "managed": true,
      "name": "api",
      "status": true,
      "url": "https://api.hello.localhost",
      "dirty": true
    }
  ]
}
```

### HTTP Service Restart Endpoint

The existing single restart endpoint is extended to support multiple service names:

- `POST /__devhost__/restart-service`

**Request Contract:**

```typescript
interface RestartServiceRequest {
  serviceNames: string[]; // List of services to restart in dependency order
}
```

**Response Contract:**

```typescript
interface RestartServiceResponse {
  success: boolean;
}
```

---

## 11. Implementation order

1. **Manifest and Option Parsers:** Extend `types.go` and `validate.go` to support `watch` arrays and `devtools.shortcuts` configurations.
2. **Fsnotify Wrapper:** Write `watch.go` to handle recursive watcher registration, debouncing, and state updates.
3. **Services Integration:** Integrate watchers into `stack.go` and reset states inside `RestartService`.
4. **Devtools Types & Indicators:** Add `dirty` properties on the UI side and style the restart buttons.
5. **Hotkey Listener Setup:** Implement the global key event listener inside `App.tsx` bypassing Shadow DOM retargeting.
6. **Documentation and End-To-End Verification:** Update manuals and run checks.

---

## 12. Testing plan

### Automated Tests

- **`validate_test.go`:** Prove `watch` paths and shortcuts parse correctly.
- **`watch_test.go`:** Exercise recursive folder creation, modification, and check debounced dirty broadcasts.
- **Hotkey Unit Tests:** Write Vitest/Storybook play assertions confirming that hotkey sequences trigger parallel fetches.

### Manual Verification

- Edit a source file in a service watch path. Confirm the UI restart button transitions from gray to red.
- Press `Alt+Shift+R`. Verify that the backend immediately restarts the dirty service, resets its status back to normal, and the button transitions back to gray.
- Edit files across multiple services that have dependencies (e.g., `web` and `api` where `web` depends on `api`). Press `Alt+Shift+R`, and verify that the backend restarts `api` first, waits for its health check to pass, and only then starts `web`.

---

## 13. Out-of-scope / rejection list

- **No automatic reloading on disk change:** Services must only restart on manual or hotkey commands.
- **No deep content hashing:** Simple event matching is utilized.

---

## 14. Definition of done

- [ ] Go manifest schema validations and tests pass cleanly.
- [ ] Backend recursive watchers reliably flag dirty states with event debouncing.
- [ ] Injected UI indicators correctly render and hotkeys trigger parallel restarts.
- [ ] `bun run check` and `bun run compile:devhost` complete with zero errors.
- [ ] Pair with subagent until clean review.

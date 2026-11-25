---
created_on: 2026-11-17 03:49
last_modified: 2026-11-18 06:44
status: current
---

# Edit configuration in the browser: research

Proposal: [Edit configuration in the browser](config-editor.md). Shared patterns: [UX pattern reference](../patterns.md).

Scope: from the intent to change a stack's configuration in the browser (turning the editor on, **Config**, or **Edit** in a rejected-reload notice) to a finished outcome: an edit saved and applied, a save refused, a reload rejected with the stack on its previous configuration, or unsaved changes reverted. Today no outcome is undoable (step 21) [Verified]. Operations: `GET /__devhost__/config/files` and `/__devhost__/config/schema`, `POST /__devhost__/config/validate` and `/__devhost__/config/save`, the manifest watcher's hot reload, the shared Caddy settings apply that follows a `config.toml` save, and the configuration status in the health stream.

Evidence: alexgorbatchev/devhost at `edb5c0fc01cabae490e92ac23d4c785ec896c4ed` (product code identical to the reviewed 0.0.12 build), including its public docs at that revision, and the Go 1.26 standard library's `net/http` (`CrossOriginProtection.Check`), which the control server uses. 'Verified' means read in code or tests at those revisions; 'Hypothesis' means inferred and not tested. Nothing was run for this note: observed screens and measured times come from the cited findings' live runs and are labeled with the finding. Paths are relative to the repository root; after a file's first full path, citations name it by its file name, which is unique in the repository.

Product rule: the owner rules for this review state that "the config editor is off by default and saves only from the same machine, on purpose", because a manifest decides which commands devhost runs, and that every manifest setting applies through hot reload, never through "restart to apply". The public docs say the same (`packages/docs/src/content/docs/guides/devtools.md:135`, `:153`), as does the save route (`apps/devhost/internal/devtools/config_files.go:151-152`) [Verified]. Hot reload's documented contract adds that a rejected edit leaves the stack on the configuration it accepted before, until a later save is accepted (`packages/docs/src/content/docs/stacks/hot-reload.md:38`, `:44`) [Verified]. The editor being off by default, saves refused from other machines, every save applying through hot reload, and a rejected reload keeping the previous configuration running are intended, not defects. The gap is around that intended write: the person cannot see what a save will restart or change beyond the file, cannot tell which reload's result belongs to which save, cannot get back to the text the stack runs after a rejection, and can lose unsaved text to a page reload, a change on disk or a save that turns the editor off.

## Today's flow, step by step

Entry points:

1. **Turn the editor on.** A person writes `[devtools.configEditor] enabled = true` in a manifest with any text editor (`apps/devhost/internal/manifest/validate.go:172`). The reload that accepts it pushes the new feature toggles to open pages with the next health message (`apps/devhost/internal/services/reload.go:243-249`, `apps/devhost/internal/devtools/control_settings.go:96-117`), so **Config** appears without a page reload (`packages/devhost-ui/src/devtools/components/App.tsx:330-338`). While the toggle is off, every config route answers 404 (`apps/devhost/internal/devtools/config_files.go:95-103`). [Verified]
2. **Config** in the toolbar opens and closes the window. After a rejected reload of either source it turns red, with the tooltip "Edit the configuration; devhost rejected its last change" (`packages/devhost-ui/src/devtools/features/configEditor/components/ConfigEditorButton.tsx:16-31`, `packages/devhost-ui/src/devtools/components/App.tsx:238`). [Verified]
3. **Edit** in the toolbar's "Manifest change not applied" or "devhost config change not applied" notice only opens the window, on whichever file was shown last, and the first file before any choice (`packages/devhost-ui/src/devtools/features/configEditor/components/ConfigRejectionNotice.tsx:12-15`, `:18-42`; `packages/devhost-ui/src/devtools/components/App.tsx:239-241`, `:283-289`; `packages/devhost-ui/src/devtools/features/configEditor/hooks/useConfigEditor.ts:64-65`) (config-editor-09). [Verified]
4. **From a crashed service.** The crash view opens as a modal that cancels Escape and offers only restarts, so **Config** is reached through another page or an Escape the view tries to block (`packages/devhost-ui/src/devtools/features/serviceStatusPanel/components/ServiceCrashOverlay.tsx:27-31`, `:45-51`) (journey-crash-to-fix-01). The editor then receives the configuration status but no service health, so it says nothing about the failure (`packages/devhost-ui/src/devtools/components/App.tsx:365-376`) (journey-crash-to-fix-02). [Verified]

The surface:

5. **The window opens** as a centered dialog without `aria-modal` over a full-page backdrop, with focus in the text (`packages/devhost-ui/src/devtools/features/configEditor/components/ConfigEditorPanel.tsx:118-135`, `:100-104`) (config-editor-10). It stays mounted while closed, so drafts survive **Close** and Escape (`ConfigEditorPanel.tsx:23-26`, `:111-116`, `:188-195`). [Verified]
6. **Files load on every open** (`packages/devhost-ui/src/devtools/features/configEditor/hooks/useConfigEditor.ts:87-115`), with `cache: "no-store"` (`packages/devhost-ui/src/devtools/features/configEditor/createConfigEditorClient.ts:86-99`). A file that has a draft keeps the version it was opened at, so a later save of it can be refused (`useConfigEditor.ts:254-266`). The backend, in order: [Verified]
   1. The request guard applies the cross-origin rule, the `Host` rule and the JSON body rule to every config route, reads included (`apps/devhost/internal/devtools/request_guard.go:18-41`). Go's `CrossOriginProtection.Check` always allows `GET`, `HEAD` and `OPTIONS` (Go 1.26 `net/http/csrf.go`, `Check`), so a read passes on the `Host` rule alone. [Verified]
   2. `configFiles` takes the stack's operation lock and lists the root manifest (the selected checkout's after a worktree switch), every file the watcher tracks (includes, even those of a read that failed), then the devhost config file (`apps/devhost/internal/services/config_editor.go:13-39`). [Verified]
   3. Each file is read with a SHA-256 version of its bytes. A missing file, such as a `config.toml` not created yet, is listed with empty content and an empty version; a file over 1 MiB fails the whole list (`apps/devhost/internal/devtools/config_files.go:27-28`, `:99-119`, `:219-238`). [Verified]
7. **Pick a file.** The **File** list labels each entry with its path and "(unsaved)", not with its role, although each entry carries one (`ConfigEditorPanel.tsx:106-109`, `:144-164`; `packages/devhost-ui/src/devtools/features/configEditor/types.ts:3-13`) (config-editor-01). Picking a file clears the window's save outcome (`useConfigEditor.ts:133-140`) (config-editor-13) and starts a new undo history for the text shown (`packages/devhost-ui/src/devtools/features/configEditor/createConfigEditorView.ts:143-148`). [Verified]
8. **Edit with live checks.** Each change becomes the file's draft in React state (`createConfigEditorView.ts:120-124`; `useConfigEditor.ts:61`, `:146-155`). After a pause in typing the linter posts the text to `/__devhost__/config/validate` (`createConfigEditorView.ts:96-103`; `createConfigEditorClient.ts:81-85`), which writes nothing (`apps/devhost/internal/devtools/config_files.go:129-142`). `checkConfigFile` (`apps/devhost/internal/services/config_editor.go:41-76`), in order: [Verified]
   1. takes the operation lock, so a check waits for a running reload, restart or worktree switch (`config_editor.go:44-45`);
   2. for `config.toml`, parses the text and stops (`config_editor.go:49-52`);
   3. for a manifest file, reads the manifest with the draft in place of that file (`config_editor.go:60`; `apps/devhost/internal/manifest/read.go:23-33`), validates the schema (`config_editor.go:64-67`), resolves the reload candidate, which finds dependency cycles and port problems (`:68-74`), and checks working directories (`:75`); each stage returns at its first failure (config-editor-02);
   4. turns the error into issues: a parse error gets a line and column, a schema issue a key path, any other error neither (`apps/devhost/internal/devtools/config_files.go:286-317`); the page marks an issue without a position, or one in another file, at the start of the file (`packages/devhost-ui/src/devtools/features/configEditor/readConfigDiagnostics.ts:9-27`) (config-editor-03).

   Completions come from the schema; their list renders inside the window, which is translated and clips its overflow (`createConfigEditorView.ts:95`; `ConfigEditorPanel.tsx:129`) (config-editor-04). [Verified]
9. **Revert** drops the selected file's draft and shows the file's stored text, which is the version the window opened or last saved, not a fresh read of the disk (`useConfigEditor.ts:157-164`; `ConfigEditorPanel.tsx:166-174`) (config-editor-07). [Verified]

Save, then the backend's internal sequence:

10. **Save** (the button, or Meta+S on macOS and Ctrl+S elsewhere from the text) is enabled while the file has a draft and no save request is in flight, so it stays enabled while an earlier save applies (`ConfigEditorPanel.tsx:175-187`; `createConfigEditorView.ts:105-113`). The hook does nothing without a change, reads the source's reload count (`manifest` for the root manifest and includes, `config` for `config.toml`), shows **Saving**, and posts the draft with the version it was based on (`useConfigEditor.ts:166-185`; `createConfigEditorClient.ts:100-104`). [Verified]
11. **`POST /__devhost__/config/save`** (`apps/devhost/internal/devtools/config_files.go:144-185`), in order: [Verified unless marked]
    1. the request guard refuses a cross-origin browser request, a `Host` that is not one of the stack's hostnames or a loopback name, and a body that is not JSON (`apps/devhost/internal/devtools/request_guard.go:22-41`);
    2. 404 while the editor is off (`config_files.go:147-150`);
    3. 403 "Only a browser on this machine can save the configuration." unless the connection and every `X-Forwarded-For` address are loopback (`config_files.go:151-156`, `:262-284`). That Caddy replaces an `X-Forwarded-For` the client sends is the code comment's claim (`:262-263`) and Caddy's default for clients it does not trust, which devhost's Caddy configuration does not change [Hypothesis: holds while no trusted proxies are configured in the managed Caddy; not tested here];
    4. decodes the JSON within a size limit, refusing unknown fields (`config_files.go:157-160`, `:187-201`);
    5. 403 unless the path is one the stack lists, a lookup that takes the operation lock (`config_files.go:161-164`, `:203-217`; `apps/devhost/internal/services/config_editor.go:16-17`);
    6. one save at a time per stack (`config_files.go:165-166`);
    7. reads the file on disk and answers 409 with that file when its version differs from the draft's base (`config_files.go:167-175`);
    8. runs the checks again, waiting for any running reload, and answers 422 with the issues (`config_files.go:176-179`; `config_editor.go:44-45`); config-editor-12 measured a 12.7 s wait behind a running reload;
    9. writes: follows a symbolic link to its target, keeps an existing file's permission bits or creates the file at 0600, creates missing directories at 0700, writes a temporary file beside the target, syncs it, renames it over the target, syncs the directory, and sets the mode exactly (`config_files.go:29-30`, `:240-260`; `apps/devhost/internal/devtools/durable_file.go:18-58`);
    10. answers 200 with the new content's version. The route starts no reload; the watcher applies the write (`config_files.go:144-145`, `:184`).
12. **The watcher sees the write.** A write, create, remove or rename of a tracked path starts a 200 ms debounce that merges bursts (`apps/devhost/internal/services/manifest_watch.go:15`, `:56-98`, `:151-192`). The stack loop runs one manifest reload at a time and takes no new manifest event until it finishes (`apps/devhost/internal/services/stack.go:617-626`); `config.toml` has its own watcher and apply step (`stack.go:601-610`). [Verified]
13. **Manifest reload** (`apps/devhost/internal/services/reload_disk.go:24-51`): it holds the operation lock for the whole reload (`:25-26`), reads the manifest from disk, updates the watched files (`:27-39`) and validates it (`:40-43`). Turning `[worktrees] enabled` off while another checkout runs becomes a switch back to the root checkout (`:44-50`). Otherwise `applyConfiguration` (`apps/devhost/internal/services/reload.go:29-39`, `:85-270`), in order: [Verified]
    1. registers the manifest files in the stack's record in the state directory (`reload.go:100-111`; `apps/devhost/internal/services/manifest_registration.go:17-52`);
    2. accepts an unchanged configuration without restarting anything (`reload.go:112-114`);
    3. resolves the candidate, its ports, worktrees and working directories (`reload.go:115-143`);
    4. collects the affected services: the changed ones, their dependents and their repository groups (`reload.go:144-157`);
    5. claims hostnames and fixed ports (`reload.go:173-176`);
    6. publishes the pending reload, so pages show the affected services as reloading (`reload.go:190-209`; `apps/devhost/internal/services/runtime.go:66`, `:83-87`);
    7. stops the affected services (`reload.go:210-212`, `:278-284`);
    8. installs the candidate and starts each affected service, waiting for its health check; automatic ports may move (`reload.go:213`, `:225-227`, `:286-328`). A `process` health check looks for an exit once, at start (`apps/devhost/internal/services/health.go:63-69`) (config-editor-05);
    9. replaces the stack's Caddy routes (`reload.go:231-233`);
    10. pushes the new settings to open pages (`reload.go:243-249`);
    11. accepts: records the new configuration, retires removed services, releases old claims, then logs `configuration reloaded: <files>` and the service URLs (`reload.go:250-269`).

    A failure from step 7 on rolls back: the watched files, the new services stopped, the previous services and routes started again, the claims released (`reload.go:214-224`, `:330`). [Verified]
14. **`config.toml` apply** (`apps/devhost/internal/services/shared_caddy.go:53-84`): reads the file, re-renders the shared Caddy's settings in the state directory and reloads Caddy, restoring the running settings when that fails, then records the applied settings (`apps/devhost/internal/caddy/settings.go:53-61`, `:91-114`), and logs "Applied the shared Caddy settings from \<path\>." with the moved URLs (`shared_caddy.go:80-82`). [Verified]
15. **The result is recorded per source.** The source's reload count rises; the error is kept until a reload of that source is accepted; pages receive both with the next health message (`apps/devhost/internal/services/runtime.go:106-124`; `apps/devhost/internal/devtools/configuration_status.go:13-22`). A new rejection reason is logged once as `configuration reload rejected:` or `shared Caddy settings rejected:` (`apps/devhost/internal/services/stack.go:611-616`, `:627-632`). [Verified]

Results, failures and undo:

16. **Applied or rejected.** While the reload runs the window reads "Saved. devhost is applying the change."; once the source's count passes the one read at Save, it reads "Saved and applied." or "devhost kept the previous configuration" over the raw error (`ConfigEditorPanel.tsx:247-257`; `useConfigEditor.ts:117-131`) (config-editor-05, config-editor-06, config-editor-12). The saved text becomes the file's stored content, so the file reads as unchanged (`useConfigEditor.ts:192-196`). [Verified]
17. **Refused (422).** "devhost refused the save" with "The file was not written. The issues are listed below the editor.", and the checks run again (`ConfigEditorPanel.tsx:93-98`, `:269-274`). [Verified]
18. **Conflict (409).** "The file changed on disk" with one action, **Load from disk**, which replaces the draft with the version on disk (`ConfigEditorPanel.tsx:258-268`; `useConfigEditor.ts:200-213`) (config-editor-07). [Verified]
19. **Failed.** A network error, a 403 or any other status shows "The save failed" with the response text; a failed load shows "The configuration could not be loaded" with the raw body and is not retried while the window stays open (`createConfigEditorClient.ts:108-140`; `ConfigEditorPanel.tsx:231-237`, `:275-280`; `useConfigEditor.ts:99-102`) (notices-and-feedback-01). [Verified]
20. **The toolbar** shows the rejection under it and a red **Config** until a reload of that source is accepted (`packages/devhost-ui/src/devtools/components/App.tsx:238`, `:283-289`). [Verified]
21. **Undo: none.** After a save the stored text is the saved text, so **Revert** has nothing to drop (`useConfigEditor.ts:157-164`, `:192-196`). The editor's undo history can step back past a save only while that file stays shown, because showing another file starts a new history (`createConfigEditorView.ts:91`, `:143-148`), and stepping back is a new save with its own checks and reload. Nothing keeps the text a save replaced (negative searches under **The contested behavior**). [Verified]
22. **Drafts end** on a page reload, since the page registers no `beforeunload` handler, and when the toggle turns off and the window unmounts (`useConfigEditor.ts:61`; `packages/devhost-ui/src/devtools/components/App.tsx:365-376`) (config-editor-08). [Verified]

## The contested behavior

**A browser save is a guarded, atomic, one-way write: devhost refuses unsafe saves, but keeps no copy of the text a save replaced or of the text the stack runs, and it reports a save's result by counting reloads of the file's source rather than by naming the write that reload applied.** [Verified]

Evidence:

- The guards: same-origin browser requests only, a `Host` the stack serves, a loopback client, a path the stack lists, the version the draft was based on, and the reload's own checks, all before anything is written (`apps/devhost/internal/devtools/request_guard.go:22-41`; `config_files.go:151-179`). The write replaces the file atomically (`config_files.go:240-260`; `durable_file.go:18-58`). The owner rule makes the same-machine limit intended. [Verified]
- No copy of the text: the runtime keeps the accepted manifest as a parsed value (`reload.go:250`) and the shared Caddy settings as parsed fields (`shared_caddy.go:72-76`), never the text they were read from, and the save route keeps nothing of the file it replaces (`config_files.go:165-184`). [Verified]
- Results by count: the configuration status of a source is a count of finished reloads and the last error (`configuration_status.go:13-22`); a save answers only with the written content's version (`config_files.go:184`); the editor reads the count when Save is pressed and resolves on the first finished reload above it, whichever save that reload applied (`useConfigEditor.ts:117-131`, `:181`). [Verified]
- After a rejection the stack runs the configuration it accepted before, while the disk keeps the rejected text: the rollback restores services, routes and watched files, not file contents (`reload.go:214-224`), as the hot reload page documents (`packages/docs/src/content/docs/stacks/hot-reload.md:38`, `:44`). [Verified]

Negative searches:

- Nothing keeps the text of an accepted read: no match for `lastAccepted`, `acceptedContent`, `acceptedText` or `runningVersion` in `apps/devhost/internal/` or `packages/devhost-ui/src/`. [Verified]
- No `beforeunload` handler exists anywhere in `packages/devhost-ui/src/`, tests included. [Verified]
- The editor's backend runs no Git command: `apps/devhost/internal/devtools/config_files.go` and `apps/devhost/internal/services/config_editor.go` import no `os/exec` and name no `git`. [Verified]
- The window never reads a file again while it stays open: the only reads are in the effect that runs when it opens (`useConfigEditor.ts:87-115`), and the configuration status carries no file version that could tell it the disk changed (`configuration_status.go:13-22`). [Verified]
- No restart plan is computed before a save: `checkConfigFile` resolves the reload candidate but never calls `affectedReloadServices` or `expandReloadGroups`, which only the reload itself runs (`config_editor.go:41-76`; `reload.go:144-152`). [Verified]

What this means in practice:

1. **A rejected save leaves the file and the stack apart.** The rejected text is on disk and shown as saved, with **Revert** and **Save** disabled, while the stack runs the previous configuration (`useConfigEditor.ts:192-196`; `ConfigEditorPanel.tsx:166-176`) (config-editor-06). Every later reload reads the whole manifest from disk (`reload_disk.go:27-28`), so a later save of another file of the same stack, the next `devhost start`, or a teammate who pulls the commit runs the rejected text again. The way back is the person's memory, the editor's undo history while that file stays shown (`createConfigEditorView.ts:143-148`), or Git. [Verified]
2. **A result can belong to another save.** A second save made while the first applies waits behind the running reload, then reads "Saved and applied." as soon as the first save's reload is counted, 14 s before its own reload ran in config-editor-12's measurement, and would read so even if its own reload were rejected (config-editor-12). Switching files while a save applies drops its result for good (`useConfigEditor.ts:133-140`) (config-editor-13). [Verified]
3. **Changes on disk stay invisible until Save,** and the conflict's only exit discards the draft; **Revert** then shows a version that is neither on disk nor running (config-editor-07). [Verified for the code path; Hypothesis for frequency: it holds wherever an agent, an IDE or `git checkout` writes the manifest while the window is open, which the review did not measure]
4. **Unsaved text has no durable home.** A page reload, a link click, **Reload** in "Reload blocked" after a save restarted the page's own server, or a save that turns the editor off drops every file's draft without a prompt (`useConfigEditor.ts:61`; `packages/devhost-ui/src/devtools/components/App.tsx:365-376`) (config-editor-08). [Verified]
5. **"Saved and applied." can be false.** A changed service with `process` health that exits after its single check counts as started, so the reload is accepted and the rollback contract never triggers (`health.go:63-69`) (config-editor-05). [Verified]
6. **A save can reach well beyond the edited service, unannounced before it is written.** In a repository with a selected checkout, every service of that repository restarts (`packages/docs/src/content/docs/stacks/hot-reload.md:51`; `reload.go:152`), including the server of the page the person is on (config-editor-05). `[worktrees] enabled = false` while another checkout runs switches the stack back to the root checkout (`reload_disk.go:44-50`). `enabled = false` under `[devtools.configEditor]` removes the editor and its drafts (`packages/devhost-ui/src/devtools/components/App.tsx:365-376`). A `config.toml` save moves the shared Caddy, and with it the URLs of every stack on the machine (`shared_caddy.go:53-84`). None of this is computed or shown before Save (negative search above). [Verified]
7. **Reads reach further than writes.** With the editor on, `/__devhost__/config/files` returns the content of every listed file, which can hold `env` values and the shared Caddy settings, to any client whose request carries one of the stack's hostnames: reads get only the cross-origin and `Host` rules (`request_guard.go:24-35`; `packages/docs/src/content/docs/reference/control-api.md:29`). Saves, live agent activity and the stack directory also require a loopback client (`config_files.go:151-156`; `apps/devhost/internal/devtools/agent_activity.go:54`; `apps/devhost/internal/devtools/stack_directory.go:36-37`). [Verified in code; Hypothesis for the network path: holds when Caddy listens on a non-loopback interface, the documented default (`packages/docs/src/content/docs/guides/shared-managed-caddy-settings.md:45`), as network-exposure-01 used to reach a stack's control routes from another machine]
8. **Every stack operation shares one lock.** Opening the window, each live check and each save wait for a running reload, restart or worktree switch (`config_editor.go:16-17`, `:44-45`; `reload_disk.go:25-26`; `runtime.go:153-155`, `:363-365`; `reload.go:45-46`, `:73-74`). The first open during such an operation shows an empty, disabled window with no loading state until it ends (`useConfigEditor.ts:87-110`; `ConfigEditorPanel.tsx:43-48`, `:225-284`). [Verified in code; not reproduced live]

Reusable capabilities and their limits:

- Content versions are SHA-256 hashes of the file's bytes (`config_files.go:235-238`), already returned by the file list, the 409 body and the save (`config_files.go:118`, `:173`, `:184`). Because the 409 body carries the disk version, a client can overwrite a newer disk version after showing it, by sending the save again with that version, with no backend change. [Verified]
- While a reload runs, the health stream already marks each affected service as restarting (`reload.go:190-209`; `runtime.go:66`, `:83-87`). [Verified]
- The checks run on any text without writing it and build the reload candidate that `affectedReloadServices` takes as input (`config_editor.go:60-75`; `reload.go:144`), so a restart plan can come from the same request. [Verified]
- Limits: 1 MiB per file (`config_files.go:27-28`); a request body of 6 MiB plus 4 KiB (`config_files.go:193-194`); a 200 ms watcher debounce (`manifest_watch.go:15`); one manifest reload at a time per stack (`stack.go:617-632`); one save at a time per stack (`config_files.go:165-166`); 512 retained log lines per stack (`apps/devhost/internal/devtools/server.go:38`), which bounds how long a failed service's output stays readable after a rejection (journey-crash-to-fix-03). [Verified]
- The control server already keeps per-stack UI state that survives a page reload: the chat panel's position (`packages/docs/src/content/docs/reference/control-api.md:51`). [Verified in the docs]

### Other products

General knowledge, not re-read for this note; evidence for the design, never a requirement:

- **VS Code** refuses to save over a file that changed on disk and offers **Compare** and **Overwrite**; hot exit restores unsaved changes after the window reloads (code.visualstudio.com/docs/editor/codebasics, "Hot Exit"). [General knowledge]
- **JetBrains IDEs** resolve a file changed on disk under unsaved edits with a choice to load the disk version, keep the editor's, or show the difference; Local History keeps earlier versions of saved files (jetbrains.com/help/idea/local-history.html). [General knowledge]
- **kubectl** shows what an apply would change with `kubectl diff` before writing, and `kubectl rollout undo` returns a workload to its previous revision (kubernetes.io/docs/reference/kubectl/). [General knowledge]
- **Caddy**'s admin API applies a new configuration as a unit and keeps the running one when the new one fails to load (caddyserver.com/docs/api). [General knowledge]
- **nginx** checks a configuration with `nginx -t`, and a reload whose configuration fails keeps the old worker processes serving (nginx.org/en/docs/control.html). [General knowledge]
- **Docker Compose** recreates only the services whose configuration changed and names each one it recreates in its output (docs.docker.com/reference/cli/docker/compose/up/). [General knowledge]

## What else changes

One row per data item a save, and the reload that follows it, changes. Every row is Verified unless it says otherwise.

| Data | Today | Evidence |
| --- | --- | --- |
| The saved file's content (root manifest, include or `config.toml`) | Replaced as a whole after the version check and the checks; the replaced text is kept nowhere | `config_files.go:165-184`, `:240-260`; `durable_file.go:18-58` |
| The file's permissions | An existing file keeps its permission bits; a new file gets 0600; the mode is set exactly after the rename | `config_files.go:29-30`, `:249-259` |
| A symbolic link | The link's target is written and the link stays a link. Hypothesis: when the target lives in another directory, the watcher, which watches the link's directory and matches the link's path, sees no event on Linux, so no reload runs and the window keeps reading "Saved. devhost is applying the change." (untested; no test covers a linked manifest or include) | `config_files.go:240-248`; `apps/devhost/internal/manifest/read.go:60-69`; `manifest_watch.go:107-111`, `:151-165` |
| A `config.toml` that does not exist yet, and its directories | Listed with empty content; the first save creates the file at 0600 and any missing directory at 0700 | `config_files.go:219-223`; `config_editor.go:38`; `durable_file.go:22-25` |
| A temporary file beside the target | `<file>.<random>.tmp` is written, synced and renamed over the target, or removed when the write fails before the rename; the watcher ignores it because it matches only tracked paths | `durable_file.go:26-41`, `:53-57`; `manifest_watch.go:151-165` |
| The Git working tree | A tracked manifest shows as modified; nothing is staged or committed, and no branch changes | `config_files.go:144-185`; `config_editor.go:1-76` (no Git command) |
| The accepted manifest, in memory | Replaced only when the reload is accepted; a rejection keeps it while the disk keeps the rejected text | `reload.go:213`, `:250`, `:214-224` |
| Managed service processes | The changed services, their dependents and their repository groups stop and start again, waiting for health; after a failure the new ones stop and the previous ones start again; an unchanged configuration restarts nothing | `reload.go:112-114`, `:144-157`, `:210-227`, `:214-224`; `packages/docs/src/content/docs/stacks/hot-reload.md:50-52` |
| Automatic ports | Can be reassigned while affected services start | `reload.go:286-328` (`AllowPortReassignment` at `:301`) |
| Hostname and fixed-port claims | Claimed before the restart, old ones released after acceptance, released again on rollback; a hostname or fixed port that another stack holds rejects the reload | `reload.go:173-176`, `:261-263`; `packages/docs/src/content/docs/stacks/hot-reload.md:42` |
| The stack's Caddy routes | Replaced after the affected services start; the previous routes come back on rollback | `reload.go:231-233`, `:214-224` |
| The shared Caddy settings (a `config.toml` save) | Re-rendered in the state directory, the shared Caddy reloaded and `applied.json` rewritten; the URLs of every stack on the machine can move; the running settings stay when Caddy rejects the new ones | `shared_caddy.go:53-84`; `apps/devhost/internal/caddy/settings.go:53-61`, `:91-114`; `apps/devhost/internal/caddy/paths.go:91` |
| The stack's record in the state directory | Re-registers the manifest files the stack reads, so `devhost stop` and `stack find` find it through a newly included file | `reload.go:100-111`; `manifest_registration.go:17-52` |
| The worktree selection | `[worktrees] enabled = false` while another checkout runs switches the stack back to the root checkout; turning worktrees on forgets a selection saved by an earlier run | `reload_disk.go:44-50`; `reload.go:123-127`; `packages/docs/src/content/docs/stacks/hot-reload.md:56`, `:65` |
| Devtools settings on open pages | Reach open pages with the next health message; turning the editor off unmounts it and drops its drafts | `reload.go:243-249`; `control_settings.go:96-117`; `packages/devhost-ui/src/devtools/components/App.tsx:365-376` |
| The configuration status of the source | Reload count plus one; the last error kept until an accepted reload of that source; a terminal line when the rejection reason changes | `runtime.go:106-124`; `stack.go:611-616`, `:627-632` |
| Drafts, in the page's memory | One per file in React state, kept across file switches and Close, lost on a page reload and when the window unmounts | `useConfigEditor.ts:61`, `:146-155`; `ConfigEditorPanel.tsx:23-26` |
| The editor's undo history | Survives a save; starts over when another file is shown | `createConfigEditorView.ts:91`, `:143-148` |

## Related tickets

| Ticket | Source | One line |
| --- | --- | --- |
| config-editor-06 | same | Core: after a rejected save the rejected text reads as saved, with no way back to what the stack runs |
| config-editor-07 | same | Core: changes on disk stay invisible until Save, and the conflict's only exit discards the draft |
| config-editor-08 | same | Core: drafts vanish on a page reload, or when a save turns the editor off |
| config-editor-12 | same | Core: a second save made while the first applies reads the first save's result |
| config-editor-13 | same | Core: switching files while a save applies drops that save's result |
| config-editor-05 | same | Core, split: a changed `process`-health service that exits at once still reads "Saved and applied.", and nothing says what the save restarted; the reload's report of what it restarted is manifest-hot-reload's slice |
| config-editor-09 | same | Core: **Edit** in the rejection notice opens the last file, and the window says nothing about the rejection |
| config-editor-02 | same | Core: live checks report problems in waves |
| config-editor-03 | same | Core: problems land on the wrong line, as raw Go errors with absolute paths |
| config-editor-01 | same | Core: the **File** list clips paths and never says that `config.toml` is shared by every stack |
| config-editor-04 | same | Core: completions near the bottom of the window open outside it and are clipped |
| config-editor-10 | same | Core: the keyboard cannot reach **File**, **Revert**, **Save** or **Close**, and focus leaves the dialog |
| notices-and-feedback-01 | same | Core, split: with the stack stopped the window prints a page's markup and pushes its buttons off screen; raw markup in control errors is notices-and-feedback's slice |
| journey-crash-to-fix-02 | same | Feeds this flow: opened to fix a crashed service, the editor shows no failed service, error or marker |
| journey-crash-to-fix-01 | same | Dependency: the crash view never points to the manifest, and **Config** is reached only through an Escape it tries to block (startup-and-recovery) |
| journey-crash-to-fix-03 | same | Dependency: a rejection gives an exit code, not what the service printed (manifest-hot-reload) |
| manifest-hot-reload-01 | config-editor-05 (its reload slice, recorded on this ticket) | Dependency: a repository restarts as a unit and nothing says what restarted or why; the reload's report of its restarts lands here (manifest-hot-reload; the default scope is `O9`) |
| journey-new-project-02 | notices-and-feedback-01 (its raw-markup part, recorded on this ticket) | Dependency: control errors show the routing page's raw markup, the cause behind the unloadable window's text (notices-and-feedback, services-panel) |
| interrupted-operations-05 | same | Adjacent: the terminal side of a save queued behind a running reload (manifest-hot-reload) |
| chat-compose-04 | config-editor-11 (a duplicate recorded on this ticket) | Adjacent: docked chat, and on laptop-size screens the Configuration window, cover the toolbar's notices, including the rejection and its **Edit** (toolbar-shell) |
| services-panel-02 | same | Adjacent: a failed service's row shows neither its exit code nor its error, so the cause reaches the editor only in the person's head (services-panel) |

Other redesigns that hold pieces of this journey: **manifest-hot-reload** (what a reload restarts, its outcome and rejection wording, the queue behind a running reload), **notices-and-feedback** (control errors and the lost connection), **toolbar-shell** (where notices sit under an open window or docked chat), **startup-and-recovery** (the crash view's way to the manifest), **services-panel** (a failed service's row), **proxy-settings** (what the `config.toml` settings do once saved) and **worktree-switch** (the switch that a `[worktrees] enabled = false` save starts).

## Open questions

Facts stated in these questions are Verified unless tagged otherwise; proposed defaults are proposals, not evidence. Each question goes to the pattern reference as a product decision (`O<n>`) or a rule, and the proposal follows the decision; question 5 builds on the existing `O9`.

1. **The running version after a rejection.**
   - Unknown: whether devhost keeps the text of each file as the last accepted reload read it, so the editor can show what the stack runs, mark the lines that differ and write it back on request, and where that text lives (memory for the stack's lifetime, or the state directory).
   - Why it matters: a rejected save leaves the file and the stack apart, and every later reload runs the rejected text again (consequence 1, config-editor-06). The accepted manifest cannot stand in for the text: it is decoded into values, which drops comments and layout (`apps/devhost/internal/manifest/read.go:76-79`). [Verified]
   - Evidence to close it: the memory cost, bounded by 1 MiB per file (`config_files.go:27-28`) times the files a stack reads; and the owner's call on whether writing the running text back is an ordinary save (version-checked, checked, reloaded) or a separate action.
   - Proposed default: keep the raw text of every file the last accepted reload read, in memory for the stack's lifetime; after a rejection, show it and the lines that differ; writing it back is an ordinary save of that text over the current disk version. Never write it back on its own: the rejected text is the person's work.
   - Who decides: the product owner (whether the editor offers it); the backend owners (where the text lives and the route that serves it).
2. **Tying a save to the reload that applied it.**
   - Unknown: how a page learns which reload applied which save: the configuration status naming, for each finished reload, the version of each file it read, or the save response naming the reload that will apply it.
   - Why it matters: results by count give a second save the first save's result (config-editor-12) and lose a result on a file switch (config-editor-13). The debounce can merge two saves into one reload (`manifest_watch.go:56-98`) [Verified], so a save can also be replaced before any reload reads it.
   - Evidence to close it: the cost of one SHA-256 per file in each health message; whether other clients of the health stream depend on its present shape (`configuration_status.go:13-22`).
   - Proposed default: each source's configuration status carries the versions its last finished reload read; a save resolves as applied or rejected when a finished reload read its version, and as replaced by a later save when a later version was read first.
   - Who decides: the backend owners, against the control API; the product owner, for the wording of a replaced save.
3. **Where unsaved text lives.**
   - Unknown: whether drafts survive a page reload, and where: browser storage of the app's origin, which the app's own scripts can read because the toolbar runs inside the app's page (`packages/docs/src/content/docs/reference/control-api.md:5`; that storage is shared per origin is general knowledge), or the control server, per stack and file, with the version each draft was based on.
   - Why it matters: one reload drops every draft without a prompt, and the editor's own saves invite reloads (consequence 4, config-editor-08). Drafts can hold `env` values.
   - Evidence to close it: the control server already keeps per-stack UI state that survives a reload (`packages/docs/src/content/docs/reference/control-api.md:51`); the owner rule that keeps **Watch Live Activity** off the app's hostname so page scripts cannot read transcripts suggests page-readable storage is unwelcome for sensitive text [Hypothesis: holds if the owner applies that rule to drafts].
   - Proposed default: drafts live in the control server's memory per stack and file, with their base version, behind the same guards as the files (see question 4), restored when the window opens with a line naming the files that have unsaved changes; they end when the stack stops. Until that exists, a `beforeunload` prompt while any draft exists.
   - Who decides: the product owner (whether and how long drafts persist); the backend owners (storage and routes).
4. **Whether file contents stay readable from other machines.**
   - Unknown: whether the owner wants the config routes to serve file contents to another machine that reaches Caddy with one of the stack's hostnames, while saves from it are refused.
   - Why it matters: manifests hold commands and `env` values, and `config.toml` the shared listener settings; Caddy listens on every interface by default, and on macOS even with a loopback `bindHost` on port 443, as documented (`packages/docs/src/content/docs/guides/shared-managed-caddy-settings.md:45`, `:65`) (consequence 7).
   - Evidence to close it: the owner's intent for the control API's trust model as applied to file contents (`packages/docs/src/content/docs/reference/control-api.md:19-30`); a read from a second machine, not run for this note.
   - Proposed default: every config route (files, schema, validate) requires a loopback client, as saves, live agent activity and the stack directory already do, documented under the control API's security model. Tradeoff: nobody can read the files through devhost from another machine, where nobody can save them today either.
   - Who decides: the product owner, as an explicit contract change; the owner rules question the all-interfaces default only that way.
5. **Showing what a save will do before it is written.**
   - Unknown: whether Save shows, before writing, which services the save will restart and its effects beyond restarts (a switch back to the root checkout, the editor turning itself off, the shared Caddy settings moving every stack's URLs), and whether any of these asks for a confirmation rather than showing a warning. The restart scope itself is `O9` in the pattern reference (recommended: keep today's scope and name each restarted service and why), not repeated here.
   - Why it matters: a one-line edit can restart the page's own server or a whole repository, switch checkouts, or remove the editor with every draft (consequence 6; config-editor-05, config-editor-08, config-editor-01).
   - Evidence to close it: the plan can come from the check the editor already runs (reusable capabilities); the cost of computing the affected services in every live check, which already resolves the reload candidate (`config_editor.go:68-74`).
   - Proposed default: the check returns the plan, and the window shows it beside **Save** as a warning, never a dialog, naming the page's own service when it restarts; the save stays available.
   - Who decides: the product owner (warning or confirmation for the checkout switch and for turning the editor off); `O9` for the scope.
6. **How long a `process`-health service must stay up before a reload counts it started.**
   - Unknown: the grace period after spawn.
   - Why it matters: today the reload looks for an exit once, at the instant of start (`health.go:67-68`), so a command that fails a moment later passes, "Saved and applied." is false and the rollback never runs (consequence 5, config-editor-05). Every reload of such a service waits for whatever period is chosen.
   - Evidence to close it: a calibration ladder over the time to exit of typical failures (a missing script, a missing module, a bad flag) against the time healthy services take to settle, on the fixture's runtimes, measured in Phase 7.
   - Proposed default: 1 s after spawn, calibrated in Phase 7; a service that exits within it fails the reload with its exit code and last output lines.
   - Who decides: the backend owners with the product owner, since it lengthens reloads.
7. **What Revert returns to.**
   - Unknown: whether **Revert** returns to the version on disk, read when it is pressed, to the version the window opened, as today, or to the running version.
   - Why it matters: after a change on disk, **Revert** lands on a version that is neither on disk nor running and shows it as clean (consequence 3, config-editor-07).
   - Evidence to close it: the owner's names for the three versions (on disk, running, opened); a read on **Revert** takes the operation lock, so it waits during a reload (consequence 8).
   - Proposed default: **Revert** reads the file again and shows the version on disk; returning to the running version is question 1's action.
   - Who decides: the product owner.
8. **Keeping your edit over a newer version on disk.**
   - Unknown: whether the editor offers an explicit overwrite after a conflict, or only **Load from disk** and a merge by hand.
   - Why it matters: the conflict's only exit discards the draft (config-editor-07), and agents, IDEs and Git write these files.
   - Evidence to close it: the 409 body already carries the disk version, so an overwrite needs no backend change (reusable capabilities); whether the owner accepts overwriting an agent's or a teammate's change once the difference has been shown.
   - Proposed default: after a conflict the window shows the disk version beside the draft, with **Keep mine** (save again over the disk version, through the same checks) and **Use disk version**; it never overwrites without showing the difference first.
   - Who decides: the product owner.

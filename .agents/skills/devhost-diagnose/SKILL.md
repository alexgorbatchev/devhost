---
name: devhost-diagnose
description: Diagnose issues in running devhost instances, including routed apps, silent overlays, service recovery, and browser control connections.
author: alexgorbatchev
metadata:
  created_on: 2026-10-13 17:00
  last_modified: 2026-10-13 17:03
  status: current
---

## Identify the instance before changing it

Use this skill for a running stack. Read the applicable repository instructions and use the mattpocock-diagnosing-bugs skill for the reproduction and fix loop. Resolve source paths below from the devhost repository root, which may differ from the running app's project root. For service-only failures without a reported URL, start with the manifest, PID, and stack logs; use the browser steps only when a routed page is involved. If the control API is unavailable, establish identity from local process and manifest evidence before investigating transport or injection.

1. Record the reported URL, expected interaction, and observed result. Preserve its host, protocol, and path when probing; a loopback port alone does not exercise the routed document or control API.
2. Fetch `GET /__devhost__/config.json` from that URL's origin. Capture HTTP status, content type, cache headers, and selected JSON fields. An HTML response, redirect to login, or failed request is not configuration evidence.
3. Read `stackName`, `projectRootPath`, `routedServices`, and the feature flags relevant to the symptom. Match the page's host and path to its routed service. If local access exists, read `skills/devhost/SKILL.md` for command semantics, run `AGENT=1 devhost stack list`, and correlate the manifest path and PID with the running process. Inspect that manifest and its `includes`, rather than assuming the current checkout owns the page. Do not dump the process's entire environment; inspect only the variables needed for the diagnosis.
4. Separate running configuration from files on disk. Inspect startup/reload logs when available. A rejected reload leaves the last accepted configuration running; devtools and annotation setting changes require stopping and starting devhost. **Restart Stack** restarts managed services using the accepted manifest; it does not apply restart-required settings to devhost itself.

Use an existing, user-supplied origin in commands; do not invent one. For example, with `DEVHOST_DIAGNOSE_ORIGIN` set to the verified origin:

```sh
curl --silent --show-error --max-time 15 --dump-header - "$DEVHOST_DIAGNOSE_ORIGIN/__devhost__/config.json"
```

Keep raw diagnostic artifacts under a unique directory in the checkout's `.tmp/`. Redact credentials, environment secrets, session payloads, and private hostnames from shared evidence. Do not commit private internal domains to GitHub.

## Check gates before debugging handlers

For a silent feature, first determine whether it is mounted and enabled. Treat a disabled gate as a finding; do not label it a JavaScript crash or change defaults to conceal missing configuration.

| Symptom | First evidence | Source to inspect if needed |
| --- | --- | --- |
| Holding Alt does nothing | `annotationEnabled`, `annotationActions`, presence of the composer | `packages/devhost-ui/src/devtools/components/App.tsx`; `apps/devhost/internal/services/stack.go` |
| Toolbar missing | Routed document, injected entry request, config request, `#devhost-devtools-host` and its shadow root | `apps/devhost/internal/devtools/document_injection.go`; `packages/devhost-ui/src/devtools/startDevtools.ts` |
| Service fails or recovery stays open | Startup health target and timeout, preceding stack logs, service state, route readiness | `packages/docs/src/content/docs/guides/stack-lifecycle.md`; `apps/devhost/internal/services/` |
| Logs, resources, queues, or highlights stop updating | Relevant feature flag and same-origin WebSocket lifecycle | `packages/docs/src/content/docs/guides/devtools.md`; corresponding UI feature and server handler |
| Source edits do not appear | Executable actually running, injected asset URLs, configured source checkout | `apps/devhost/internal/services/dev_source.go`; `apps/devhost/internal/devtools/asset_handlers.go` |

For Alt selection specifically:

- Verify `annotationEnabled` and configured actions. `App.tsx` conditionally mounts `AnnotationComposer`; without it, the selection hook cannot handle Alt.
- When disabled, inspect root-level `[annotation]` and `[[annotation.actions]]` in the owning manifest and its includes. Read `packages/docs/src/content/docs/guides/annotations.md` and `apps/devhost/devhost.example.toml` before proposing configuration. Ask which action or adapter to use if the user's intent does not specify one; do not choose an agent on their behalf.
- When enabled, reproduce with focus on the page, hold Alt, and move over a target. Inspect `useAnnotationSelectionDraft.ts` under the annotation composer's `hooks/` directory for editing-surface, submission, key-release, and window-blur gates. Check the selected plugin and candidate resolution if selection activates but no target appears.
- Distinguish injected devhost overlays from app-owned or third-party overlays before assigning a failing code path.

## Reproduce through the rendered page

Use the agent-browser skill for a separate browser session. Inspect an already-open Chrome session only with the user's explicit approval and the chrome-cdp skill. Use a unique diagnostic session and close only that session afterward.

1. Inspect the rendered document and network requests. Injection is document-sensitive: a plain curl request can return HTML without the injected script while a browser navigation receives it. Do not conclude injection is broken from curl alone; inspect `document.scripts`, the browser response, and the host shadow root. Inspect `apps/devhost/internal/caddy/proxy_origin.go` for the document routing matcher.
2. Confirm `/__devhost__/inject.js`, its lazy chunks, and `/__devhost__/config.json` load successfully. Configuration is fetched with `cache: "no-store"` and served separately from versioned assets; searching the JavaScript bundle for instance settings is not a configuration check.
3. Drive the reported interaction and assert its observable outcome, such as a target highlight appearing while Alt is held. Capture console errors and failed network requests, but do not equate an empty console with success. Synthetic keyboard events can isolate a listener; they do not prove that physical keyboard input reaches it.
4. For connection failures, inspect the relevant `/__devhost__/ws/` request and messages using the routed origin and its HTTP/HTTPS scheme. Verify the current handler before inventing an HTTP health or logs endpoint. Native browser control reconnects explicitly; other documented UI event connections reconnect automatically.
5. If access or reproduction fails, report the failed command, result, and missing evidence. Request only the evidence needed to continue, such as the affected browser's network failure or owning stack logs. Do not assert a cause without supporting observations.

Read `packages/docs/src/content/docs/guides/devtools.md` for the control API and connection behavior. Check current handlers before relying on payload shapes or error semantics. For source checkout rebuilding, verify `DEVHOST_DEV_SOURCE_DIR` on the running process; rebuilding this checkout does not prove a separately installed binary serves it.

## Fix and verify within the requested scope

After a reproducible failure, state falsifiable hypotheses and test one variable at a time. Follow the diagnosing-bugs workflow for code defects, including a behavioral regression at the seam that reaches the failure, red/green execution, and confirming the test fails with the fix temporarily disabled. Read language and workspace skills before modifying code.

For configuration causes, show the exact disabled gate and missing or rejected setting. If a fix is authorized, edit only the owning project's configuration, validate it using that project's documented commands, and coordinate any required stack restart with the user when it would disrupt their running work. Do not stop shared Caddy, unrelated stacks, or external services as a diagnostic reset. Preserve existing service selections and worktree choices.

Re-run the original URL and interaction after applying a fix. A passing local test, changed manifest, rebuilt bundle, or successful service restart alone does not establish that the reported live instance is fixed. Update required docs and run the affected workspace checks for implementation changes. Remove temporary instrumentation and stop only owned validation processes.

Report the cause or remaining uncertainty, the instance identity, the decisive command and redacted output, changes made, and the original reproduction's final result. If no live fix was applied or verified, say so explicitly. Keep unrelated findings separate and leave unowned changes untouched.
